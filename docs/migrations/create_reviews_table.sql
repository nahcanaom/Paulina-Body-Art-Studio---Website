-- =============================================================================
-- PAULINA BODY ART STUDIO — ACCOUNT PROFILES + CUSTOMER REVIEWS
-- =============================================================================
-- Run this once in the Supabase SQL Editor before using the Reviews page,
-- account settings, or the "Share your experience" form.
--
-- This one file provisions everything the review identity system needs:
--
--   public.profiles             private account profile (name, email, avatar)
--   public.public_profiles      public display name + avatar shown on reviews
--   public.reviews              star rating + written review per client
--   new-user trigger            creates both profile rows on sign-up
--   reviews identity trigger    copies the authenticated client's name/avatar
--                               onto every review row
--   RLS policies                published reviews are public; clients can only
--                               write and manage their own profile/review
--
-- The website writes with the Supabase anon key. A signed-in client's JWT is
-- what lets the policies below accept an insert, so a review always belongs to
-- the account that submitted it.
--
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. ACCOUNT PROFILES
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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
CREATE POLICY "Users can read their own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Public profiles are readable" ON public.public_profiles;
CREATE POLICY "Public profiles are readable"
ON public.public_profiles FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Users can insert their own public profile" ON public.public_profiles;
CREATE POLICY "Users can insert their own public profile"
ON public.public_profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own public profile" ON public.public_profiles;
CREATE POLICY "Users can update their own public profile"
ON public.public_profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.public_profiles TO authenticated;

-- Profile picture bucket used by account settings. Public reads, owner-only
-- writes under profile_pictures/<user-id>/....
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile_pictures', 'profile_pictures', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Profile pictures are publicly readable" ON storage.objects;
CREATE POLICY "Profile pictures are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile_pictures');

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
)
WITH CHECK (
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

-- Create blank profile rows for every new account. The client also upserts
-- these rows, so the trigger is a safety net rather than a requirement.
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

-- -----------------------------------------------------------------------------
-- 2. REVIEWS TABLE
-- -----------------------------------------------------------------------------
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

-- Tolerate projects that created an early draft of the table.
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewer_photo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_reviews_public_ranking
    ON public.reviews (is_published, rating DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_user
    ON public.reviews (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. REVIEW IDENTITY SYNC
-- -----------------------------------------------------------------------------
-- reviewer_name and reviewer_photo_url are snapshots, but the website also
-- reads public.public_profiles live. The trigger guarantees a review can never
-- be posted with a false or generic name ("Anonymous Client"): the server fills
-- in the authenticated account's public name (or, if no profile row exists yet,
-- the name in the auth metadata / email address).
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
    -- Always trust the authenticated account, never the browser payload.
    NEW.user_id := auth.uid();

    IF to_regclass('public.public_profiles') IS NOT NULL THEN
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

    -- Deliberately ignore reviewer_name / reviewer_photo_url supplied by the
    -- browser. Only the server-verified account identity is trusted.
    NEW.reviewer_name := coalesce(
        nullif(btrim(profile_name), ''),
        nullif(btrim(metadata_name), ''),
        nullif(btrim(email_name), ''),
        -- Account-derived even when the local part has no letters.
        nullif(btrim(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)), ''),
        'Paulina Client'
    );

    NEW.reviewer_photo_url := coalesce(
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
-- 4. REVIEW ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Published reviews are public" ON public.reviews;
CREATE POLICY "Published reviews are public"
ON public.reviews FOR SELECT
TO anon, authenticated
USING (is_published = true OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients can post their own review" ON public.reviews;
CREATE POLICY "Clients can post their own review"
ON public.reviews FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients can update their own review" ON public.reviews;
CREATE POLICY "Clients can update their own review"
ON public.reviews FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clients can delete their own review" ON public.reviews;
CREATE POLICY "Clients can delete their own review"
ON public.reviews FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;

-- Ask PostgREST to pick up the new tables immediately.
NOTIFY pgrst, 'reload schema';
