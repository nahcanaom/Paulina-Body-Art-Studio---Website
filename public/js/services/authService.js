/**
 * ============================================================================
 * AUTH SERVICE - SUPABASE
 * ============================================================================
 *
 * One place for every browser authentication action. Supabase users are
 * normalized into the Firebase-style shape the rest of the site already uses
 * (uid, displayName, photoURL, emailVerified), so existing UI keeps working.
 *
 * The same Supabase client instance is shared with the profile, storage and
 * review services, which is what lets an authenticated review carry the
 * signed-in client's identity.
 */

import {
  getAuthCallbackUrl,
  getEmailConfirmRedirectUrl,
  getPasswordResetRedirectUrl,
  getSupabaseClient,
  isAuthConfigured
} from "./supabaseClient.js";

export { isAuthConfigured };

const metadataOf = (user) => user?.user_metadata || {};

/**
 * Converts a raw Supabase user into the compatibility shape used across the
 * site. Returns null for a missing user.
 */
export function normalizeUser(rawUser) {
  if (!rawUser) return null;

  const metadata = metadataOf(rawUser);

  return {
    uid: rawUser.id,
    id: rawUser.id,
    email: rawUser.email || "",
    displayName:
      metadata.full_name ||
      metadata.display_name ||
      metadata.name ||
      "",
    photoURL:
      metadata.avatar_url ||
      metadata.picture ||
      metadata.photo_url ||
      "",
    emailVerified: Boolean(rawUser.email_confirmed_at || rawUser.confirmed_at),
    phone: rawUser.phone || "",
    createdAt: rawUser.created_at || "",
    lastSignInAt: rawUser.last_sign_in_at || "",
    userMetadata: metadata,
    raw: rawUser
  };
}

/** Returns the signed-in user, or null. Never throws for a signed-out visitor. */
export async function getCurrentUser() {
  if (!isAuthConfigured()) return null;

  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return normalizeUser(data?.session?.user);
  } catch (error) {
    console.warn("[auth] Could not read the current session:", error?.message || error);
    return null;
  }
}

/**
 * Subscribes to auth changes and resolves once the listener is installed.
 * The callback also runs immediately with the current user.
 * Returns an async unsubscribe function.
 */
export async function onAuthStateChanged(callback) {
  const client = await getSupabaseClient();
  let active = true;
  let lastState = null;

  const emit = (user) => {
    if (!active) return;

    // Guards against the listener and the awaited session reporting the same
    // state twice, and against stray events firing while the session restores.
    const state = user ? `user:${user.uid}` : 'signed-out';
    if (state === lastState) return;
    lastState = state;

    callback(user);
  };

  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (!active) return;
    // The explicit getCurrentUser() below resolves the restored session; the
    // listener's INITIAL_SESSION can arrive while that read is still pending.
    if (event === 'INITIAL_SESSION') return;
    emit(normalizeUser(session?.user));
  });

  const current = await getCurrentUser();
  emit(current);

  return async () => {
    active = false;
    data?.subscription?.unsubscribe();
  };
}

/**
 * Sign-up always returns to the home page: the confirmation link establishes
 * the session, so the client never has to sign in a second time.
 *
 * When email confirmation is enabled Supabase returns an obfuscated user with
 * an empty identities array for an address that already exists. That case is
 * reported as `account_exists` and any unintended session is discarded, so a
 * duplicate registration can never leave the browser signed in.
 */
export async function signUpWithEmail(email, password, displayName = "") {
  const client = await getSupabaseClient();
  const cleanName = String(displayName || "").trim();

  const { data, error } = await client.auth.signUp({
    email: String(email || "").trim(),
    password,
    options: {
      emailRedirectTo: getEmailConfirmRedirectUrl(),
      data: cleanName ? { full_name: cleanName } : {}
    }
  });

  if (error) throw error;

  const alreadyRegistered =
    Boolean(data?.user) &&
    Array.isArray(data.user.identities) &&
    data.user.identities.length === 0;

  if (alreadyRegistered) {
    // Cancel any session the duplicate sign-up may have created.
    try {
      if (data?.session) await client.auth.signOut();
    } catch (signOutError) {
      console.warn("[auth] Could not clear the duplicate sign-up session:", signOutError?.message);
    }

    const duplicateError = new Error("This email is already tied to an existing account.");
    duplicateError.code = "account_exists";
    throw duplicateError;
  }

  return {
    user: normalizeUser(data?.user),
    session: data?.session || null,
    // With email confirmation enabled Supabase returns a user but no session.
    requiresEmailConfirmation: Boolean(data?.user && !data?.session),
    raw: data
  };
}

/**
 * Looks an address up through the SECURITY DEFINER `email_exists` function so
 * the sign-in and sign-up forms can explain which action the visitor needs.
 * Returns true/false when the lookup succeeds, or null when the function has
 * not been deployed yet (the caller then falls back to Supabase's own errors).
 */
