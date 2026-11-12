-- =============================================================================
-- PAULINA BODY ART STUDIO: GALLERY TABS + SECTIONS
-- =============================================================================
-- Run this once in the Supabase SQL Editor on an existing database.
--
-- The gallery page now has two tabs, and each tab shows its own numbered
-- editorial sections:
--
--     PIERCING TAB            TATTOOS TAB
--     01 Face Piercing        01 Face Tattoo
--     02 Body Piercing        02 Body Tattoo
--
-- The table is named public.gallery_images in this project; older docs call it
-- GALLERY_ITEMS. This migration:
--   1. drops the previous CHECK constraints,
--   2. rewrites legacy rows ("Face", "Body", "Tattoo", "Tattoos",
--      "Ear Piercing", "Face tattoos", "Body piercing") to the four sections,
--      using body_part to split tattoos into face and body,
--   3. keeps category and subcategory in sync,
--   4. re-adds CHECK constraints so no other value can be written again.
--
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

-- 1. Remove the previous constraints so the values can be rewritten.
ALTER TABLE public.gallery_images
    DROP CONSTRAINT IF EXISTS gallery_images_category_check;

ALTER TABLE public.gallery_images
    DROP CONSTRAINT IF EXISTS gallery_images_subcategory_check;

-- 2. Map legacy rows onto the four sections, most specific match first.
UPDATE public.gallery_images
   SET category = CASE
     WHEN lower(coalesce(category, ''))    LIKE '%face%tattoo%'
       OR lower(coalesce(subcategory, '')) LIKE '%face%tattoo%'
       THEN 'Face Tattoo'
     WHEN lower(coalesce(category, ''))    LIKE '%body%tattoo%'
       OR lower(coalesce(subcategory, '')) LIKE '%body%tattoo%'
       THEN 'Body Tattoo'
     WHEN lower(coalesce(category, ''))    LIKE '%tattoo%'
       OR lower(coalesce(subcategory, '')) LIKE '%tattoo%'
       THEN CASE
         WHEN lower(coalesce(body_part, '')) ~
              '\m(face|facial|head|forehead|temple|eyebrow|eyelid|eye|nose|nostril|septum|bridge|cheek|lip|labret|philtrum|medusa|chin|jaw|tongue|smiley|dimple|ear|helix|lobe|conch|tragus|daith|rook|industrial|snug)\M'
           THEN 'Face Tattoo'
         ELSE 'Body Tattoo'
       END
     WHEN lower(coalesce(category, ''))    LIKE '%face%pierc%'
       OR lower(coalesce(subcategory, '')) LIKE '%face%pierc%'
       OR lower(coalesce(category, ''))    LIKE '%ear%pierc%'
       OR lower(coalesce(subcategory, '')) LIKE '%ear%pierc%'
       THEN 'Face Piercing'
     WHEN lower(coalesce(category, ''))    LIKE '%body%pierc%'
       OR lower(coalesce(subcategory, '')) LIKE '%body%pierc%'
       THEN 'Body Piercing'
     WHEN lower(coalesce(category, ''))    LIKE '%body%'
       THEN 'Body Piercing'
     ELSE 'Face Piercing'
   END;

-- 3. The stored subcategory mirrors the section, which is what the public
--    gallery reads when it groups the portfolio.
UPDATE public.gallery_images
   SET subcategory = category;

-- 4. Only the four sections may be stored from now on.
ALTER TABLE public.gallery_images
    ADD CONSTRAINT gallery_images_category_check
    CHECK (category IN ('Face Tattoo', 'Body Tattoo', 'Face Piercing', 'Body Piercing'));

ALTER TABLE public.gallery_images
    ADD CONSTRAINT gallery_images_subcategory_check
    CHECK (subcategory IN ('Face Tattoo', 'Body Tattoo', 'Face Piercing', 'Body Piercing'));

COMMENT ON COLUMN public.gallery_images.category IS
    'Public gallery section. One of: Face Tattoo, Body Tattoo, Face Piercing, Body Piercing.';

COMMENT ON COLUMN public.gallery_images.subcategory IS
    'Mirrors category so older clients keep grouping correctly.';

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ENUM PROJECTS ONLY
-- =============================================================================
-- If this project stores the section in a custom enum instead of a text
-- column, add the new labels first. ALTER TYPE ... ADD VALUE must commit before
-- the UPDATE statements above can use it, so run these lines on their own, then
-- re-run the rest of this file:
--
--   ALTER TYPE public.gallery_category ADD VALUE IF NOT EXISTS 'Face Tattoo';
--   ALTER TYPE public.gallery_category ADD VALUE IF NOT EXISTS 'Body Tattoo';
--   ALTER TYPE public.gallery_category ADD VALUE IF NOT EXISTS 'Face Piercing';
--   ALTER TYPE public.gallery_category ADD VALUE IF NOT EXISTS 'Body Piercing';
--
-- Rows still holding an old 'Ear Piercing' label can then be moved with:
--
--   UPDATE public.gallery_images SET category = 'Face Piercing'
--    WHERE category::text = 'Ear Piercing';
