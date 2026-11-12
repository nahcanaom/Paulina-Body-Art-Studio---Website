-- =============================================================================
-- PAULINA BODY ART STUDIO: DYNAMIC SITE IMAGES
-- =============================================================================
-- This table is already included in create_admin_editweb_tables.sql. This file
-- is an optional standalone copy for projects that provision it separately.
--
-- Run this once in the Supabase SQL Editor before managing images from the
-- Home, Artists, FAQs and Booking Info tabs in the admin dashboard.
--
-- The public pages render every content image from this table:
--
--   home-studio              Home studio photo grid
--   home-services            Home services grid
--   home-artists             Home artist portraits
--   artist-favorites         Artist page Favorite Works (linked by artist_id)
--   pricelist                Home piercing price list
--   booking-side             Booking page side image
--   booking-payment-side     Booking payment page side image
--   booking-qr               Booking payment QR code
--   aftercare-hero-tattoo    Aftercare tattoo hero image
--   aftercare-hero-piercing  Aftercare piercing hero image
--   aftercare-guide          Aftercare piercing guide image
--   aftercare-neilmed        Aftercare NeilMed image
--   aftercare-downsizing     Aftercare jewellery downsizing image
--
-- The table intentionally starts empty. Add the images from the website tab
-- that owns each section; nothing on the public site falls back to a bundled
-- image any more.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

NOTIFY pgrst, 'reload schema';
