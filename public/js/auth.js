import {
  checkEmailExists,
  isAuthConfigured,
  resolveAuthError,
  sendPasswordResetEmail,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail
} from './services/authService.js';

const authForm = document.querySelector('[data-auth-mode]');
const googleButton = document.querySelector('[data-google-auth]');
const forgotPasswordButton = document.querySelector('[data-forgot-password]');
const authMessage = document.querySelector('#auth-message');

// Set on the Sign-Up tab before Google OAuth so the callback can tell a brand
// new account from one that already existed.
const SIGNUP_INTENT_KEY = 'paulina:signup-intent';

const NO_ACCOUNT_MESSAGE =
  "You don't have an account with this email yet. Would you like to create one?";
const EXISTING_ACCOUNT_MESSAGE =
  'This email is already tied to an existing account. Please sign in instead.';
const RESET_SUCCESS_MESSAGE =
  'Your password has been updated successfully. Please sign in using your new password.';

/**
 * Renders a status line, optionally followed by an inline action link so the
 * visitor can switch between the sign-in and sign-up views with the email
 * already filled in.
 */
function showMessage(text, action = null, tone = '') {
  if (!authMessage) return;

  authMessage.textContent = '';
  authMessage.dataset.tone = tone || '';

  if (!text) return;

  authMessage.append(document.createTextNode(text));

  if (action?.href) {
    const link = document.createElement('a');
    link.className = 'auth-message-link';
    link.href = action.href;
    link.textContent = action.label;
    authMessage.append(document.createTextNode(' '), link);
  }
}

function showError(error) {
  showMessage(resolveAuthError(error).message, null, 'error');
}

function createAccountHref(email) {
  const value = String(email || '').trim();
  return value
    ? `create_acc.html?email=${encodeURIComponent(value)}&notice=no-account`
    : 'create_acc.html';
}

function signInHref(email) {
  const value = String(email || '').trim();
  return value
    ? `sign-in.html?email=${encodeURIComponent(value)}&notice=existing`
    : 'sign-in.html';
}

function showNoAccount(email) {
  showMessage(NO_ACCOUNT_MESSAGE, { href: createAccountHref(email), label: 'Create an account' }, 'error');
}

function showExistingAccount(email) {
  showMessage(
    EXISTING_ACCOUNT_MESSAGE,
    { href: signInHref(email), label: 'Sign in instead' },
    'error'
  );
}

function emailFieldValue() {
  return authForm?.elements?.email?.value?.trim() || '';
}

function validateForm(form) {
  const fields = [...form.querySelectorAll('input[name]')];
  form.querySelectorAll('[data-field-error]').forEach((e) => (e.textContent = ''));
  fields.forEach((f) => f.removeAttribute('aria-invalid'));

  for (const field of fields) {
    if (field.required && !field.value) {
      const msg =
        field.name === 'email'
          ? 'Enter your email address.'
          : field.name === 'fullName'
            ? 'Enter your full name.'
            : field.name === 'password'
              ? 'Enter your password.'
              : 'Enter a value.';
      field.setAttribute('aria-invalid', 'true');
      const el = form.querySelector(`#${field.name}-error`);
      if (el) el.textContent = msg;
      field.focus();
      return false;
    }
    if (field.type === 'email' && field.value && field.validity.typeMismatch) {
      field.setAttribute('aria-invalid', 'true');
      const el = form.querySelector('#email-error');
      if (el) el.textContent = 'Enter a valid email address.';
      return false;
    }
    if (field.minLength && field.value.length < field.minLength) {
      field.setAttribute('aria-invalid', 'true');
      const el = form.querySelector('#password-error');
      if (el) el.textContent = `Password must be at least ${field.minLength} characters.`;
      return false;
    }
    if (field.name === 'confirmPassword' && field.value !== form.elements.password.value) {
      field.setAttribute('aria-invalid', 'true');
      const el = form.querySelector('#confirmPassword-error');
      if (el) el.textContent = 'Passwords do not match.';
      return false;
    }
  }

  if (authMessage) authMessage.textContent = '';
  return true;
}

const ADMIN_EMAILS = new Set(['paulinabodyartstudio@gmail.com']);

function getUserRole(email) {
  return ADMIN_EMAILS.has(String(email || '').toLowerCase()) ? 'admin' : 'Client';
}

function redirectByRole(role) {
  const isAdmin = String(role || '').toLowerCase() === 'admin';
  window.location.assign(
    isAdmin ? '../admin-side/dashboard.html' : '../user-side/home.html'
  );
}


function cacheSignedInUser(user) {
  if (!user) return;

  try {
    localStorage.setItem(
      'paulina_user_profile',
      JSON.stringify({
        uid: user.uid || user.id || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        email: user.email || ''
      })
    );
  } catch (error) {
  }
}

/**
 * Pre-fills the email field and explains why the visitor was sent here: a
 * password reset that just completed, a missing account, or an address that is
 * already registered.
 */
