# PAULINA — Body Art Studio

This project represents the website for **PAULINA Body Art Studio**, designed with a rich wine/burgundy brand palette, custom typography, interactive modals, responsive glass navigation, and studio policies.

---

## 📁 Comprehensive Folder Structure

The project has been separated into clean, dedicated directories:

```
paulina-website/
│
├── 📂 assets/                      # Static brand assets (fonts, images, logos)
│   ├── 📂 fonts/                   # Custom typefaces (Couture, Footlight MT Pro, Tan Pearl)
│   ├── 📂 images/                  # Studio photos, artist portraits, service cards, backgrounds
│   └── 📂 logos/                   # Studio brand logos & logomarks
│
├── 📂 components/                  # Reusable components
│   ├── header_and_footer.html      # Isolated code for the Header (Navbar) and Footer
│   └── dialog.js                   # Shared accessible modal/dialog controller
│
├── 📂 css/                         # All stylesheets
│   ├── header_and_footer.css       # Core brand variables, fonts, reset, and header/footer styling
│   ├── home.css                    # Styles specific to the Home page sections and modals
│   └── ...                         # Other page stylesheets
│
├── 📂 data/                        # Data stores
│   └── bookings.json               # Local bookings fallback file
│
├── 📂 html/                        # All HTML website pages
│   ├── 📂 admin-side/              # Admin-specific pages
│   │   └── admin-dashboard.html    # Studio admin dashboard
│   └── 📂 user-side/               # User-facing website pages
│       ├── home.html               # Main landing page
│       ├── booking.html            # Booking system page
│       ├── catalogue.html          # Jewelry catalogue page
│       ├── gallery.html            # Piercing & tattoo gallery
│       ├── aftercare.html          # Piercing aftercare guide
│       ├── artist.html             # Artist profile & portfolio
│       ├── faqs.html               # Frequently asked questions
│       ├── account_settings.html   # Customer settings
│       ├── sign-in.html            # Customer sign-in page
│       ├── create_acc.html         # Customer registration page
│       ├── auth-callback.html      # Supabase OAuth redirect handler
│       ├── reset-password.html     # Supabase password reset page
│       ├── _fonts.html             # Font preview page
│       └── __modal_preview.html    # Modal preview
│
├── 📂 js/                          # All JavaScript logic
│   ├── server.js                   # Express booking & static file server
│   ├── header_and_footer.js        # Mobile hamburger toggle, glass blur on scroll
│   ├── booking.js                  # Booking form state machine & client logic
│   ├── home.js                     # Home page accordion, testimonial marquee, image modals
│   ├── supabase-config.js          # Supabase URL, anon key, redirects, table names
│   ├── 📂 services/                # Browser auth/data layer (Supabase)
│   │   ├── supabaseClient.js       # Lazy, shared Supabase client
│   │   ├── authService.js          # Sign in/up/out, Google OAuth, reset, profile updates
│   │   ├── profileService.js       # profiles / public_profiles tables
│   │   └── storageService.js       # Profile-picture uploads and deletes
│   └── ...                         # Other page scripts and controllers
│
├── 📂 others/                      # Miscellaneous files (rules, documentation)
│   ├── firestore.rules             # Legacy Firebase rules (reference only)
│   ├── storage.rules               # Legacy Firebase rules (reference only)
│   └── README.md                   # Project documentation
│
├── 📂 scripts/                     # Utility scripts
│   └── send-test-email.js          # CLI helper to test email delivery
│
├── 📂 services/                    # Backend service modules
│   ├── bookingStore.js             # Booking storage (Firestore / local file fallback)
│   └── emailService.js             # Email delivery (Resend / SMTP)
│
└── 📂 template/                    # Boilerplate starters for new pages
    ├── page_template.html          # Full starter page (Doctype, head, header, content, footer)
    ├── body_template.html          # Reusable body scaffolding patterns
    └── home_body.html              # Extracted home page body sections
```

---

## 🚀 How to Create a New Page (Without Rewriting Code)

When you need to create a new page (e.g. `catalogue.html`, `gallery.html`, or `aftercare.html`):

1. **Duplicate `page_template.html`** in your project root and rename it (e.g. `catalogue.html`).
2. **Change the title** in `<head>`: `<title>PAULINA Body Art Studio — Catalogue</title>`.
3. **Add your content** inside the `<main class="main-content">` tag:
   - You can copy ready-to-use sections, grids, or banners from `template/body_template.html`.
