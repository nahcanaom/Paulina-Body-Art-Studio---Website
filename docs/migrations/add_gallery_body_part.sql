-- =============================================================================
-- PAULINA BODY ART STUDIO: ADD GALLERY BODY-PART LABEL
-- Run in Supabase SQL Editor on an existing database.
-- Adds the specific body part shown on the public bento gallery cards.
-- =============================================================================

ALTER TABLE public.gallery_images
    ADD COLUMN IF NOT EXISTS body_part VARCHAR(60) DEFAULT '';

COMMENT ON COLUMN public.gallery_images.body_part IS
    'Specific body part shown on the public gallery card (Nose, Septum, Helix, Collarbone...).';
