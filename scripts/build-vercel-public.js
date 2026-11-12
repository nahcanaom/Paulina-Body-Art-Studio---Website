'use strict';

/**
 * Builds the static half of the site for Vercel.
 *
 * Vercel serves an Express app as a single Vercel Function and only looks in
 * `public/**` for static files (`express.static()` is ignored there). The site
 * keeps its assets at the repository root, so this script mirrors the public
 * directories into `public/` and also mirrors the HTML pages at every URL the
 * pages link to:
 *
 *   /home.html, /artist.html      (root-relative links between pages)
 *   /user-side/artist.html        (../user-side/... links)
 *   /html/user-side/artist.html   (../html/user-side/... links)
 *   /admin-side/dashboard.html    (admin pages)
 *
 * The asset URLs inside the pages (../../css/..., ../../assets/...) keep
 * working because they resolve from the page's URL, exactly as they do under
 * the Express server.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public');

const PUBLIC_DIRECTORIES = ['assets', 'css', 'js', 'components', 'template', 'html'];

// Backend-only source that lives beside the browser scripts in js/.
const SKIPPED_FILES = new Set([path.join('js', 'server.js')]);

function copyDirectory(source, target, prefix = '') {
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;

    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (SKIPPED_FILES.has(relative)) continue;

    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(from, to, relative);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function copyFile(source, relativeTarget) {
  const target = path.join(OUT_DIR, relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function htmlFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((fileName) => fileName.toLowerCase().endsWith('.html'));
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const directory of PUBLIC_DIRECTORIES) {
  // The directory's own name is the start of every relative path inside it, so
  // the skip list can match entries such as js/server.js.
  copyDirectory(path.join(ROOT, directory), path.join(OUT_DIR, directory), directory);
}

const USER_PAGES_DIR = path.join(ROOT, 'html', 'user-side');
for (const fileName of htmlFiles(USER_PAGES_DIR)) {
  const source = path.join(USER_PAGES_DIR, fileName);
  copyFile(source, fileName);
  copyFile(source, path.join('user-side', fileName));
  if (fileName.toLowerCase() === 'home.html') copyFile(source, 'index.html');
}

const ADMIN_PAGES_DIR = path.join(ROOT, 'html', 'admin-side');
for (const fileName of htmlFiles(ADMIN_PAGES_DIR)) {
  copyFile(path.join(ADMIN_PAGES_DIR, fileName), path.join('admin-side', fileName));
}

const fileCount = (function count(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    if (entry.isDirectory()) return total + count(path.join(directory, entry.name));
    return total + 1;
  }, 0);
})(OUT_DIR);

console.log(`Vercel static output ready in public/ (${fileCount} files).`);
