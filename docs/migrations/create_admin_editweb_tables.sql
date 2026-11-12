-- =============================================================================
-- PAULINA BODY ART STUDIO: "EDIT WEBSITE" MIGRATION
-- =============================================================================
-- Run this once in the Supabase SQL Editor before using
-- html/admin-side/admin-editweb.html.
--
-- Creates:
--   public.site_settings     -> home + booking JSON documents
--   public.artist_profiles   -> artist page profiles
--   public.faqs              -> FAQ page question/answer pairs
--   public.jewelry_catalogue -> jewellery catalogue items (if missing)
--   public.gallery_images    -> gallery items (if missing)
--   public.site_images       -> images managed inside the Home, Artists,
--                               FAQs and Booking Info tabs
--   storage buckets studio-gallery + jewelry-catalog and their policies
--
-- SECURITY NOTE
-- The admin panel signs in with Firebase, not Supabase Auth, so the browser
-- writes with the Supabase anon key. The policies below therefore allow the
-- anon role to manage these content tables and the two media buckets.
-- If/when Supabase Auth is adopted for admins, replace the anon access with
-- an authenticated-admin check before going to production.
-- =============================================================================

-- Needed for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. SITE SETTINGS (home page + booking information)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.site_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edit website settings access" ON public.site_settings;
CREATE POLICY "Edit website settings access"
ON public.site_settings FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Seed the two documents the admin panel expects. Existing rows are kept.
INSERT INTO public.site_settings (key, value)
VALUES
    ('home', '{}'::jsonb),
    ('booking', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. ARTIST PROFILES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.artist_profiles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,
    role          VARCHAR(120) NOT NULL DEFAULT '',
    bio           TEXT NOT NULL DEFAULT '',
    specialties   TEXT[] NOT NULL DEFAULT '{}',
    avatar_url    TEXT NOT NULL DEFAULT '',
    instagram_url TEXT NOT NULL DEFAULT '',
    is_published  BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_artist_profiles_order
    ON public.artist_profiles (display_order, created_at);

ALTER TABLE public.artist_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edit website artist access" ON public.artist_profiles;
CREATE POLICY "Edit website artist access"
ON public.artist_profiles FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- =============================================================================
-- 3. FAQS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.faqs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL,
    category      VARCHAR(80) NOT NULL DEFAULT '',
    is_published  BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_faqs_order
    ON public.faqs (is_published, display_order, created_at);

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edit website faq access" ON public.faqs;
CREATE POLICY "Edit website faq access"
ON public.faqs FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- =============================================================================
-- 4. JEWELLERY CATALOGUE
-- =============================================================================
-- The browser controller and services/catalogueStore.js both read and write
-- this table. IF NOT EXISTS keeps any existing production data untouched.
CREATE TABLE IF NOT EXISTS public.jewelry_catalogue (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference        TEXT UNIQUE,
    name             VARCHAR(160) NOT NULL,
    title            VARCHAR(160) NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    category         VARCHAR(60) NOT NULL DEFAULT 'Ear',
    subcategory      VARCHAR(80) NOT NULL DEFAULT '',
    material         VARCHAR(120) NOT NULL DEFAULT '',
    price            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    sizes            TEXT[] NOT NULL DEFAULT '{}',
    active_size      VARCHAR(40) NOT NULL DEFAULT '',
    social_media     VARCHAR(40) NOT NULL DEFAULT 'Instagram',
    social_order_url TEXT NOT NULL DEFAULT '',
    image_url        TEXT NOT NULL DEFAULT '',
    thumbnail_url    TEXT NOT NULL DEFAULT '',
    images           TEXT[] NOT NULL DEFAULT '{}',
    is_published     BOOLEAN NOT NULL DEFAULT true,
    display_order    INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Tolerate projects created from earlier drafts of this table.
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS name VARCHAR(160);
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS title VARCHAR(160);
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS subcategory VARCHAR(80);
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS material VARCHAR(120);
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS active_size VARCHAR(40);
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS social_media VARCHAR(40);
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS social_order_url TEXT;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS images TEXT[];
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_catalogue_published
    ON public.jewelry_catalogue (is_published, category, display_order);
CREATE INDEX IF NOT EXISTS idx_catalogue_created_at
    ON public.jewelry_catalogue (created_at DESC);

ALTER TABLE public.jewelry_catalogue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edit website catalogue access" ON public.jewelry_catalogue;
CREATE POLICY "Edit website catalogue access"
ON public.jewelry_catalogue FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- =============================================================================
-- 5. GALLERY IMAGES
-- =============================================================================
-- docs/migrations/create_gallery_table.sql already creates this table. The
-- block below is a no-op on existing projects and makes this migration
-- self-contained on fresh ones.
CREATE TABLE IF NOT EXISTS public.gallery_images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(120) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    subcategory   VARCHAR(80) NOT NULL,
    image_url     TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    alt_text      TEXT NOT NULL DEFAULT '',
    is_published  BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_gallery_published
    ON public.gallery_images (is_published, category);
CREATE INDEX IF NOT EXISTS idx_gallery_created_at
    ON public.gallery_images (created_at DESC);

ALTER TABLE public.gallery_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edit website gallery access" ON public.gallery_images;
CREATE POLICY "Edit website gallery access"
ON public.gallery_images FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- =============================================================================
-- 6. TABLE GRANTS
-- =============================================================================
-- Supabase normally applies these through default privileges; making them
-- explicit keeps the browser controller working on projects where the
-- defaults were changed.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.site_settings,
       public.artist_profiles,
       public.faqs,
       public.jewelry_catalogue,
       public.gallery_images
    TO anon, authenticated;

-- =============================================================================
-- 7. STORAGE BUCKETS + POLICIES
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('studio-gallery', 'studio-gallery', true)
ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public)
VALUES ('jewelry-catalog', 'jewelry-catalog', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public reads (the website renders the saved public URLs).
DROP POLICY IF EXISTS "Edit website media public read" ON storage.objects;
CREATE POLICY "Edit website media public read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id IN ('studio-gallery', 'jewelry-catalog'));

-- Admin uploads, edits and deletes from the browser controller.
DROP POLICY IF EXISTS "Edit website media write" ON storage.objects;
CREATE POLICY "Edit website media write"
ON storage.objects FOR ALL
TO anon, authenticated
USING (bucket_id IN ('studio-gallery', 'jewelry-catalog'))
WITH CHECK (bucket_id IN ('studio-gallery', 'jewelry-catalog'));

-- =============================================================================
-- 8. SITE IMAGES (managed from the existing website tabs)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.site_images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section       TEXT NOT NULL,
    -- Favorite Works rows point at the artist whose section they belong to.
    artist_id     UUID REFERENCES public.artist_profiles(id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT '',
    subtitle      TEXT NOT NULL DEFAULT '',
    alt_text      TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    image_url     TEXT NOT NULL DEFAULT '',
    is_published  BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Tolerate projects created from earlier drafts of this table.
ALTER TABLE public.site_images
    ADD COLUMN IF NOT EXISTS artist_id UUID REFERENCES public.artist_profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_site_images_section_order
    ON public.site_images (section, display_order);
CREATE INDEX IF NOT EXISTS idx_site_images_artist_order
    ON public.site_images (artist_id, display_order);

ALTER TABLE public.site_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Edit website site images access" ON public.site_images;
CREATE POLICY "Edit website site images access"
ON public.site_images FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_images TO anon, authenticated;

-- =============================================================================
-- 9. REFRESH POSTGREST SCHEMA CACHE
-- =============================================================================
-- Ask PostgREST to pick up the new tables immediately.
NOTIFY pgrst, 'reload schema';
