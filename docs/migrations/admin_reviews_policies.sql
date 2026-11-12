-- =============================================================================
-- PAULINA BODY ART STUDIO: ADMIN ACCESS TO CLIENT REVIEWS
-- =============================================================================
-- Run this once in the Supabase SQL Editor.
--
-- The public reviews policies in create_reviews_table.sql let a client manage
-- only their own review. The Admin > Reviews CMS needs to read every review
-- (including hidden ones) and edit or delete any of them.
--
-- Access is granted by email claim so the studio admin account can manage the
-- reviews from html/admin-side/admin-editweb.html. Replace or extend the list
-- below if the studio uses more than one admin address.
--
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_studio_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(lower(auth.jwt() ->> 'email'), '') IN (
        'paulinabodyartstudio@gmail.com'
    )
    OR coalesce(lower(auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin';
$$;

DROP POLICY IF EXISTS "Studio admins read every review" ON public.reviews;
CREATE POLICY "Studio admins read every review"
ON public.reviews FOR SELECT
TO authenticated
USING (public.is_studio_admin());

DROP POLICY IF EXISTS "Studio admins update reviews" ON public.reviews;
CREATE POLICY "Studio admins update reviews"
ON public.reviews FOR UPDATE
TO authenticated
USING (public.is_studio_admin())
WITH CHECK (public.is_studio_admin());

DROP POLICY IF EXISTS "Studio admins delete reviews" ON public.reviews;
CREATE POLICY "Studio admins delete reviews"
ON public.reviews FOR DELETE
TO authenticated
USING (public.is_studio_admin());

-- Realtime keeps the admin list and the public reviews page in sync.
ALTER TABLE public.reviews REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'reviews'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.reviews;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
