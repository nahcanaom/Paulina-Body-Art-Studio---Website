const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const demo = require('../services/demoContent');

(async () => {
  process.env.PAULINA_ENV = 'demo';
  process.env.NODE_ENV = 'production';
  assert.equal(demo.isDemo(), false);
  process.env.NODE_ENV = 'test';
  assert.equal(demo.isDemo(), true);
  const catalogue = await require('../services/catalogueStore').getPublishedCatalogue();
  const gallery = await require('../services/galleryStore').getPublishedImages();
  assert(catalogue.length > 0 && gallery.length > 0);
  for (const item of [...catalogue, ...gallery]) {
    assert(fs.existsSync(path.join(__dirname, '../public', decodeURIComponent(item.imageUrl))));
  }
  assert((await require('../services/galleryStore').getPublishedImages('Body Tattoo')).every(item => item.category === 'Body Tattoo'));
  assert.equal(demo.filter(catalogue, 'nonexistent').length, 0);
  delete process.env.PAULINA_ENV;
  assert.equal(demo.isDemo(), false);
  console.log(`Demo checks passed: ${catalogue.length} products, ${gallery.length} gallery works; all images exist.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
