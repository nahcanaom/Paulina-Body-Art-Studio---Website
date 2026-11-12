# Supabase Authentication Migration

The browser authentication layer has been migrated from Firebase Authentication
to Supabase. The rest of the site keeps working because the service normalizes
Supabase users into the Firebase-style shape the UI already uses:

| Firebase user property | Normalized Supabase user |
| --- | --- |
| `user.uid` | `user.uid` (same value as `user.id`) |
| `user.email` | `user.email` |
| `user.displayName` | `user.displayName` |
| `user.photoURL` | `user.photoURL` |
| `user.emailVerified` | `user.emailVerified` |

Profile helpers (`saveUserProfile`, `getUserProfile`, `getPublicProfile`,
`savePublicProfile`) keep the same names and return shape. They now use
Supabase tables instead of Firestore.

---

## 1. Files added or changed

| File | Purpose |
| --- | --- |
| `js/supabase-config.js` | **Edit this first.** Project URL, anon key, redirects, table names, bucket name. |
| `js/services/supabaseClient.js` | Lazy shared Supabase client and redirect URL helpers. |
| `js/services/authService.js` | **All auth methods**: sign in, sign up, Google OAuth, sign out, password reset, profile/email/password updates, error messages. |
| `js/services/profileService.js` | Supabase profile tables using the old Firestore helper names. |
| `js/services/storageService.js` | Supabase Storage profile-picture upload/delete. |
| `js/auth.js` | Sign-in / create-account UI now calls the auth service. |
| `js/header_and_footer.js` | Header auth state listener and logout now use Supabase. |
| `js/account_settings.js` | Account settings now uses Supabase auth, profile tables, and storage. |
| `js/auth-callback.js` + `html/auth-callback.html` | Finishes Google OAuth / email-confirmation redirects. |
| `js/reset-password.js` + `html/reset-password.html` | Completes the Supabase password-recovery flow. |

`js/firestore.js` still exists for the existing admin-dashboard booking data.
That data layer was not part of the authentication migration.

---

## 2. Add your Supabase credentials

Open `js/supabase-config.js` and replace:

```js
url: "https://YOUR_PROJECT_REF.supabase.co",
anonKey: "YOUR_SUPABASE_ANON_KEY",
```

You can find both values in Supabase under **Project Settings > API**.

The anon/publishable key is safe to expose in browser code **only when Row
Level Security is enabled**. Never put a service-role key in this file.

For deployments that inject configuration at runtime, define this before the
module loads instead of editing the file:

```html
<script>
  window.PAULINA_SUPABASE_CONFIG = {
    url: "https://your-project.supabase.co",
    anonKey: "your-anon-key"
  };
</script>
```

---

## 3. Configure Supabase Auth

In **Authentication > Providers**:

1. Enable **Email**.
2. Enable **Google** and add your Google OAuth client ID/secret if you want the
   "Continue with Google" button to work.

In **Authentication > URL Configuration**:

- Set **Site URL** to your deployed site (for example
  `https://www.yourdomain.com`).
- Add redirect URLs for every environment:

```
http://localhost:3000/html/auth-callback.html
http://localhost:3000/html/reset-password.html
https://www.yourdomain.com/html/auth-callback.html
https://www.yourdomain.com/html/reset-password.html
```

If your site is hosted at the domain root instead of `/html/`, adjust the paths
in `js/supabase-config.js` or add the matching URLs above.

Email confirmation is optional:

- **Enabled** (default): after sign-up the UI shows "check your inbox" and the
  user signs in after confirming.
- **Disabled**: `signUpWithEmail()` returns a session immediately and the UI
  continues to the home page, matching the old Firebase behavior.

---

## 4. Create the profile tables and RLS policies

Run this in the Supabase SQL editor.

```sql
-- Private profile data, one row per auth user.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Public display name + avatar, visible beside reviews.
create table if not exists public.public_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.public_profiles enable row level security;

-- Private profiles: only the owner can read/write their row.
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Public profiles: everyone can read, only the owner can write.
create policy "Public profiles are readable"
  on public.public_profiles for select
  using (true);

create policy "Users can insert their own public profile"
  on public.public_profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own public profile"
  on public.public_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
```

The code uses `upsert`, so the insert and update policies are both required.

