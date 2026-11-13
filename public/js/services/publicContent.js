export async function readPublicContent(kind) {
  const source = {
    gallery: { table: 'gallery_images', field: 'images' },
    catalogue: { table: 'jewelry_catalogue', field: 'items' }
  }[kind];
  if (!source) throw new Error('Unknown public content collection.');
  const response = await fetch(window.paulinaApiUrl(`/api/${kind}`), { cache: 'no-store' });
  if (response.ok) {
    const result = await response.json();
    if (!result.success || !Array.isArray(result[source.field])) throw new Error('Invalid public content response.');
    return result;
  }
  // Static deployments have no Express API; published rows remain protected by Supabase RLS.
  if (response.status !== 404) throw new Error(`Public content HTTP ${response.status}`);
  const client = window.paulinaSupabase || (await import('../supabase-config.js')).supabase;
  const { data, error } = await client.from(source.table).select('*')
    .eq('is_published', true).order('display_order', { ascending: true });
  if (error) throw error;
  return { success: true, [source.field]: data,
    demo: data.some(item => String(item.title || '').startsWith('[Demo] ')) };
}

export function normalizeGalleryImage(item) {
  return { ...item,
    title: String(item.title || '').replace(/^\[Demo\]\s*/i, ''),
    imageUrl: item.imageUrl || item.image_url || '',
    thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || item.imageUrl || item.image_url || '',
    bodyPart: item.bodyPart || item.body_part || '',
    altText: String(item.altText || item.alt_text || item.title || '').replace(/^\[Demo\]\s*/i, '').replace(/\s*— demo portfolio record$/i, ''),
    displayOrder: item.displayOrder ?? item.display_order ?? 0,
    createdAt: item.createdAt || item.created_at,
    updatedAt: item.updatedAt || item.updated_at
  };
}