function applyEntryState() {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') || '';
  const notice = params.get('notice') || '';
  const mode = authForm?.dataset.authMode || '';

  if (email && authForm?.elements?.email && !authForm.elements.email.value) {
    authForm.elements.email.value = email;
  }

  if (params.get('reset') === 'success' && mode === 'sign-in') {
    showMessage(RESET_SUCCESS_MESSAGE, null, 'success');
    return;
  }

  // Returned from a blocked duplicate sign-up (manual or Google): the account
  // already exists, so offer the sign-in form with the email kept.
  if (notice === 'existing' && mode === 'create-account') {
    showMessage(
      EXISTING_ACCOUNT_MESSAGE,
      { href: signInHref(email), label: 'Sign in instead' },
      'error'
    );
  }
}

if (authForm) {
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateForm(authForm)) return;

    if (!isAuthConfigured()) {
      showMessage('Authentication is not configured yet.');
      return;
    }

    const email = emailFieldValue();
    const password = authForm.elements.password.value;
    const mode = authForm.dataset.authMode; // 'create-account' or 'sign-in'
    const fullName = authForm.elements.fullName?.value.trim() || '';
    const submitBtn = authForm.querySelector("[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (mode === 'create-account') {
        // Stop before Supabase sends a confirmation link for an address that
        // already has an account.
        const exists = await checkEmailExists(email);
        if (exists === true) {
          showExistingAccount(email);
          return;
        }

        const result = await signUpWithEmail(email, password, fullName);

        if (result.requiresEmailConfirmation) {
          showMessage(
            'Check your inbox to confirm your email address. The link signs you in and takes you straight to the home page.',
            null,
            'success'
          );
          authForm.reset();
          return;
        }

        cacheSignedInUser(result.user);
        redirectByRole(getUserRole(result.user?.email || email));
        return;
      }

      // Sign-in: explain a missing account before Supabase returns the generic
      // "invalid credentials" error, which cannot tell the two cases apart.
      const exists = await checkEmailExists(email);
      if (exists === false) {
        showNoAccount(email);
        return;
      }

      const result = await signInWithEmail(email, password);
      cacheSignedInUser(result.user);
      redirectByRole(getUserRole(result.user?.email || email));
    } catch (error) {
      if (error?.code === 'account_exists') {
        showExistingAccount(email);
      } else {
        showError(error);
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

if (googleButton) {
  googleButton.addEventListener('click', async () => {
    if (!isAuthConfigured()) {
      showMessage('Authentication is not configured yet.');
      return;
    }

    const isSignUpFlow = authForm?.dataset.authMode === 'create-account';
    const typedEmail = emailFieldValue();

    try {
      if (isSignUpFlow) {
        // Google would silently sign in an existing account. Block the
        // duplicate registration when the address is already taken.
        if (typedEmail) {
          const exists = await checkEmailExists(typedEmail);
          if (exists === true) {
            showExistingAccount(typedEmail);
            return;
          }
        }

        try {
          sessionStorage.setItem(
            SIGNUP_INTENT_KEY,
            JSON.stringify({ at: Date.now(), email: typedEmail })
          );
        } catch (storageError) {
          // Private browsing can block storage; the callback falls back to
          // treating the sign-in as a normal one.
        }
      }

      // Supabase redirects the browser to Google; auth-callback.html finishes
      // the flow and stores the session the rest of the site reads.
      await signInWithGoogle();
    } catch (error) {
      showError(error);
    }
  });
}

// Forgot password: send the reset email immediately using the email already
// entered on the sign-in form. No confirmation step is required.
if (forgotPasswordButton) {
  forgotPasswordButton.addEventListener('click', async () => {
    const signinEmail = document.getElementById('signin-email');
    const email = signinEmail ? signinEmail.value.trim() : '';

    if (!email) {
      showMessage('Please enter your email address first.');
      if (signinEmail) signinEmail.focus();
      return;
    }

    if (signinEmail && signinEmail.validity.typeMismatch) {
      showMessage('Please provide a valid email address.');
      signinEmail.focus();
      return;
    }

    if (!isAuthConfigured()) {
      showMessage('Authentication is not configured yet.');
      return;
    }

    forgotPasswordButton.disabled = true;
    showMessage('Sending password reset email...');

    try {
      await sendPasswordResetEmail(email);
      showMessage('Password reset email sent! Please check your inbox.', null, 'success');
    } catch (error) {
      showError(error);
    } finally {
      forgotPasswordButton.disabled = false;
    }
  });
}

// Password visibility toggle (shared across sign-in and create account pages)
document.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
  const input = document.getElementById(toggle.getAttribute('aria-controls'));
  const icon = toggle.querySelector('i');
  if (!input || !icon) return;
  toggle.addEventListener('click', () => {
    const shouldShow = input.type === 'password';
    input.type = shouldShow ? 'text' : 'password';
    toggle.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(shouldShow));
    icon.classList.toggle('ph-eye', !shouldShow);
    icon.classList.toggle('ph-eye-slash', shouldShow);
  });
});

applyEntryState();
