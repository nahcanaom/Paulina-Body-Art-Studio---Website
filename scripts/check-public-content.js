const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const source = fs.readFileSync(require.resolve('../public/js/services/publicContent.js'), 'utf8');
  const { readPublicContent, normalizeGalleryImage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const savedFetch = global.fetch;
  const savedWindow = global.window;
  try {
    let reads = 0;
    global.window = { paulinaApiUrl: value => value, paulinaSupabase: {
      from(table) {
        reads++;
        assert(['gallery_images', 'jewelry_catalogue'].includes(table));
        return { select: () => ({ eq: (column, value) => {
          assert.equal(column, 'is_published'); assert.equal(value, true);
          return { order: async () => ({ data: [{ title: '[Demo] Ear', image_url: 'https://example.com/ear.jpg' }], error: null }) };
        } }) };
      }
    } };
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true, images: [] }) });
    assert.deepEqual((await readPublicContent('gallery')).images, []);
    assert.equal(reads, 0, 'Empty API response must remain authoritative.');
    global.fetch = async () => ({ ok: false, status: 404 });
    const gallery = await readPublicContent('gallery');
    assert(gallery.demo);
    assert.equal(normalizeGalleryImage(gallery.images[0]).imageUrl, 'https://example.com/ear.jpg');
    assert.equal((await readPublicContent('catalogue')).items.length, 1);
    global.fetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(readPublicContent('gallery'), /HTTP 500/);
    assert.equal(reads, 2, 'Server errors must not bypass the API.');
    await assert.rejects(readPublicContent('private-data'), /Unknown/);
    console.log('Public content checks passed: API authority, static fallback, published-only query and gallery image normalization.');
  } finally { global.fetch = savedFetch; global.window = savedWindow; }
})().catch(error => { console.error(error); process.exitCode = 1; });
