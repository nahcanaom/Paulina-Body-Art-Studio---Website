-- =============================================================================
-- PAULINA BODY ART STUDIO: FULL PRODUCTION SYNC MIGRATION
-- =============================================================================
-- Consolidated, idempotent migration for Supabase PostgreSQL and Supabase Storage.
-- Run this in the Supabase SQL Editor to provision all tables, columns,
-- storage buckets, RLS policies, triggers, and realtime publications.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 0. HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Admin authorization check function
CREATE OR REPLACE FUNCTION public.is_studio_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(lower(auth.jwt() ->> 'email'), '') IN (
        'paulinabodyartstudio@gmail.com'
    )
    OR coalesce(lower(auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'
    OR coalesce(lower(auth.jwt() -> 'user_metadata' ->> 'role'), '') = 'admin';
$$;

-- Email existence checker for client auth
CREATE OR REPLACE FUNCTION public.email_exists(check_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM auth.users
        WHERE lower(email) = lower(trim(check_email))
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_studio_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_exists(text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. STORAGE BUCKETS
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES
    ('studio-gallery', 'studio-gallery', true),
    ('jewelry-catalog', 'jewelry-catalog', true),
    ('site-images', 'site-images', true),
    ('custom-requests', 'custom-requests', true),
    ('profile_pictures', 'profile_pictures', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage RLS Policies
DROP POLICY IF EXISTS "Public media read access" ON storage.objects;
CREATE POLICY "Public media read access"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id IN ('studio-gallery', 'jewelry-catalog', 'site-images', 'custom-requests', 'profile_pictures'));

DROP POLICY IF EXISTS "Public media insert access" ON storage.objects;
CREATE POLICY "Public media insert access"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id IN ('studio-gallery', 'jewelry-catalog', 'site-images', 'custom-requests'));

DROP POLICY IF EXISTS "Public media modify access" ON storage.objects;
CREATE POLICY "Public media modify access"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id IN ('studio-gallery', 'jewelry-catalog', 'site-images', 'custom-requests'));

DROP POLICY IF EXISTS "Public media delete access" ON storage.objects;
CREATE POLICY "Public media delete access"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id IN ('studio-gallery', 'jewelry-catalog', 'site-images', 'custom-requests'));

-- Profile picture specific owner policies
DROP POLICY IF EXISTS "Users can upload their own profile picture" ON storage.objects;
CREATE POLICY "Users can upload their own profile picture"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'profile_pictures'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update their own profile picture" ON storage.objects;
CREATE POLICY "Users can update their own profile picture"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'profile_pictures'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete their own profile picture" ON storage.objects;
CREATE POLICY "Users can delete their own profile picture"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'profile_pictures'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- -----------------------------------------------------------------------------
-- 2. BOOKINGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference           VARCHAR(50) UNIQUE NOT NULL,
    full_name           TEXT NOT NULL DEFAULT '',
    email               TEXT NOT NULL DEFAULT '',
    phone               TEXT NOT NULL DEFAULT '',
    service_type        TEXT NOT NULL DEFAULT '',
    service             TEXT NOT NULL DEFAULT '',
    artist              TEXT NOT NULL DEFAULT 'Paulina Vampire',
    date                TEXT NOT NULL DEFAULT '',
    time                TEXT NOT NULL DEFAULT '',
    duration            TEXT NOT NULL DEFAULT '1 hour',
    end_time            TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'pending_confirmation',
    attendance_status   TEXT NOT NULL DEFAULT '',
    deposit_amount      NUMERIC(10, 2) NOT NULL DEFAULT 500,
    deposit             TEXT NOT NULL DEFAULT '₱500',
    deposit_status      TEXT NOT NULL DEFAULT 'paid',
    payment_method      TEXT NOT NULL DEFAULT 'Gcash',
    receipt_file_name   TEXT NOT NULL DEFAULT '',
    receipt_url         TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    placement           TEXT NOT NULL DEFAULT '',
    tattoo_size         TEXT NOT NULL DEFAULT '',
    tattoo_form_type    TEXT NOT NULL DEFAULT '',
    tattoo_style        TEXT NOT NULL DEFAULT '',
    client_request_id   TEXT NOT NULL DEFAULT '',
    email_sent          BOOLEAN NOT NULL DEFAULT false,
    email_error         TEXT NOT NULL DEFAULT '',
    email_provider      TEXT NOT NULL DEFAULT '',
    source              TEXT NOT NULL DEFAULT 'website',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reference VARCHAR(50);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS artist TEXT NOT NULL DEFAULT 'Paulina Vampire';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS date TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS time TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS duration TEXT NOT NULL DEFAULT '1 hour';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_confirmation';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS attendance_status TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10, 2) NOT NULL DEFAULT 500;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit TEXT NOT NULL DEFAULT '₱500';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'Gcash';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS receipt_file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS receipt_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS placement TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tattoo_size TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tattoo_form_type TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tattoo_style TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS client_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS email_error TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS email_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'website';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_bookings_date ON public.bookings (date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON public.bookings (reference);
CREATE INDEX IF NOT EXISTS idx_bookings_client_req ON public.bookings (client_request_id);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can check slot locks and read bookings" ON public.bookings;
CREATE POLICY "Public can check slot locks and read bookings"
ON public.bookings FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Public can submit bookings" ON public.bookings;
CREATE POLICY "Public can submit bookings"
ON public.bookings FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins and server can update bookings" ON public.bookings;
CREATE POLICY "Admins and server can update bookings"
ON public.bookings FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins and server can delete bookings" ON public.bookings;
CREATE POLICY "Admins and server can delete bookings"
ON public.bookings FOR DELETE
TO anon, authenticated
USING (true);

-- -----------------------------------------------------------------------------
-- 3. CUSTOM REQUESTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.custom_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id              UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
    reference               VARCHAR(50) UNIQUE NOT NULL,
    full_name               TEXT NOT NULL DEFAULT '',
    email                   TEXT NOT NULL DEFAULT '',
    phone                   TEXT NOT NULL DEFAULT '',
    service                 TEXT NOT NULL DEFAULT 'Custom Tattoo',
    service_type            TEXT NOT NULL DEFAULT 'Tattoo',
    artist                  TEXT NOT NULL DEFAULT 'Paulina Vampire',
    date                    TEXT NOT NULL DEFAULT '',
    time                    TEXT NOT NULL DEFAULT '',
    concept_description     TEXT NOT NULL DEFAULT '',
    placement               TEXT NOT NULL DEFAULT '',
    dimensions              TEXT NOT NULL DEFAULT '',
    style                   TEXT NOT NULL DEFAULT '',
    tattoo_form_type        TEXT NOT NULL DEFAULT 'custom',
    reference_image_url     TEXT NOT NULL DEFAULT '',
    reference_file_name     TEXT NOT NULL DEFAULT '',
    receipt_image_url       TEXT NOT NULL DEFAULT '',
    receipt_file_name       TEXT NOT NULL DEFAULT '',
    status                  TEXT NOT NULL DEFAULT 'pending',
    admin_notes             TEXT NOT NULL DEFAULT '',
    decline_reason          TEXT NOT NULL DEFAULT '',
    decision_email_sent     BOOLEAN DEFAULT NULL,
    decision_email_error    TEXT NOT NULL DEFAULT '',
    reviewed_at             TIMESTAMPTZ,
    decided_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS reference VARCHAR(50);
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS concept_description TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS placement TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS dimensions TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS reference_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS reference_file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS receipt_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS receipt_file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS admin_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS decline_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS decision_email_sent BOOLEAN DEFAULT NULL;
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS decision_email_error TEXT NOT NULL DEFAULT '';
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.custom_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_custom_requests_ref ON public.custom_requests (reference);
CREATE INDEX IF NOT EXISTS idx_custom_requests_status ON public.custom_requests (status);

ALTER TABLE public.custom_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public custom requests read access" ON public.custom_requests;
CREATE POLICY "Public custom requests read access"
ON public.custom_requests FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Public custom requests insert access" ON public.custom_requests;
CREATE POLICY "Public custom requests insert access"
ON public.custom_requests FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins and server custom requests update access" ON public.custom_requests;
CREATE POLICY "Admins and server custom requests update access"
ON public.custom_requests FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins and server custom requests delete access" ON public.custom_requests;
CREATE POLICY "Admins and server custom requests delete access"
ON public.custom_requests FOR DELETE
TO anon, authenticated
USING (true);

-- -----------------------------------------------------------------------------
-- 4. CATALOGUE ITEMS (and jewelry_catalogue compatibility)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jewelry_catalogue (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference        TEXT UNIQUE,
    name             VARCHAR(160) NOT NULL,
    title            VARCHAR(160) NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    category         VARCHAR(60) NOT NULL DEFAULT 'Ear',
    subcategory      VARCHAR(80) NOT NULL DEFAULT '',
    material         VARCHAR(120) NOT NULL DEFAULT '',
    specs            TEXT NOT NULL DEFAULT '',
    price            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    sizes            TEXT[] NOT NULL DEFAULT '{}',
    active_size      VARCHAR(40) NOT NULL DEFAULT '',
    social_media     VARCHAR(40) NOT NULL DEFAULT 'Instagram',
    social_order_url TEXT NOT NULL DEFAULT '',
    image_url        TEXT NOT NULL DEFAULT '',
    thumbnail_url    TEXT NOT NULL DEFAULT '',
    images           TEXT[] NOT NULL DEFAULT '{}',
    is_active        BOOLEAN NOT NULL DEFAULT true,
    is_published     BOOLEAN NOT NULL DEFAULT true,
    display_order    INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS name VARCHAR(160);
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS title VARCHAR(160) DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS subcategory VARCHAR(80) DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS material VARCHAR(120) DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS specs TEXT DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS sizes TEXT[] DEFAULT '{}';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS active_size VARCHAR(40) DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS social_media VARCHAR(40) DEFAULT 'Instagram';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS social_order_url TEXT DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT '';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
ALTER TABLE public.jewelry_catalogue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_catalogue_published ON public.jewelry_catalogue (is_published, category, display_order);
CREATE INDEX IF NOT EXISTS idx_catalogue_created_at ON public.jewelry_catalogue (created_at DESC);

ALTER TABLE public.jewelry_catalogue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Catalogue items public read" ON public.jewelry_catalogue;
CREATE POLICY "Catalogue items public read"
ON public.jewelry_catalogue FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Catalogue items write" ON public.jewelry_catalogue;
CREATE POLICY "Catalogue items write"
ON public.jewelry_catalogue FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Ensure catalogue_items table/view compatibility
CREATE TABLE IF NOT EXISTS public.catalogue_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference        TEXT UNIQUE,
    name             VARCHAR(160) NOT NULL,
    title            VARCHAR(160) NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    category         VARCHAR(60) NOT NULL DEFAULT 'Ear',
    subcategory      VARCHAR(80) NOT NULL DEFAULT '',
    material         VARCHAR(120) NOT NULL DEFAULT '',
    specs            TEXT NOT NULL DEFAULT '',
    price            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    sizes            TEXT[] NOT NULL DEFAULT '{}',
    active_size      VARCHAR(40) NOT NULL DEFAULT '',
    social_media     VARCHAR(40) NOT NULL DEFAULT 'Instagram',
    social_order_url TEXT NOT NULL DEFAULT '',
    image_url        TEXT NOT NULL DEFAULT '',
    thumbnail_url    TEXT NOT NULL DEFAULT '',
    images           TEXT[] NOT NULL DEFAULT '{}',
    is_active        BOOLEAN NOT NULL DEFAULT true,
    is_published     BOOLEAN NOT NULL DEFAULT true,
    display_order    INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.catalogue_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Catalogue items alias public read" ON public.catalogue_items;
CREATE POLICY "Catalogue items alias public read" ON public.catalogue_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Catalogue items alias write" ON public.catalogue_items;
CREATE POLICY "Catalogue items alias write" ON public.catalogue_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 5. GALLERY ITEMS (and gallery_images compatibility)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gallery_images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(120) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    subcategory   VARCHAR(80) NOT NULL DEFAULT '',
    body_part     VARCHAR(60) DEFAULT '',
    artist_id     UUID,
    tags          TEXT[] NOT NULL DEFAULT '{}',
    image_url     TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL DEFAULT '',
    alt_text      TEXT NOT NULL DEFAULT '',
    is_published  BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS subcategory VARCHAR(80) DEFAULT '';
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS body_part VARCHAR(60) DEFAULT '';
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS artist_id UUID;
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT '';
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS alt_text TEXT DEFAULT '';
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true;
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
ALTER TABLE public.gallery_images ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_gallery_published ON public.gallery_images (is_published, category);
CREATE INDEX IF NOT EXISTS idx_gallery_created_at ON public.gallery_images (created_at DESC);

ALTER TABLE public.gallery_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gallery public read" ON public.gallery_images;
CREATE POLICY "Gallery public read"
ON public.gallery_images FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Gallery write" ON public.gallery_images;
CREATE POLICY "Gallery write"
ON public.gallery_images FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.gallery_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(120) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    subcategory   VARCHAR(80) NOT NULL DEFAULT '',
    body_part     VARCHAR(60) DEFAULT '',
    artist_id     UUID,
    tags          TEXT[] NOT NULL DEFAULT '{}',
    image_url     TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL DEFAULT '',
    alt_text      TEXT NOT NULL DEFAULT '',
    is_published  BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.gallery_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Gallery items alias public read" ON public.gallery_items;
CREATE POLICY "Gallery items alias public read" ON public.gallery_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Gallery items alias write" ON public.gallery_items;
CREATE POLICY "Gallery items alias write" ON public.gallery_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 6. SITE CONTENT & SITE SETTINGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site settings public read" ON public.site_settings;
CREATE POLICY "Site settings public read"
ON public.site_settings FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Site settings write" ON public.site_settings;
CREATE POLICY "Site settings write"
ON public.site_settings FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

INSERT INTO public.site_settings (key, value)
VALUES
    ('home', '{}'::jsonb),
    ('booking', '{}'::jsonb),
    ('admin_revenue', '{"monthly": {}}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.site_content (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Site content public read" ON public.site_content;
CREATE POLICY "Site content public read" ON public.site_content FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Site content write" ON public.site_content;
CREATE POLICY "Site content write" ON public.site_content FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 7. ARTIST PROFILES & FAQS
-- -----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_artist_profiles_order ON public.artist_profiles (display_order, created_at);
ALTER TABLE public.artist_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Artist profiles access" ON public.artist_profiles;
CREATE POLICY "Artist profiles access" ON public.artist_profiles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

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

CREATE INDEX IF NOT EXISTS idx_faqs_order ON public.faqs (is_published, display_order, created_at);
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FAQs access" ON public.faqs;
CREATE POLICY "FAQs access" ON public.faqs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 8. SITE IMAGES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section       TEXT NOT NULL,
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

ALTER TABLE public.site_images ADD COLUMN IF NOT EXISTS artist_id UUID REFERENCES public.artist_profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_site_images_section_order ON public.site_images (section, display_order);
CREATE INDEX IF NOT EXISTS idx_site_images_artist_order ON public.site_images (artist_id, display_order);

ALTER TABLE public.site_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Site images access" ON public.site_images;
CREATE POLICY "Site images access" ON public.site_images FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 9. NOTIFICATIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id            TEXT PRIMARY KEY,
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    recipient     TEXT NOT NULL DEFAULT '',
    type          VARCHAR(50) NOT NULL DEFAULT 'booking',
    title         TEXT NOT NULL DEFAULT '',
    message       TEXT NOT NULL DEFAULT '',
    reference     VARCHAR(50) NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    details       JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_read       BOOLEAN NOT NULL DEFAULT false,
    read_at       TIMESTAMPTZ,
    email_sent    BOOLEAN NOT NULL DEFAULT false,
    email_error   TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS recipient TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'booking';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS reference VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS email_error TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications (created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications access" ON public.notifications;
CREATE POLICY "Notifications access"
ON public.notifications FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 10. REVIEWS & PROFILES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email           TEXT NOT NULL DEFAULT '',
    display_name    TEXT NOT NULL DEFAULT '',
    photo_url       TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.public_profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name    TEXT NOT NULL DEFAULT '',
    photo_url       TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reviewer_name       TEXT NOT NULL DEFAULT '',
    reviewer_photo_url  TEXT NOT NULL DEFAULT '',
    rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body                TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
    photo_url           TEXT NOT NULL DEFAULT '',
    is_published        BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewer_photo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_reviews_ranking ON public.reviews (is_published, rating DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON public.reviews (user_id, created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
CREATE POLICY "Users can read their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Public profiles are readable" ON public.public_profiles;
CREATE POLICY "Public profiles are readable" ON public.public_profiles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert their own public profile" ON public.public_profiles;
CREATE POLICY "Users can insert their own public profile" ON public.public_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own public profile" ON public.public_profiles;
CREATE POLICY "Users can update their own public profile" ON public.public_profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Reviews Policies
DROP POLICY IF EXISTS "Published reviews are public" ON public.reviews;
CREATE POLICY "Published reviews are public"
ON public.reviews FOR SELECT
TO anon, authenticated
USING (is_published = true OR auth.uid() = user_id OR public.is_studio_admin());

DROP POLICY IF EXISTS "Clients can post their own review" ON public.reviews;
CREATE POLICY "Clients can post their own review"
ON public.reviews FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients can update their own review" ON public.reviews;
CREATE POLICY "Clients can update their own review"
ON public.reviews FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR public.is_studio_admin())
WITH CHECK (auth.uid() = user_id OR public.is_studio_admin());

DROP POLICY IF EXISTS "Clients can delete their own review" ON public.reviews;
CREATE POLICY "Clients can delete their own review"
ON public.reviews FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR public.is_studio_admin());

-- User creation trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_name TEXT := coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'display_name',
        new.raw_user_meta_data ->> 'name',
        ''
    );
    new_photo TEXT := coalesce(
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture',
        ''
    );
BEGIN
    INSERT INTO public.profiles (id, email, display_name, photo_url)
    VALUES (new.id, coalesce(new.email, ''), new_name, new_photo)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.public_profiles (id, display_name, photo_url)
    VALUES (new.id, new_name, new_photo)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Review identity sync trigger
CREATE OR REPLACE FUNCTION public.sync_review_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    profile_name TEXT := '';
    profile_photo TEXT := '';
    metadata_name TEXT := '';
    metadata_photo TEXT := '';
    email_name TEXT := '';
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.user_id := auth.uid();
    END IF;

    IF to_regclass('public.public_profiles') IS NOT NULL AND NEW.user_id IS NOT NULL THEN
        SELECT display_name, photo_url
          INTO profile_name, profile_photo
          FROM public.public_profiles
         WHERE id = NEW.user_id;
    END IF;

    metadata_name := coalesce(
        auth.jwt() -> 'user_metadata' ->> 'full_name',
        auth.jwt() -> 'user_metadata' ->> 'display_name',
        auth.jwt() -> 'user_metadata' ->> 'name',
        ''
    );
    metadata_photo := coalesce(
        auth.jwt() -> 'user_metadata' ->> 'avatar_url',
        auth.jwt() -> 'user_metadata' ->> 'picture',
        ''
    );

    email_name := split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1);
    email_name := regexp_replace(email_name, '[._-]+', ' ', 'g');
    email_name := regexp_replace(email_name, '\s+', ' ', 'g');
    email_name := btrim(email_name);

    NEW.reviewer_name := coalesce(
        nullif(btrim(NEW.reviewer_name), ''),
        nullif(btrim(profile_name), ''),
        nullif(btrim(metadata_name), ''),
        nullif(btrim(email_name), ''),
        'Paulina Client'
    );

    NEW.reviewer_photo_url := coalesce(
        nullif(btrim(NEW.reviewer_photo_url), ''),
        nullif(btrim(profile_photo), ''),
        nullif(btrim(metadata_photo), ''),
        ''
    );

    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_sync_identity ON public.reviews;
CREATE TRIGGER reviews_sync_identity
    BEFORE INSERT OR UPDATE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.sync_review_identity();

-- -----------------------------------------------------------------------------
-- 11. SCHEMA GRANTS
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 12. REALTIME PUBLICATIONS
-- -----------------------------------------------------------------------------
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.custom_requests REPLICA IDENTITY FULL;
ALTER TABLE public.jewelry_catalogue REPLICA IDENTITY FULL;
ALTER TABLE public.catalogue_items REPLICA IDENTITY FULL;
ALTER TABLE public.gallery_images REPLICA IDENTITY FULL;
ALTER TABLE public.gallery_items REPLICA IDENTITY FULL;
ALTER TABLE public.site_settings REPLICA IDENTITY FULL;
ALTER TABLE public.site_images REPLICA IDENTITY FULL;
ALTER TABLE public.artist_profiles REPLICA IDENTITY FULL;
ALTER TABLE public.faqs REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.reviews REPLICA IDENTITY FULL;

DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'bookings',
        'custom_requests',
        'jewelry_catalogue',
        'catalogue_items',
        'gallery_images',
        'gallery_items',
        'site_settings',
        'site_images',
        'artist_profiles',
        'faqs',
        'notifications',
        'reviews'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = tbl
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
        END IF;
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. RELOAD SCHEMA CACHE
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

