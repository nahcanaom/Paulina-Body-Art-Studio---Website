/**
 * ============================================================================
 * RESET PASSWORD - SUPABASE RECOVERY FLOW
 * ============================================================================
 *
 * Supabase password-reset emails land here with a temporary recovery session.
 * The user chooses a new password, then is signed out and sent to sign-in.
 */

import {
  getCurrentUser,
  isAuthConfigured,
  resolveAuthError,
  signOut,
  updatePassword
} from "./services/authService.js";

const form = document.querySelector("[data-reset-password-form]");
const passwordInput = document.getElementById("new-password");
const confirmInput = document.getElementById("confirm-password");
const messageEl = document.getElementById("reset-message");
const submitButton = form?.querySelector("[type='submit']");

function showMessage(text) {
  if (messageEl) messageEl.textContent = text;
}

function setFormEnabled(enabled) {
  if (submitButton) submitButton.disabled = !enabled;
  if (passwordInput) passwordInput.disabled = !enabled;
  if (confirmInput) confirmInput.disabled = !enabled;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUser(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const user = await getCurrentUser();
    if (user) return user;
    await sleep(250);
  }

  return null;
}

// Reuse the same show/hide password behavior as the sign-in pages.
document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
  const input = document.getElementById(toggle.getAttribute("aria-controls"));
  const icon = toggle.querySelector("i");
  if (!input || !icon) return;

  toggle.addEventListener("click", () => {
    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    toggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(shouldShow));
    icon.classList.toggle("ph-eye", !shouldShow);
    icon.classList.toggle("ph-eye-slash", shouldShow);
  });
});

async function init() {
  setFormEnabled(false);

  if (!isAuthConfigured()) {
    showMessage("Password reset is not configured yet.");
    return;
  }

  try {
    const user = await waitForUser();

    if (!user) {
      showMessage("This reset link is invalid or has expired. Request a new link from the sign-in page.");
      return;
    }

    setFormEnabled(true);
    showMessage("Choose a new password for your account.");
    passwordInput?.focus();
  } catch (error) {
    console.error("Could not start the password reset flow:", error);
    showMessage(resolveAuthError(error).message);
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = passwordInput?.value || "";
  const confirmation = confirmInput?.value || "";

  if (password.length < 8) {
    showMessage("Your password must be at least 8 characters.");
    passwordInput?.focus();
    return;
  }

  if (password !== confirmation) {
    showMessage("Your passwords do not match.");
    confirmInput?.focus();
    return;
  }

  setFormEnabled(false);
  showMessage("Updating password...");

  try {
    await updatePassword(password);
    // The recovery session is no longer needed: sign out so the client has to
    // prove the new password works.
    await signOut();
    showMessage("Password updated! Redirecting to sign in...");
    setTimeout(
      () => window.location.assign("sign-in.html?reset=success"),
      1200
    );
  } catch (error) {
    showMessage(resolveAuthError(error).message);
    setFormEnabled(true);
  }
});

document.addEventListener("DOMContentLoaded", init);