4. **Done!** The header navigation, brand fonts, footer, styling (`css/header_and_footer.css`), and mobile hamburger menu interactivity (`js/header_and_footer.js`) are already linked and functional.

---

## 🎨 Brand Identity Tokens

- **Primary Background**: `#331418` (Deep dark wine)
- **Primary Brand Red**: `#80151A`
- **Dark Burgundy**: `#600A2E`
- **Soft Pink Text & Accents**: `#F6D0D6`
- **Off-White Text**: `#F6F2F0`
- **Headings Font**: `Tan Pearl`
- **General Body Font**: `Footlight MT Pro`
- **Accent Font**: `Couture`

---

## 💻 Running the Site Locally

Open the project in VS Code and click **"Go Live"** on the bottom status bar (port 5502 is configured), or open `index.html` or `home.html` in any modern web browser.

> **Booking emails:** the booking page works with either the Express server or Live Server. When Live Server is used, keep the Express backend running on port 3000; the page automatically falls back to `http://127.0.0.1:3000/api/send-booking-email` because CORS is enabled for localhost. The included `.vscode/settings.json` also proxies `/api` from Live Server to port 3000 after Live Server is restarted.

### Troubleshooting "We could not save your booking"

This message means the browser could not get a JSON response from the booking API. Check that:

1. The Express backend is running (`npm start`) on port 3000.
2. You opened the page through Live Server or Express, not as a `file://` URL.
3. You hard-refreshed the page after updating `js/booking.js`, so the browser is not using a cached script.

Opening `http://localhost:3000/booking` uses the Express server directly and avoids cross-origin requests entirely.

## Booking Email Backend (Express + Resend or SMTP)

`js/server.js` serves the website and exposes `POST /api/send-booking-email`. The endpoint:

1. Generates a unique `PLN-XXXXXX` booking reference.
2. Saves the booking payload to Cloud Firestore (when Admin credentials are configured) or to the gitignored `data/bookings.json` fallback.
3. Sends the branded HTML/text confirmation to the email address entered in the booking form.

Once the endpoint returns successfully, the booking page enables the **Review** tab. It displays the submitted date, time, service, full name, email (the address typed into the form), phone, and booking reference. The confirmed booking is also kept in `sessionStorage` for that browser tab, so refreshing the page does not disable Review again. If the page reloads while a submission is still in flight, a browser-generated `clientRequestId` lets the page ask `GET /api/bookings/status/:clientRequestId` for the saved booking and restore Review; retries with the same token return the original booking instead of creating a duplicate.

### Email provider setup

The recipient is always the customer email from the form. Delivery to arbitrary addresses depends on the provider:

**Option A — Resend with a verified domain (recommended for production)**

1. Verify a domain in the Resend dashboard.
2. Use an address on that domain as the sender:
   ```env
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=bookings@your-verified-domain.com
   RESEND_FROM_NAME=PAULINA Body Art Studio
   ```

Resend's `onboarding@resend.dev` sender is a testing-only sender. It can only deliver to the Resend account owner's address (`faye08022005@gmail.com`); every other recipient is rejected by Resend, not by the website code.

**Option B — SMTP (works without owning a domain)**

Set SMTP credentials in `.env`. This sends to any valid customer address. `SMTP_USER` must be the Gmail account that created the App Password, and `SMTP_FROM_EMAIL` should match it (or a verified alias):

```env
EMAIL_PROVIDER=auto
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=paulinabodyart@gmail.com
SMTP_PASS=your_16_character_google_app_password
SMTP_FROM_EMAIL=paulinabodyart@gmail.com
SMTP_FROM_NAME=PAULINA Body Art Studio
```

For Gmail, enable 2-Step Verification and create an **App Password** (Google Account > Security > App passwords). Do not use the normal account password. The App Password is exactly **16 characters** (Google displays it as four groups of four); copy all of it. Spaces are removed automatically, but a truncated code is rejected with `535-5.7.8 Username and Password not accepted`. `EMAIL_PROVIDER=auto` uses SMTP when all three of `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are present; `EMAIL_PROVIDER=smtp` forces it.

The server verifies the SMTP login on startup. `GET /api/health` reports `smtpVerification` (`verified`, `authentication-failed`, `connection-failed`, or `unknown`) and `smtpPasswordFormatValid`, so a bad App Password is visible immediately instead of failing silently on the first booking.


To check the selected provider and send one real test message without creating a booking:

```bash
npm run email:test -- customer@example.com
```

The command prints the provider, sender, whether external delivery is enabled, and the provider's exact success or rejection message.


Set the customer-facing reply address separately:

```env
STUDIO_SUPPORT_EMAIL=faye08022005@gmail.com
```

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example`, set `RESEND_API_KEY`, and choose a verified Resend domain or SMTP.
3. Start the server and open `http://localhost:3000`:
   ```bash
   npm start
   ```
