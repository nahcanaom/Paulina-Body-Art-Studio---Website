# PAULINA — Branded email templates

Every outgoing message — Supabase Auth and the Node backend — uses the same
luxury dark-cherry shell. All styling is inline so it survives Gmail, Outlook,
Apple Mail and mobile clients; the only `<style>` block carries a mobile
media query for the 600px breakpoint.

## Brand tokens

| Token | Value | Used for |
| --- | --- | --- |
| Espresso / black cherry | `#331418` | Outer canvas, header backdrop, dark callouts |
| Soft ivory | `#FAF6F0` | Main content card |
| Off-white | `#F6F2F0` | Button text, light type on dark |
| Rich wine red | `#80151A` | Accent rules, borders, CTA buttons |
| Soft blush | `#F6D0D6` | Highlight badges, callout boxes, footer type |
| Body ink | `#4A3B3C` | Body copy on the ivory card |
| Muted ink | `#7C6A6C` | Small print |
| Hairline | `#E7DCD3` | Card dividers |

Typography: serif headings `Georgia, 'Times New Roman', serif`; body
`'Helvetica Neue', Helvetica, Arial, sans-serif`; references in
`'Courier New', Courier, monospace`.

## Supabase Auth templates

Paste each file into **Supabase Dashboard → Authentication → Emails**:

| Dashboard template | File |
| --- | --- |
| Confirm signup | `supabase-confirm-signup.html` |
| Reset password | `supabase-reset-password.html` |
| Magic link | `supabase-magic-link.html` |
| Change email address | `supabase-change-email.html` |

Subjects:

- Confirm signup — `Confirm your email — PAULINA Body Art Studio`
- Reset password — `Reset your password — PAULINA Body Art Studio`
- Magic link — `Your sign-in link — PAULINA Body Art Studio`
- Change email — `Confirm your new email — PAULINA Body Art Studio`

Variables used (leave them exactly as written):

| Variable | Meaning |
| --- | --- |
| `{{ .ConfirmationURL }}` | The action link. Required by every template. |
| `{{ .Email }}` | The account address the email is being sent to |
| `{{ .NewEmail }}` | The requested new address (change-email template only) |
| `{{ .Token }}` | One-time code, if you prefer a numeric code instead of a link |
| Studio support address | Already filled in as `paulinabodyartstudio@gmail.com`; change it by hand in each file if the studio address changes (Supabase does not substitute it). |

### URL configuration

**Authentication → URL Configuration → Redirect URLs** must allow the origins
the site runs on, because the confirmation link returns to the home page with
the session already established:

- `http://localhost:*/html/user-side/home.html`
- `https://<your-dev-tunnel>/html/user-side/home.html`
- `https://<your-live-domain>/html/user-side/home.html`

The sign-up call sends
`emailRedirectTo: `${window.location.origin}/html/user-side/home.html``, so the
same template works on localhost, a tunnel and production without edits.

## Backend transactional email

`services/emailService.js` renders the identical shell in code, using the same
tokens (`BRAND.espresso`, `BRAND.ivory`, `BRAND.wine`, `BRAND.blush`, `SERIF`,
`SANS`) and the same structure. Messages it currently builds:

- **Booking confirmation** — reference, service, artist, schedule, deposit,
  preparation checklist, studio location, support contact.
- **Custom tattoo request decision** (accepted / declined) — same card, badges
  and CTA.

`backend-shell.html` is the reference copy of that shell with `{{PLACEHOLDER}}`
markers. When adding a deposit receipt, cancellation or reschedule notice, copy
that file's structure into a new `build…Email()` function beside the existing
builders and fill the badges, detail rows and callout — do not introduce a
second visual language. Every message also returns a plain-text alternative and
a version string that is written to the `X-Email-Template` header for support.

The support address and logo come from `STUDIO_SUPPORT_EMAIL` and
`EMAIL_LOGO_URL` in `.env`; when no logo URL is set, `assets/logos/logo_2.png`
is embedded as a CID attachment so the header still renders.
