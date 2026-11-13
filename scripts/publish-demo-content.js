require('dotenv').config({ quiet: true });
require('dotenv').config({ path: '.secrets/supabase-publish.env', quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const demo = require('../services/demoContent');

function galleryId(id) {
  const hash = crypto.createHash('sha256').update(`paulina:${id}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function records() {
  return [
    ...demo.catalogue().map((item, index) => ({
      table: 'jewelry_catalogue', bucket: 'jewelry-catalogue', source: item.imageUrl,
      row: { id: 900000001 + index, reference: `paulina-${item.id}`,
        name: `[Demo] ${item.name}`, title: `[Demo] ${item.name}`,
        description: 'Demo record using bundled studio imagery. Price, sizes and placement are samples.',
        category: item.category, subcategory: item.subcategory, material: item.material,
        price: item.price, sizes: item.sizes, active_size: item.sizes[0],
        social_media: 'Instagram', social_order_url: 'https://www.instagram.com/paulinabodyart/',
        is_active: true, is_published: true, display_order: index }
    })),
    ...demo.gallery().map((item, index) => ({
      table: 'gallery_images', bucket: 'studio-gallery', source: item.imageUrl,
      row: { id: galleryId(item.id), title: `[Demo] ${item.title}`,
        category: item.category, subcategory: item.subcategory,
        alt_text: `${item.altText} — demo portfolio record`,
        is_published: true, display_order: index }
    }))
  ];
}

async function publish() {
  const plan = records();
  for (const entry of plan) {
    assert(fs.existsSync(path.join(__dirname, '../public', decodeURIComponent(entry.source))));
  }
  if (!process.argv.includes('--execute')) {
    console.log(`Dry run: ${plan.length} published demo records and images; existing rows will never be overwritten.`);
    return;
  }
  assert(process.env.SUPABASE_SEED_KEY?.startsWith('sb_secret_'), 'Put the owner key in ignored .secrets/supabase-publish.env; never in public configuration.');
  assert.equal(new URL(process.env.SUPABASE_URL).hostname, 'celusvfynfnszmhjgqwj.supabase.co', 'Wrong Supabase project.');
  const owner = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SEED_KEY, { auth: { persistSession: false } });
  const publicClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  // Check every reserved ID before uploading so a collision never overwrites studio content.
  for (const entry of plan) {
    const { data, error } = await owner.from(entry.table).select('id,title,image_url').eq('id', entry.row.id).maybeSingle();
    if (error) throw error;
    if (data) {
      assert.equal(data.title, entry.row.title, `Reserved ID collision in ${entry.table}.`);
      entry.existing = data;
    }
  }
  for (const entry of plan) {
    const file = path.join(__dirname, '../public', decodeURIComponent(entry.source));
    const bytes = fs.readFileSync(file);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const object = `paulina-demo/${digest}${path.extname(file)}`;
    const contentType = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const { error } = await owner.storage.from(entry.bucket).upload(object, bytes, { contentType, upsert: false });
    if (error && String(error.statusCode) !== '409') throw error;
    const imageUrl = owner.storage.from(entry.bucket).getPublicUrl(object).data.publicUrl;
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
    assert(response.ok, `Image is not public: HTTP ${response.status}`);
    const remoteDigest = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    assert.equal(remoteDigest, digest, 'Uploaded media differs from local file.');
    if (!entry.existing) {
      const row = { ...entry.row, image_url: imageUrl, thumbnail_url: imageUrl };
      if (entry.table === 'jewelry_catalogue') row.images = [imageUrl];
      const { error: insertError } = await owner.from(entry.table).insert(row);
      if (insertError) throw insertError;
    } else assert.equal(entry.existing.image_url, imageUrl, 'Existing demo row changed; refusing to overwrite.');
    const { data, error: readError } = await publicClient.from(entry.table).select('id,is_published,image_url').eq('id', entry.row.id).single();
    if (readError) throw readError;
    assert(data.is_published && data.image_url === imageUrl, 'Demo record is not visible to public readers.');
    console.log(`Publicly verified ${entry.table} ${entry.row.id}`);
  }
  console.log('Published and anonymously verified all 13 demo records and their exact image bytes.');
}

if (require.main === module) publish().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { records, galleryId };
