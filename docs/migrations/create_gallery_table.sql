-- =============================================================================
-- PAULINA BODY ART STUDIO: GALLERY IMAGES MIGRATION
-- Run in Supabase SQL Editor to initialize the gallery storage table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gallery_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(120) NOT NULL,
    category VARCHAR(50) NOT NULL,       -- 'Tattoos' or 'Piercing'
    subcategory VARCHAR(80) NOT NULL,    -- 'Body tattoos', 'Face piercing', etc.
    body_part VARCHAR(60) DEFAULT '',     -- 'Nose', 'Septum', 'Collarbone', etc.
    image_url TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    alt_text TEXT DEFAULT '',
    is_published BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_gallery_published ON public.gallery_images (is_published, category);
CREATE INDEX IF NOT EXISTS idx_gallery_created_at ON public.gallery_images (created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.gallery_images ENABLE ROW LEVEL SECURITY;

-- Anonymous users can read published images
DROP POLICY IF EXISTS "Allow public read published images" ON public.gallery_images;
CREATE POLICY "Allow public read published images"
ON public.gallery_images FOR SELECT
TO anon, authenticated
USING (is_published = true);

-- Service role has full CRUD
DROP POLICY IF EXISTS "Allow service role all operations" ON public.gallery_images;
CREATE POLICY "Allow service role all operations"
ON public.gallery_images FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