export async function checkEmailExists(email) {
  const value = String(email || "").trim();
  if (!value) return null;

  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc("email_exists", { check_email: value });
    if (error) throw error;
    return typeof data === "boolean" ? data : null;
  } catch (error) {
    console.warn(
      "[auth] Email lookup is unavailable; using Supabase sign-in errors instead:",
      error?.message || error
    );
    return null;
  }
}

export async function signInWithEmail(email, password) {
  const client = await getSupabaseClient();

  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || "").trim(),
    password
  });

  if (error) throw error;

  return {
    user: normalizeUser(data?.user),
    session: data?.session || null,
    raw: data
  };
}

export async function signInWithGoogle() {
  const client = await getSupabaseClient();

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthCallbackUrl(),
      queryParams: { prompt: "select_account" }
    }
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = await getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordResetEmail(email) {
  const client = await getSupabaseClient();

  const { error } = await client.auth.resetPasswordForEmail(String(email || "").trim(), {
    redirectTo: getPasswordResetRedirectUrl()
  });

  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const client = await getSupabaseClient();

  const { data, error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return normalizeUser(data?.user);
}

/**
 * Updates the account's display name and avatar in Supabase auth metadata.
 * Profile tables are written separately by the profile service.
 */
export async function updateProfile(user, { displayName, photoURL } = {}) {
  const client = await getSupabaseClient();
  const data = {};

  if (typeof displayName === "string") data.full_name = displayName.trim();
  if (typeof photoURL === "string") data.avatar_url = photoURL.trim();

  const { data: result, error } = await client.auth.updateUser({ data });
  if (error) throw error;
  return normalizeUser(result?.user || user);
}

export async function updateEmail(_user, email) {
  const client = await getSupabaseClient();

  const { data, error } = await client.auth.updateUser({
    email: String(email || "").trim()
  });

  if (error) throw error;
  return normalizeUser(data?.user);
}

/**
 * Deletes the signed-in account.
 *
 * Supabase does not let a browser client delete users directly, so this calls
 * a SECURITY DEFINER SQL function named `delete_own_account` that removes the
 * row for auth.uid(). If that function has not been created the call rejects
 * and the settings page asks the user to contact the studio instead of
 * pretending the account was removed.
 */
export async function deleteAccount() {
  const client = await getSupabaseClient();

  const { error } = await client.rpc("delete_own_account");
  if (error) throw error;
}

const AUTH_ERROR_MESSAGES = [
  [/invalid login credentials/i, "The email or password you entered is incorrect."],
  [/email not confirmed/i, "Please confirm your email address before signing in."],
  [/user already registered|already been registered/i, "This email is already tied to an existing account. Please sign in instead."],
  [/password should be at least|password is too short/i, "Your password must be at least 8 characters."],
  [/unable to validate email|invalid email/i, "Please enter a valid email address."],
  [/rate limit|too many requests/i, "Too many attempts. Please wait a moment and try again."],
  [/provider is not enabled/i, "Google sign-in is not enabled for this project yet."],
  [/redirect_uri_mismatch|redirect url/i, "The sign-in redirect URL is not allowed. Check the Supabase URL configuration."],
  [/network|failed to fetch/i, "We could not reach the sign-in service. Check your connection and try again."]
];

/**
 * Converts a Supabase auth error into a friendly, displayable message.
 */
export function resolveAuthError(error) {
  const technicalMessage = String(error?.message || error || "").trim();
  const code = String(error?.code || error?.status || "").trim();

  if (code === "account_exists") {
    return {
      code,
      message: "This email is already tied to an existing account. Please sign in instead.",
      technicalMessage
    };
  }

  for (const [pattern, message] of AUTH_ERROR_MESSAGES) {
    if (pattern.test(technicalMessage)) {
      return { code, message, technicalMessage };
    }
  }

  return {
    code,
    message: technicalMessage
      ? `We could not complete that request: ${technicalMessage}`
      : "Something went wrong. Please try again.",
    technicalMessage
  };
}




export async function saveUserProfile(user, fullName = "") {
  if (!user || (!user.id && !user.uid)) return;

  const client = await getSupabaseClient();
  const userId = user.id || user.uid;
  const userEmail = user.email || "";
  
  const nameToSave =
    fullName ||
    user.displayName ||
    user.user_metadata?.full_name ||
    user.user_metadata?.display_name ||
    (userEmail ? userEmail.split("@")[0] : "Client User");

  const roleToSave =
    user.userMetadata?.role ||
    user.user_metadata?.role ||
    "Client";

  try {
    const { error } = await client.from("users").upsert(
      [
        {
          id: userId,
          email: userEmail,
          full_name: nameToSave,
          role: roleToSave
        }
      ],
      { onConflict: "id" }
    );

    if (error) {
      console.warn("[saveUserProfile] Warning during profile sync:", error.message);
    }
  } catch (err) {
    console.warn("[saveUserProfile] Exception during profile sync (non-fatal):", err);
  }
}