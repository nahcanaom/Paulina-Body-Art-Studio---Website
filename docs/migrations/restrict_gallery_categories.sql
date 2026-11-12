-- =============================================================================
-- PAULINA BODY ART STUDIO: RESTRICT GALLERY CATEGORIES TO FACE / BODY
-- =============================================================================
-- Run this once in the Supabase SQL Editor on an existing database.
--
-- The public gallery no longer has "Tattoos" and "Piercing" tabs; it filters by
-- Face and Body (plus All). This migration:
--   1. maps existing rows to Face or Body using their stored subcategory,
--   2. adds a CHECK constraint so no other category can be written,
--   3. keeps the subcategory values aligned with the two categories.
--
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

-- 1. Map legacy categories before the constraint is added.
UPDATE public.gallery_images
   SET category = CASE
     WHEN lower(coalesce(category, '')) IN ('face', 'body')
       THEN initcap(lower(category))
     WHEN lower(coalesce(subcategory, '')) LIKE '%face%'
       OR lower(coalesce(subcategory, '')) LIKE '%ear%'
       OR lower(coalesce(subcategory, '')) LIKE '%facial%'
       THEN 'Face'
     ELSE 'Body'
   END
 WHERE category IS NULL
    OR lower(category) NOT IN ('face', 'body');

-- Empty subcategories are labelled after the category they belong to.
UPDATE public.gallery_images
   SET subcategory = CASE
     WHEN category = 'Face' THEN 'Face tattoos'
     ELSE 'Body tattoos'
   END
 WHERE subcategory IS NULL OR btrim(subcategory) = '';

-- 2. Only Face and Body may be stored.
ALTER TABLE public.gallery_images
    DROP CONSTRAINT IF EXISTS gallery_images_category_check;

ALTER TABLE public.gallery_images
    ADD CONSTRAINT gallery_images_category_check
    CHECK (category IN ('Face', 'Body'));

-- 3. The gallery CMS offers these subcategories only.
ALTER TABLE public.gallery_images
    DROP CONSTRAINT IF EXISTS gallery_images_subcategory_check;

ALTER TABLE public.gallery_images
    ADD CONSTRAINT gallery_images_subcategory_check
    CHECK (subcategory IN ('Face tattoos', 'Face piercing', 'Body tattoos', 'Body piercing'));

COMMENT ON COLUMN public.gallery_images.category IS
    'Public gallery category. One of: Face, Body.';

NOTIFY pgrst, 'reload schema';
