/**
 * ============================================================================
 * AUTH CALLBACK - SUPABASE OAUTH / EMAIL CONFIRMATION
 * ============================================================================
 *
 * Supabase redirects here after OAuth (e.g. Google) or email confirmation links.
 * Detects session, exchanges auth codes if present, syncs profile, and routes
 * users to admin or home dashboard based on role.
 */

import { supabase } from "./supabase-config.js";
import {
  getCurrentUser,
  isStudioAdmin,
  isAuthConfigured,
  saveUserProfile,
  signOut
} from "./services/authService.js";

const HOME_URL = "home.html";
const CREATE_ACCOUNT_URL = "create_acc.html";
const SIGNUP_INTENT_KEY = "paulina:signup-intent";
// A new Google account is created seconds before this callback runs. An older
// created_at therefore means the address already belonged to an account.
const NEW_ACCOUNT_WINDOW_MS = 60 * 1000;
// An abandoned Google attempt must not affect a later normal sign-in.
const SIGNUP_INTENT_TTL_MS = 10 * 60 * 1000;
const ADMIN_URL = "../admin-side/dashboard.html";
const SIGN_IN_URL = "sign-in.html";

const SESSION_WAIT_MS = 10000;
const POLL_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The Supabase client restores the session asynchronously, so a single
 * getSession() read can return null before the redirect resolves.
 */
async function waitForUser(timeoutMs = SESSION_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const user = await getCurrentUser();
    if (user) return user;
    await sleep(POLL_MS);
  }

  return null;
}

function redirectFor(user) {
  window.location.replace(isStudioAdmin(user) ? ADMIN_URL : HOME_URL);
}

function readSignupIntent() {
  try {
    const raw = sessionStorage.getItem(SIGNUP_INTENT_KEY);
    if (!raw) return null;

    const intent = JSON.parse(raw);
    const age = Date.now() - Number(intent?.at || 0);
    if (!intent?.at || age < 0 || age > SIGNUP_INTENT_TTL_MS) {
      clearSignupIntent();
      return null;
    }

    return intent;
  } catch (error) {
    return null;
  }
}

function clearSignupIntent() {
  try {
    sessionStorage.removeItem(SIGNUP_INTENT_KEY);
  } catch (error) {
    // Storage can be unavailable in private browsing.
  }
}

/**
 * "Continue with Google" on the Sign-Up tab must not silently sign an existing
 * client into an old account. The intent timestamp recorded before the OAuth
 * redirect is compared with the account's created_at: an account that predates
 * the click already existed, so the unintended session is cancelled and the
 * visitor is sent to the sign-in form with their email filled in.
 */
async function cancelExistingAccountSignup(user, intent) {
  const createdAt = new Date(user?.createdAt || 0).getTime();
  const startedAt = Number(intent?.at || 0);

  if (!startedAt || !createdAt) return false;
  if (createdAt >= startedAt - NEW_ACCOUNT_WINDOW_MS) return false;

  try {
    await signOut();
  } catch (error) {
    console.warn("[auth-callback] Could not sign out the duplicate session:", error?.message || error);
  }

  clearSignupIntent();

  const email = String(intent?.email || user?.email || "").trim();
  window.location.replace(
    email
      ? `${CREATE_ACCOUNT_URL}?email=${encodeURIComponent(email)}&notice=existing`
      : `${CREATE_ACCOUNT_URL}?notice=existing`
  );
  return true;
}

async function init() {
  if (!isAuthConfigured()) {
    // Nothing to resolve without a configured project; keep the dark page.
    return;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get("code");

    // detectSessionInUrl normally exchanges the code automatically. This
    // explicit exchange covers the cases where it has not run yet; a
    // failure is non-fatal because the session may already exist.
    if (code) {
      try {
        await supabase.auth.exchangeCodeForSession(code);
      } catch (error) {
        console.warn(
          "[auth-callback] Code exchange was handled by the client:",
          error?.message || error
        );
      }
    }

    const user = await waitForUser();

    if (!user) {
      console.warn("[auth-callback] No session was resolved; returning to sign-in.");
      window.location.replace(SIGN_IN_URL);
      return;
    }

    const intent = readSignupIntent();
    if (intent && (await cancelExistingAccountSignup(user, intent))) return;
    clearSignupIntent();

    try { await saveUserProfile(user); } catch (_) {}

    redirectFor(user);
  } catch (error) {
    console.error("[auth-callback] Sign-in could not be completed:", error);
    window.location.replace(SIGN_IN_URL);
  }
}

document.addEventListener("DOMContentLoaded", init);