### Optional: create a blank profile automatically on sign-up

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (id) do nothing;

  insert into public.public_profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

The client also upserts these rows, so the trigger is optional.

---

## 5. Create the profile-picture bucket

In **Storage**, create a **public** bucket named `profile_pictures`.

Then run:

```sql
insert into storage.buckets (id, name, public)
values ('profile_pictures', 'profile_pictures', true)
on conflict (id) do nothing;

create policy "Profile pictures are publicly readable"
  on storage.objects for select
  using (bucket_id = 'profile_pictures');

create policy "Users can upload their own profile picture"
  on storage.objects for insert
  with check (
    bucket_id = 'profile_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own profile picture"
  on storage.objects for update
  using (
    bucket_id = 'profile_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own profile picture"
  on storage.objects for delete
  using (
    bucket_id = 'profile_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

The upload path is `<user-id>/profile.<extension>`, which matches these
policies.

If you rename the bucket, update `storage.profilePicturesBucket` in
`js/supabase-config.js`.

---

## 6. Auth service interface

Import from `js/services/authService.js`:

```js
import {
  isAuthConfigured,
  getCurrentUser,
  onAuthStateChanged,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
  updateEmail,
  resolveAuthError
} from "./services/authService.js";
```

### Methods

| Method | Behavior |
| --- | --- |
| `isAuthConfigured()` | `true` when the URL/key placeholders have been replaced. |
| `getCurrentUser()` | Returns a normalized user from the persisted session, or `null`. |
| `onAuthStateChanged(cb)` | Subscribes to Supabase auth events; returns an async unsubscribe function. |
| `signUpWithEmail(email, password, displayName)` | Creates an account. Returns `{ user, session, requiresEmailConfirmation, raw }`. |
| `signInWithEmail(email, password)` | Password login. Returns `{ user, session, raw }`. |
| `signInWithGoogle()` | Starts redirect-based Google OAuth. |
| `signOut()` | Ends the session. |
| `sendPasswordResetEmail(email)` | Sends the recovery email. |
| `updatePassword(newPassword)` | Updates the password during a recovery session. |
| `updateProfile(user, { displayName, photoURL })` | Updates Supabase auth metadata. |
| `updateEmail(user, email)` | Requests an email change. |
| `resolveAuthError(error)` | Returns `{ code, message, technicalMessage }` for display. |

### Normalized user shape

```js
{
  uid, id,            // Supabase user id
  email,
  displayName,
  photoURL,
  emailVerified,
  phone,
  createdAt,
  lastSignInAt,
  userMetadata,
  raw                 // original Supabase user
}
```

---

## 7. What changed in behavior

- **Google sign-in is redirect-based.** The browser leaves the site, then
  `html/auth-callback.html` completes the session and redirects home.
- **Email confirmation may be required.** If enabled, sign-up shows a "check
  your inbox" message instead of immediately logging in.
- **Password reset has a real landing page.** Links open
  `html/reset-password.html`, where the user chooses a new password.
- **Profile data lives in Supabase.** Existing helper names are preserved, but
  the data is now in `public.profiles` and `public.public_profiles`.
- **Profile pictures live in Supabase Storage.** Existing account-settings UI
  is unchanged.
- **The admin demo bypass is unchanged.** `js/auth.js` still routes
  `paulinabodyartstudio@gmail.com` directly to `admin-dashboard.html`. This is pre-existing
  behavior and should eventually be replaced with a real role check.

---

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Authentication is not configured yet." | Replace both placeholders in `js/supabase-config.js`. |
| Google login returns to the site but does not sign in. | Add the exact `auth-callback.html` URL to **Authentication > URL Configuration > Redirect URLs**. |
| Reset email link says it is invalid/expired. | Add the exact `reset-password.html` URL to the redirect allow list and request a fresh link. |
| "Could not save your profile" / RLS errors. | Run the SQL policies above and ensure the `profiles` / `public_profiles` tables exist. |
| Profile picture upload fails. | Create the public `profile_pictures` bucket and run the storage policies above. |
| `new row violates row-level security policy` on upsert. | Both insert and update policies are required for `upsert`. |
| Email/password login says "Email not confirmed". | Confirm the email, or disable email confirmation in Supabase Auth settings. |
