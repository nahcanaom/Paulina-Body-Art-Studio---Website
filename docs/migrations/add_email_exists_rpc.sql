-- =============================================================================
-- PAULINA BODY ART STUDIO: email_exists() LOOKUP FOR THE AUTH FORMS
-- =============================================================================
-- Run this once in the Supabase SQL Editor.
--
-- Supabase deliberately returns the same "invalid login credentials" error for
-- an unknown address and a wrong password, and the sign-up flow returns an
-- obfuscated user for an address that already exists. The sign-in, sign-up and
-- Google buttons use this function to tell the visitor which action they need:
--
--   * sign in with an email that has no account  -> "create one?" + prefill
--   * sign up (manual or Google) with an existing account -> "sign in" + prefill
--
-- SECURITY NOTE: this is a boolean oracle, so it lets a visitor test whether an
-- address is registered. That is the trade-off the flow requires; keep an eye
-- on Supabase Auth rate limits and remove the `anon` grant below if the studio
-- ever needs to hide account existence.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.email_exists(check_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text := lower(btrim(coalesce(check_email, '')));
  found boolean := false;
BEGIN
  IF normalized = '' THEN
    RETURN false;
  END IF;

  -- Application profile table (id / email / full_name / role).
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.users WHERE lower(email) = $1)'
      INTO found
      USING normalized;
  END IF;

  -- Authoritative auth records, in case a confirmation is still pending and no
  -- profile row has been written yet.
  IF NOT found AND to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = $1)'
      INTO found
      USING normalized;
  END IF;

  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_exists(text) TO anon, authenticated;

COMMENT ON FUNCTION public.email_exists(text) IS
  'Returns true when an auth account exists for the address. Used by the sign-in and sign-up forms.';

NOTIFY pgrst, 'reload schema';
