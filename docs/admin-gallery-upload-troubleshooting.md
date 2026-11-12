# Admin Gallery Uploads — Troubleshooting Guide

Use this guide when **Admin → Gallery** (or **Edit Website → Gallery**) accepts a
photo selection but no new work appears, or only some of the selected photos are
saved.

## Known issues fixed

### 1. Multi-file upload only saved the first photo

**Cause:** `js/admin-gallery.js` received the file input's `FileList`, then the
change handler immediately cleared the input:

```js
fileUploadInput.addEventListener('change', (e) => {
  handleFileUpload(e.target.files);
  fileUploadInput.value = '';   // empties the live FileList
});
```

`FileList` is a live object. While the first `fetch()` was awaiting, the input
was cleared, so `files.length` became `0`. The loop stopped after the first
file, the progress text showed `1/0 saved`, and the progress bar stalled.

**Fix:** snapshot the selection synchronously inside `handleFileUpload()` and
use the captured array and length:

```js
async function handleFileUpload(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;
  const total = files.length;
  for (let i = 0; i < total; i++) { /* ... */ }
}
```

### 2. Admin page opened through Live Server could not reach the API

**Cause:** `html/admin-side/gallery.html` loaded `admin-gallery.js` without
`api-base.js`, and the script used relative URLs such as
`/api/admin/gallery/upload`. When the page is opened from Live Server
(`http://localhost:5500`) those requests hit the static server and 404, so
listing, uploading, previews and SSE all failed.

**Fix:** load `api-base.js` before `admin-gallery.js` and build every URL from
the resolved origin:

```html
<script src="../../js/api-base.js"></script>
<script src="../../js/admin-gallery.js"></script>
```

```js
const API_ORIGIN = window.PAULINA_API_BASE || '';
const API_BASE = `${API_ORIGIN}/api/admin/gallery`;
const SSE_ENDPOINT = `${API_ORIGIN}/api/gallery/stream`;
const mediaUrl = (url) => window.paulinaMediaUrl ? window.paulinaMediaUrl(url) : url;
```

## Diagnostic checklist

Work through these in order. Check the browser **Network** tab and the terminal
running `npm start` after each step.

1. **Confirm the API is up**
   ```powershell
   curl.exe -s http://localhost:3000/api/health
   ```
   Expect `{"success":true,...}`. If this fails, start the site with `npm start`
   from the project root.

2. **Check the failing request**
   - Open DevTools → Network → filter `upload`.
   - `404` on port `5500`/`5501` → issue #2 above (wrong origin).
   - `400` with `File exceeds maximum limit of 10 MB.` → photo is too large.
   - `400` with `Only JPG, PNG, and WebP images are allowed.` → unsupported
     format (common with iPhone HEIC photos); export as JPG first.
   - `500` → read the server terminal for `[gallery] Upload processing failed`.
   - `net::ERR_CONNECTION_REFUSED` → Express is not running.

3. **Verify the upload directly (bypasses the browser)**
   ```powershell
   curl.exe -s -X POST "http://localhost:3000/api/admin/gallery/upload" `
     -F "file=@C:\path\to\photo.jpg;type=image/jpeg" `
     -F "title=Upload test" -F "category=Tattoos" `
     -F "subcategory=Body tattoos" -F "isPublished=true"
   ```
   A `201` means the backend and storage are healthy and the problem is in the
   page (`api-base.js`, JavaScript error, or stale cache).

4. **Check filesystem permissions**
   The server writes to:
   ```text
   data/gallery.json
   data/uploads/gallery/
   ```
   If these are read-only or owned by another account, uploads fail with `500`.
   On Windows, confirm the account running Node has **Modify** permission, and
   that antivirus/Controlled Folder Access is not blocking writes.

5. **Check the data directory**
   ```powershell
   Get-ChildItem data\uploads\gallery
   Get-Content data\gallery.json -Raw
   ```
   A file on disk without an entry in `gallery.json` means the file was written
   but metadata persistence failed (see the server log).

6. **Check storage mode and Supabase**
   `/api/health` reports `"storage":"local-json"` while
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are placeholders. That is expected.
   If real Supabase credentials are configured but the database is unreachable,
   `galleryStore` falls back to the local JSON file after a 3-second timeout and
   logs `[galleryStore] Supabase marked unavailable ...`. Uploads still succeed
   locally; fix the URL/key or the `gallery_images` table to restore sync.

7. **Check realtime sync (previews/other tabs)**
   The page subscribes to `/api/gallery/stream`. A blocked or wrong-origin SSE
   endpoint does not break uploads, but other open admin tabs will not refresh.
   Confirm the EventSource request is `200` with `Content-Type: text/event-stream`.

8. **Rule out frontend errors**
   DevTools → Console. A single uncaught error before the upload handler binds
   will disable every button on the page. Reload with cache disabled
   (`Ctrl+Shift+R`) after deploying script changes.

## Related hardening opportunities

- `js/server.js` writes the multipart file before `createImage()` runs. If the
  metadata write fails, the file remains orphaned in `data/uploads/gallery/`.
  Consider deleting `req.file.path` in the catch block.
- Replacing an image (`change-image`) does not delete the previous file.
  Consider unlinking `deletedItem.imageUrl` after a successful update.
- `html/admin-side/catalogue.html` and `js/admin-catalogue.js` have the same
  missing `api-base.js` / relative-URL pattern. They work on port 3000 but will
  fail for listing and uploads when the page is opened through Live Server.
