/**
 * PAULINA BODY ART STUDIO - ACCOUNT SETTINGS SCRIPT
 * Handles profile picture upload/change/remove, account name editing,
 * and email updates via Supabase Auth + Database + Storage.
 */
import {
  deleteAccount,
  getCurrentUser,
  isAuthConfigured,
  onAuthStateChanged,
  resolveAuthError,
  signOut,
  updateEmail,
  updatePassword,
  updateProfile
} from "./services/authService.js";
import {
  getUserProfile,
  saveUserProfile,
  savePublicProfile
} from "./services/profileService.js";
import {
  deleteProfilePictureByUrl,
  isProfilePictureUrl,
  uploadProfilePicture
} from "./services/storageService.js";

const profilePicImage = document.getElementById("profilePicImage");
const profilePicPlaceholder = document.getElementById("profilePicPlaceholder");
const profilePicInput = document.getElementById("profilePicInput");
const profilePicRemove = document.getElementById("profilePicRemove");
const accountNameInput = document.getElementById("accountName");
const accountEmailInput = document.getElementById("accountEmail");
const saveBtn = document.getElementById("saveSettingsBtn");
const emailUpdateBtn = document.getElementById("emailUpdateBtn");
const messageEl = document.getElementById("settingsMessage");

const cancelBtn = document.getElementById("cancelSettingsBtn");
const passwordToggleBtn = document.getElementById("passwordToggleBtn");
const passwordPanel = document.getElementById("passwordPanel");
const passwordCancelBtn = document.getElementById("passwordCancelBtn");
const passwordSaveBtn = document.getElementById("passwordSaveBtn");
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");

const deleteAccountBtn = document.getElementById("deleteAccountBtn");
const deleteDialog = document.getElementById("deleteAccountDialog");
const deleteConfirmInput = document.getElementById("deleteConfirmInput");
const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
const deleteCancelBtn = document.getElementById("deleteCancelBtn");
const deleteDialogMessage = document.getElementById("deleteDialogMessage");

// The same controller powers both the public account page and the admin
// account settings page. Navigation targets differ between the two locations
// (the admin page lives one directory deeper), and email changes and account
// deletion are disabled for admin accounts.
const SETTINGS_CONTEXT = document.body?.dataset?.settingsContext === "admin" ? "admin" : "public";
const ADMIN_SETTINGS = SETTINGS_CONTEXT === "admin";
const SIGN_IN_URL = SETTINGS_CONTEXT === "admin" ? "../user-side/sign-in.html" : "sign-in.html";
const HOME_URL = SETTINGS_CONTEXT === "admin" ? "../user-side/home.html" : "home.html";

let currentUser = null;
let providerAvatar = "";
let currentPhotoURL = "";
let hasCustomPhoto = false;
let isSignedOut = false;

function showMessage(text) {
  if (messageEl) {
    messageEl.textContent = text;
  }
}

/**
 * Standard MD5 implementation for generating email provider avatars (Gravatar).
 */
