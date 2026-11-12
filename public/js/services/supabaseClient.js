/**
 * ============================================================================
 * SUPABASE CLIENT (SHARED SINGLETON)
 * ============================================================================
 *
 * There must be exactly one Supabase client per page: every GoTrue instance
 * that shares an auth storage key can emit its own SIGNED_IN / SIGNED_OUT
 * events, which makes session state flaky on the routes that redirect.
 *
 * js/supabase-config.js owns the instance (the services import it directly),
 * and this helper hands out the same one for the code that resolves it lazily.
 */

import { supabase, supabaseConfig, isSupabaseConfigured } from "../supabase-config.js";

/**
 * Synchronous configuration check used by UI code before it binds handlers.
 */
export function isAuthConfigured() {
  return isSupabaseConfigured(supabaseConfig);
}

/**
 * Exposes the active configuration to services without letting them mutate it.
 */
export function getSupabaseConfig() {
  return supabaseConfig;
}

/**
 * Resolves a configured redirect path into an absolute URL.
 * Absolute URLs are returned unchanged.
 */
export function buildRedirectUrl(path) {
  const value = String(path || "").trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window === "undefined") return value;
  return new URL(value, window.location.href).toString();
}

/**
 * Resolves a site path against the current origin (never the current page), so
 * email links land on the right file from localhost, a dev tunnel or the live
 * domain alike.
 */
export function buildOriginUrl(path) {
  const value = String(path || "").trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window === "undefined") return value;
  return new URL(value, window.location.origin).toString();
}

/**
 * Returns the URL that OAuth providers and email-confirmation links return to.
 */
export function getAuthCallbackUrl() {
  return buildRedirectUrl(supabaseConfig.redirects?.authCallbackPath);
}

/**
 * Returns the URL embedded in the sign-up confirmation email. Confirming an
 * address establishes the session, so the client lands straight on the home
 * page instead of being asked to sign in again.
 */
export function getEmailConfirmRedirectUrl() {
  return buildOriginUrl(
    supabaseConfig.redirects?.emailConfirmPath || "/html/user-side/home.html"
  );
}

/**
 * Returns the URL embedded in password-reset emails.
 */
export function getPasswordResetRedirectUrl() {
  return buildRedirectUrl(supabaseConfig.redirects?.passwordResetPath);
}

/**
 * Returns the shared Supabase browser client.
 */
export async function getSupabaseClient() {
  if (!isAuthConfigured()) {
    const error = new Error(
      "Supabase is not configured. Add your project URL and anon key to js/supabase-config.js."
    );
    error.code = "supabase_not_configured";
    throw error;
  }

  return supabase;
}
