# Local demo and Gmail follow-up

Implemented on `codex/local-demo-gmail`, following the [baseline audit](README.md).

## Content diagnosis and repair

The repository contains 91 catalogue image files and reusable portfolio photos. Those files do not populate Supabase automatically. The baseline public APIs and anonymous hosted reads returned zero visible records; hosted emptiness versus RLS/unpublished records is still unresolved.

`PAULINA_ENV=demo` outside production now serves six sample catalogue records and seven gallery records through the existing published read functions, including catalogue suggestions. Every fixture image exists locally. The gallery now reads the Express public API consistently instead of letting a successful but empty browser Supabase query bypass it. Sample notices distinguish these fixtures from verified studio prices, sizes and placement. No face tattoo image was invented to fill that section.

The fixtures do not insert, update or seed hosted records. Admin content writes continue to use Supabase and do not edit the fixtures. Other application actions, including bookings, are not simulated by this content-only demo. Express binds to loopback in demo mode. Production ignores this demo flag.

## Gmail setup

Run from the repository root:

1. Copy `.env.example` to `.env` and fill the sender and public Supabase configuration.
2. Put the Google OAuth web client JSON at `.secrets/google-oauth-client.json`.
3. Enable Gmail API in its Google Cloud project, add the sender as a test user if the app is in testing, and register `http://localhost:3002/oauth2callback` as a redirect URI.
4. Run `npm run email:authorize`, open `http://localhost:3002`, and consent as the configured sender.
5. Run `npm start`. `/api/health` reports Gmail configuration readiness. This is not proof of delivery.

The local authorization helper requests Gmail send permission plus OpenID email identity to check that the consented account matches the configured sender. It validates OAuth state, stores only the refresh token and sender in an ignored local file, and sends no email. Send requests refresh access tokens and submit MIME messages through Gmail API. Existing text/HTML templates, inline logo and booking approval timing are preserved. Missing/revoked consent raises an error and does not fall back to another provider.

This workstation's ignored `.env` selects Gmail, retains Resend for a later launch, and comments out the prior SMTP settings. `.secrets/` and `.env` are ignored and not served as static content. No privileged Supabase credential was activated. Google OAuth apps in external testing can have short-lived refresh grants; production launch requires checking the consent screen publishing state and provider limits.

## Verification

- `npm run check:local`: fixture media existence, category filtering, production/demo isolation, sender binding, mocked OAuth refresh, MIME generation and revoked authorization.
- HTTP checks: six catalogue records, seven gallery records, all 13 image URLs return 200; catalogue `bead` suggestions resolve.
- Browser: catalogue search and product details, piercing gallery and photo lightbox, tattoo tab. Screenshots: [catalogue](fixes/catalogue.png), [piercing](fixes/gallery-piercing.png), [tattoos](fixes/gallery-tattoos.png).
- Actual Gmail consent and delivery require separate verification. No test customer booking or real test email was sent during implementation.

The baseline audit's admin authorization, database policy and persistence findings remain open. Do not expose this server publicly or enable privileged database access before those are repaired.
