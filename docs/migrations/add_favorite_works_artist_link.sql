-- =============================================================================
-- PAULINA BODY ART STUDIO: LINK FAVORITE WORKS TO ARTISTS
-- =============================================================================
-- Run in the Supabase SQL Editor on an existing database.
--
-- The public artist page now renders one self-contained block per artist:
-- profile details + Favorite Works + Book Your Appointment. Every
-- site_images row in the artist-favorites section must point at the artist
-- whose block should display it.
--
-- Existing favorite rows are assigned to the first artist (ordered by
-- display order) so the artwork already on the site does not disappear.
-- Reassign them from Edit Website > Artists > Favorite Works afterwards.
-- =============================================================================

ALTER TABLE public.site_images
    ADD COLUMN IF NOT EXISTS artist_id UUID
    REFERENCES public.artist_profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_site_images_artist_order
    ON public.site_images (artist_id, display_order);

UPDATE public.site_images
SET artist_id = (
    SELECT id
    FROM public.artist_profiles
    ORDER BY display_order, created_at
    LIMIT 1
)
WHERE section = 'artist-favorites'
  AND artist_id IS NULL;

NOTIFY pgrst, 'reload schema';