export function md5(string) {
  function rotateLeft(lValue, iShiftBits) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX, lY) {
    var lX4, lY4, lX8, lY8, lResult;
    lX8 = (lX & 0x80000000);
    lY8 = (lY & 0x80000000);
    lX4 = (lX & 0x40000000);
    lY4 = (lY & 0x40000000);
    lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
      else return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    } else return (lResult ^ lX8 ^ lY8);
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return (x ^ y ^ z); }
  function I(x, y, z) { return (y ^ (x | (~z))); }
  function FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(string) {
    var lWordCount;
    var lMessageLength = string.length;
    var lNumberOfWords_temp1 = lMessageLength + 8;
    var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    var lWordArray = Array(lNumberOfWords - 1);
    var lBytePosition = 0;
    var lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function wordToHex(lValue) {
    var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      WordToHexValue_temp = "0" + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
    }
    return WordToHexValue;
  }
  function utf8Encode(string) {
    string = (string || "").replace(/\r\n/g, "\n");
    var utftext = "";
    for (var n = 0; n < string.length; n++) {
      var c = string.charCodeAt(n);
      if (c < 128) {
        utftext += String.fromCharCode(c);
      } else if ((c > 127) && (c < 2048)) {
        utftext += String.fromCharCode((c >> 6) | 192);
        utftext += String.fromCharCode((c & 63) | 128);
      } else {
        utftext += String.fromCharCode((c >> 12) | 224);
        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
        utftext += String.fromCharCode((c & 63) | 128);
      }
    }
    return utftext;
  }
  var x = Array();
  var k, AA, BB, CC, DD, a, b, c, d;
  var S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  var S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  var S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  var S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  string = utf8Encode(string);
  x = convertToWordArray(string);
  a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
  for (k = 0; k < x.length; k += 16) {
    AA = a; BB = b; CC = c; DD = d;
    a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
    b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
    a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
    c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
    c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
    b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
    a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
    d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
    a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
    a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
    a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
    c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
    a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
    c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
    b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
    c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
    d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
    c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
    a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
    d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
    b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

/**
 * Pulls the default avatar from the user's email provider.
 * Supports OAuth provider avatar (Google) or Gravatar from email.
 */
export function getEmailProviderAvatar(userOrEmail) {
  let email = "";
  let photoURL = "";
  if (typeof userOrEmail === "string") {
    email = userOrEmail.trim().toLowerCase();
  } else if (userOrEmail) {
    photoURL = userOrEmail.photoURL || userOrEmail.user_metadata?.avatar_url || userOrEmail.user_metadata?.picture || "";
    email = (userOrEmail.email || "").trim().toLowerCase();
  }

  // If email provider OAuth passed an avatar URL that isn't a custom Supabase upload
  if (photoURL && !isProfilePictureUrl(photoURL)) {
    return photoURL;
  }

  if (email) {
    const hash = md5(email);
    return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=150`;
  }

  return "";
}

function generateInitialsAvatar(user) {
  const source = user?.displayName || user?.email || "U";
  const initials = source
    .split(/[ .\s@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

  const burgundy = "#331418";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
    `<rect width="150" height="150" rx="75" fill="${burgundy}"/>` +
    '<text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" ' +
    'font-family="Footlight MT Pro, Georgia, serif" font-size="64" font-weight="700" ' +
    `fill="#F6F2F0">${initials}</text></svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function resolveDefaultAvatar(user) {
  return getEmailProviderAvatar(user) || generateInitialsAvatar(user);
}

function renderProfilePicture(url) {
  if (!profilePicImage) return;
  profilePicImage.src = url;
  profilePicImage.classList.toggle("profile-pic-image--visible", Boolean(url));
  if (profilePicPlaceholder) {
    profilePicPlaceholder.style.display = url ? "none" : "flex";
  }
}

function setRemoveState(enabled) {
  if (profilePicRemove) {
    profilePicRemove.disabled = !enabled;
  }
}

const nameFromEmail = (email) => {
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

/**
 * Renders the profile from, in order: the private profile row, the local cache,
 * and the authenticated session itself (metadata, then the email address).
 *
 * The session fallbacks matter when the profile table or storage is not
 * reachable: the page still shows the account's real name, email and photo
 * instead of leaving the fields blank.
 */
async function loadProfile(user) {
  providerAvatar = getEmailProviderAvatar(user);
  const fallbackAvatar = resolveDefaultAvatar(user);

  let profile = null;
  try {
    profile = await getUserProfile(user.uid);
  } catch (error) {
    console.warn("Could not load the Supabase profile:", error);
  }

  // Also check localStorage cached profile
  let cached = null;
  try {
    const raw = localStorage.getItem("paulina_user_profile");
    if (raw) cached = JSON.parse(raw);
  } catch (e) {}

  const metadata = user?.userMetadata || user?.user_metadata || {};
  const displayName =
    profile?.displayName ||
    cached?.displayName ||
    user?.displayName ||
    metadata.full_name ||
    metadata.display_name ||
    metadata.name ||
    nameFromEmail(user?.email) ||
    "";

  const storedPhotoURL = profile?.photoURL || cached?.photoURL || "";
  if (storedPhotoURL && storedPhotoURL !== providerAvatar) {
    currentPhotoURL = storedPhotoURL;
    hasCustomPhoto = true;
  } else {
    currentPhotoURL =
      providerAvatar ||
      metadata.avatar_url ||
      metadata.picture ||
      metadata.photo_url ||
      fallbackAvatar;
    hasCustomPhoto = false;
  }

  renderProfilePicture(currentPhotoURL);

  if (accountNameInput) {
    accountNameInput.value = displayName;
  }
  if (accountEmailInput) {
    accountEmailInput.value = user.email || cached?.email || "";
  }

  // Keep the cache aligned with the account so the next load renders instantly.
  if (user?.uid && user.uid !== "guest_user") {
    try {
      localStorage.setItem(
        "paulina_user_profile",
        JSON.stringify({
          uid: user.uid,
          displayName,
          photoURL: currentPhotoURL,
          email: user.email || ""
        })
      );
    } catch (e) {}
  }

  setRemoveState(hasCustomPhoto);
  if (messageEl) messageEl.textContent = "";
}

async function removeProfilePicture() {
  if (!currentUser || isSignedOut) return;

  if (isProfilePictureUrl(currentPhotoURL)) {
    try {
      await deleteProfilePictureByUrl(currentPhotoURL);
    } catch (error) {
      console.warn("Could not delete the storage object:", error);
    }
  }

  // Reset to default email provider avatar
  const defaultAvatar = resolveDefaultAvatar(currentUser);
  currentPhotoURL = defaultAvatar;
  hasCustomPhoto = false;
  renderProfilePicture(defaultAvatar);
  setRemoveState(false);
  showMessage("Profile picture removed. Save changes to update your profile.");
}

async function updateAccountEmail() {
  // Admin account email is read-only; the change-email flow is disabled here.
  if (ADMIN_SETTINGS || !currentUser || isSignedOut) return;

  const email = (accountEmailInput?.value || "").trim();

  if (!email || email === currentUser.email) {
    showMessage("Email is already up to date.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage("Enter a valid email address.");
    return;
  }

  showMessage("Updating email...");
  if (emailUpdateBtn) emailUpdateBtn.disabled = true;

  try {
    const updatedUser = await updateEmail(currentUser, email);
    currentUser = updatedUser || currentUser;

    const displayName = (accountNameInput?.value || "").trim() || currentUser.displayName || "";
    try {
      await saveUserProfile(currentUser, displayName);
    } catch (profileError) {
      console.warn("Could not sync the profile after the email change:", profileError);
    }

    // Update local cache
    try {
      const raw = localStorage.getItem("paulina_user_profile");
      const cached = raw ? JSON.parse(raw) : {};
      cached.email = email;
      localStorage.setItem("paulina_user_profile", JSON.stringify(cached));
    } catch (e) {}

    if (accountEmailInput) accountEmailInput.value = email;
    showMessage("Email updated successfully.");
  } catch (error) {
    const { code, message } = resolveAuthError(error);

    if (code === "reauthentication_needed" || code === "session_not_found") {
      showMessage("Please sign in again to update your email.");
    } else if (code === "email_exists" || code === "user_already_exists") {
      showMessage("This email is already in use by another account.");
    } else {
      showMessage(message || "Could not update email. Please verify it is correct.");
    }

    console.error("Email update error:", error);
  } finally {
    if (emailUpdateBtn) emailUpdateBtn.disabled = false;
  }
}

async function saveAllChanges() {
  if (!currentUser || isSignedOut) return;

  const displayName = (accountNameInput?.value || "").trim() || currentUser.displayName || "";
  const email = (accountEmailInput?.value || currentUser.email || "").trim();

  showMessage("Saving...");
  if (saveBtn) saveBtn.disabled = true;

  try {
    // 1. [PROFILE] Update Supabase Auth metadata
    try {
      const updatedUser = await updateProfile(currentUser, {
        displayName,
        photoURL: currentPhotoURL
      });
      currentUser = updatedUser || currentUser;
    } catch (authError) {
      console.warn("Supabase auth profile update:", authError);
    }

    // 2. Save the private profile row (only accessible to authenticated user)
    try {
      await saveUserProfile(currentUser, displayName);
    } catch (profileError) {
      console.warn("User private profile save:", profileError);
    }

    // 3. Save the public profile fields shown beside reviews (display name + avatar only)
    try {
      await savePublicProfile(currentUser.uid, {
        displayName,
        photoURL: currentPhotoURL
      });
    } catch (pubError) {
      console.warn("Public profile save:", pubError);
    }

    // 4. Save to localStorage cache so reviews can use updated name and avatar immediately
    try {
      localStorage.setItem("paulina_user_profile", JSON.stringify({
        uid: currentUser.uid,
        displayName,
        photoURL: currentPhotoURL,
        email
      }));
    } catch (e) {}

    showMessage("Changes saved successfully!");
  } catch (error) {
    console.error("Failed to save settings:", error);
    showMessage(resolveAuthError(error).message || "Failed to save changes. Please try again.");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function setPasswordPanelOpen(open) {
  if (!passwordPanel) return;

  passwordPanel.hidden = !open;
  passwordToggleBtn?.setAttribute("aria-expanded", String(open));

  if (open) {
    newPasswordInput?.focus();
  } else {
    if (newPasswordInput) newPasswordInput.value = "";
    if (confirmPasswordInput) confirmPasswordInput.value = "";
  }
}

async function changePassword() {
  if (isSignedOut) return;

  const next = String(newPasswordInput?.value || "");
  const confirmation = String(confirmPasswordInput?.value || "");

  if (next.length < 8) {
    showMessage("Your new password must be at least 8 characters.");
    return;
  }
  if (next !== confirmation) {
    showMessage("The two passwords do not match.");
    return;
  }

  showMessage("Updating password...");
  if (passwordSaveBtn) passwordSaveBtn.disabled = true;

  try {
    await updatePassword(next);
    setPasswordPanelOpen(false);
    showMessage("Password updated successfully.");
  } catch (error) {
    showMessage(resolveAuthError(error).message || "Could not update your password.");
  } finally {
    if (passwordSaveBtn) passwordSaveBtn.disabled = false;
  }
}

async function discardChanges() {
  setPasswordPanelOpen(false);
  if (messageEl) messageEl.textContent = "";

  if (currentUser) {
    await loadProfile(currentUser);
  } else {
    if (accountNameInput) accountNameInput.value = "";
    if (accountEmailInput) accountEmailInput.value = "";
  }

  showMessage("Changes discarded.");
}

function setDeleteMessage(text) {
  if (deleteDialogMessage) deleteDialogMessage.textContent = text;
}

function openDeleteDialog() {
  // Account deletion is not available from the admin account settings page.
  if (ADMIN_SETTINGS || !deleteDialog) return;

  if (deleteConfirmInput) deleteConfirmInput.value = "";
  if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
  setDeleteMessage("");

  if (typeof deleteDialog.showModal === "function") {
    deleteDialog.showModal();
  } else {
    deleteDialog.setAttribute("open", "");
  }

  deleteConfirmInput?.focus();
}

function closeDeleteDialog() {
  if (!deleteDialog) return;

  if (typeof deleteDialog.close === "function") {
    deleteDialog.close();
  } else {
    deleteDialog.removeAttribute("open");
  }
}

async function confirmDeleteAccount() {
  // Account deletion is not available from the admin account settings page.
  if (ADMIN_SETTINGS) return;

  if (isSignedOut) {
    setDeleteMessage("Sign in first so we can verify the account to delete.");
    return;
  }

  const typed = String(deleteConfirmInput?.value || "").trim().toUpperCase();
  if (typed !== "DELETE") return;

  if (!currentUser || currentUser.uid === "guest_user") {
    setDeleteMessage("Sign in first so we can verify the account to delete.");
    return;
  }

  if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
  setDeleteMessage("Deleting your account...");

  try {
    await deleteAccount();

    try {
      await signOut();
    } catch (signOutError) {
      console.warn("Could not end the session after deletion:", signOutError);
    }

    try {
      localStorage.removeItem("paulina_user_profile");
    } catch (e) {}

    window.location.assign(HOME_URL);
  } catch (error) {
    console.error("Account deletion failed:", error);
    setDeleteMessage("We could not delete this account automatically. Email paulinabodyart@gmail.com and the studio will remove it for you.");
    if (deleteConfirmBtn) deleteConfirmBtn.disabled = false;
  }
}

function attachEventHandlers() {
  if (profilePicInput) {
    profilePicInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file || !currentUser || isSignedOut) return;
      if (!file.type.startsWith("image/")) {
        showMessage("Please select an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showMessage("Image must be smaller than 5 MB.");
        return;
      }

      showMessage("Uploading image...");
      profilePicInput.disabled = true;
      try {
        let url = "";
        try {
          url = await uploadProfilePicture(file, currentUser.uid);
        } catch (storageError) {
          console.warn("Storage upload failed, falling back to local data URL:", storageError);
          url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        }
        currentPhotoURL = url;
        hasCustomPhoto = true;
        renderProfilePicture(url);
        setRemoveState(true);
        showMessage("Image uploaded. Save your changes.");
      } catch (error) {
        console.error("Upload failed:", error);
        showMessage("Failed to upload image. Please try again.");
      } finally {
        profilePicInput.disabled = false;
        profilePicInput.value = "";
      }
    });
  }

  if (profilePicRemove) {
    profilePicRemove.addEventListener("click", () => removeProfilePicture());
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", saveAllChanges);
  }

  if (emailUpdateBtn && !ADMIN_SETTINGS) {
    emailUpdateBtn.addEventListener("click", updateAccountEmail);
  }

  if (passwordToggleBtn) {
    passwordToggleBtn.addEventListener("click", () => {
      const isOpen = passwordPanel ? !passwordPanel.hidden : false;
      setPasswordPanelOpen(!isOpen);
    });
  }

  passwordCancelBtn?.addEventListener("click", () => setPasswordPanelOpen(false));
  passwordSaveBtn?.addEventListener("click", changePassword);
  cancelBtn?.addEventListener("click", discardChanges);

  if (!ADMIN_SETTINGS) {
    deleteAccountBtn?.addEventListener("click", openDeleteDialog);
    deleteCancelBtn?.addEventListener("click", closeDeleteDialog);
    deleteConfirmBtn?.addEventListener("click", confirmDeleteAccount);

    deleteConfirmInput?.addEventListener("input", () => {
      if (deleteConfirmBtn) {
        deleteConfirmBtn.disabled =
          String(deleteConfirmInput.value || "").trim().toUpperCase() !== "DELETE";
      }
    });

    deleteDialog?.addEventListener("close", () => {
      if (deleteConfirmInput) deleteConfirmInput.value = "";
      if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
      setDeleteMessage("");
    });
  }
}

function applyProfileValues({ displayName = "", email = "", photoURL = "", custom = false } = {}) {
  currentPhotoURL = photoURL || generateInitialsAvatar({ displayName, email });
  hasCustomPhoto = custom;
  renderProfilePicture(currentPhotoURL);

  if (accountNameInput) accountNameInput.value = displayName;
  if (accountEmailInput) accountEmailInput.value = email;

  setRemoveState(custom);
}

async function renderCachedProfile() {
  try {
    const raw = localStorage.getItem("paulina_user_profile");
    if (!raw) return false;

    const cached = JSON.parse(raw);
    if (!cached) return false;

    currentUser = {
      uid: cached.uid || "active_user",
      displayName: cached.displayName || "",
      photoURL: cached.photoURL || "",
      email: cached.email || ""
    };

    // Only query the profile table for a real Supabase user id. Placeholder
    // cache ids (for local previews) would be rejected by the database.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentUser.uid)) {
      await loadProfile(currentUser);
    } else {
      applyProfileValues({
        displayName: currentUser.displayName,
        email: currentUser.email,
        photoURL: currentUser.photoURL
      });
    }

    return true;
  } catch (e) {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Supabase can take a moment to restore a persisted session (especially right
 * after an OAuth redirect). Give it a short window to settle before treating
 * the visitor as signed out.
 */
async function resolveSignedInUser(timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let user = await getCurrentUser();

  while (!user && Date.now() < deadline) {
    await delay(250);
    user = await getCurrentUser();
  }

  return user;
}

function showSignedOutState() {
  isSignedOut = true;

  if (messageEl) {
    messageEl.innerHTML =
      `You are signed out. <a href="${SIGN_IN_URL}">Sign in</a> to save changes to your account.`;
  }

  [saveBtn, cancelBtn, emailUpdateBtn, passwordToggleBtn, deleteAccountBtn].forEach((button) => {
    if (button) button.disabled = true;
  });
  [accountNameInput, accountEmailInput].forEach((input) => {
    if (input) input.disabled = true;
  });
  if (profilePicInput) profilePicInput.disabled = true;
  if (profilePicRemove) profilePicRemove.disabled = true;
}

function clearSignedOutState() {
  isSignedOut = false;

  if (messageEl && messageEl.querySelector("a")) {
    messageEl.textContent = "";
  }

  [saveBtn, cancelBtn, emailUpdateBtn, passwordToggleBtn, deleteAccountBtn].forEach((button) => {
    if (button) button.disabled = false;
  });
  [accountNameInput, accountEmailInput].forEach((input) => {
    if (input) input.disabled = false;
  });
  if (profilePicInput) profilePicInput.disabled = false;
  setRemoveState(hasCustomPhoto);
}

async function init() {
  attachEventHandlers();

  if (!isAuthConfigured()) {
    currentUser = {
      uid: "guest_user",
      displayName: "Paulina Client",
      email: "client@example.com",
      photoURL: ""
    };
    loadProfile(currentUser);
    return;
  }

  // Resolve the stored session first. Reacting to the auth listener's first
  // (possibly empty) event was bouncing signed-in visitors back to sign-in.
  const initialUser = await resolveSignedInUser();

  if (!initialUser) {
    // Never hard-redirect away from this page. Show the cached profile when we
    // have one, otherwise show the layout in a preview state, and explain that
    // signing in is required before changes can be saved.
    const hasCachedProfile = await renderCachedProfile();

    if (!hasCachedProfile) {
      currentUser = null;
      applyProfileValues();
    }

    showSignedOutState();
    return;
  }

  currentUser = initialUser;
  await loadProfile(initialUser);
  clearSignedOutState();

  await onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      clearSignedOutState();
      await loadProfile(user);
      return;
    }

    // Re-check before reacting: Supabase may briefly emit a null event while
    // restoring or refreshing the session. Do not bounce the page for that.
    const confirmedUser = await getCurrentUser();
    if (!confirmedUser) {
      currentUser = null;
      showSignedOutState();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