4. For Live Server, keep Express running on port 3000. The page tries `/api` first (the included proxy forwards it to Express), then falls back to the local API. CORS allows localhost, private LAN addresses, and `file://` origins during development.

### Firestore Persistence

Add the Firebase Admin service-account values to `.env` to write to the `bookings` collection:

```env
FIREBASE_PROJECT_ID=paulina-body-art-studio
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@paulina-body-art-studio.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Alternatively, set `FIREBASE_SERVICE_ACCOUNT_JSON` to the full service-account JSON. Without these values, bookings are stored locally in `data/bookings.json` so the flow still works in development.

> Bookings are the **only** remaining Firebase consumer. Authentication,
> profiles, and profile pictures all run on Supabase (see below).

### Security Notes

- `.env`, `data/`, and `node_modules/` are gitignored. Never commit Resend or Firebase service-account credentials.
- The endpoint validates required fields, caps body size at 256 KB, and rate-limits booking submissions per IP.
- Rotate the Resend API key if it is ever shared in chat, source control, or client-side code.

## Authentication Setup (Supabase)

The auth forms use **Supabase** Authentication for Google sign-in and
email/password accounts. Page code never talks to Supabase directly: it imports
`js/services/authService.js`, which returns users in the Firebase-compatible
shape the UI already used (`uid`, `displayName`, `photoURL`, `emailVerified`).
Full setup detail and the database SQL live in
`docs/supabase-auth-migration.md`.

### 1. Add your Supabase credentials

Open `js/supabase-config.js` and replace the two placeholders with the values
from **Supabase > Project Settings > API**:

```js
url: "https://your-project-ref.supabase.co",
anonKey: "your-anon-key",
```

The same file holds the auth options (session persistence, PKCE flow), the
redirect paths, the profile table names, and the storage bucket name, so a
renamed table or bucket only has to change in one place. Deployments can inject
configuration at runtime instead of editing the file:

```html
<script>
  window.PAULINA_SUPABASE_CONFIG = {
    url: "https://your-project.supabase.co",
    anonKey: "your-anon-key"
  };
</script>
```

### 2. Configure the Supabase project

1. **Authentication > Providers**: enable **Email**, and **Google** if you want
   the "Continue with Google" button.
2. **Authentication > URL Configuration**: set the Site URL and add the
   `auth-callback.html` and `reset-password.html` URLs for every environment
   (localhost and production), exactly as listed in the migration guide.
3. Run the SQL in `docs/supabase-auth-migration.md` to create `public.profiles`,
   `public.public_profiles`, their Row Level Security policies, and the public
   `profile_pictures` storage bucket.

### What the app does now

- `sign-in.html` / `create_acc.html` call `signInWithEmail`, `signUpWithEmail`,
  or `signInWithGoogle`; success returns to `home.html`.
- Google sign-in is redirect-based and returns to `auth-callback.html`, which
  finishes the session and forwards home.
- **Forgot password?** emails a Supabase recovery link that opens
  `reset-password.html`.
- `account_settings.html` writes Supabase profile rows and stores avatars in
  Supabase Storage.
- `js/header_and_footer.js` subscribes to the Supabase auth state for the
  account menu and logout.

`js/firebase-config.js` and `js/firestore.js` are now used **only** by the
admin-dashboard booking data. `others/firestore.rules` and
`others/storage.rules` are the old Firebase rules, kept for reference; they no
longer govern profiles, profile pictures, or authentication.

### Security Notes

- The Supabase anon key is public by design. Access control comes from Row Level
  Security policies, so keep RLS enabled on both profile tables and on the
  `profile_pictures` bucket. Never put a service-role key in
  `js/supabase-config.js`.
- Serve the pages over localhost or HTTPS; ES modules, OAuth redirects, and the
  Supabase session do not work reliably from `file://` URLs.
- `js/auth.js` still contains a hardcoded demo admin bypass
  (`paulinabodyartstudio@gmail.com`) that opens the dashboard without an auth check. Replace it
  with a real Supabase role check before using the dashboard in production.
- Deploy over HTTPS and configure security headers such as Content-Security-Policy
  and Strict-Transport-Security at the hosting provider.
