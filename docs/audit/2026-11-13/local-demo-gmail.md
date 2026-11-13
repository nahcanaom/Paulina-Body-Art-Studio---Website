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

## Hosted publication follow-up

At the user's request, published all current demo fixtures: six catalogue rows and seven gallery rows, plus the 13 associated image files, to project `celusvfynfnszmhjgqwj`. Used the supplied owner key only in ignored `.secrets/supabase-publish.env`, separate from application configuration. Existing public `jewelry-catalogue` and `studio-gallery` buckets were reused. No schema, RLS policy, customer record, or existing studio row was changed.

`scripts/publish-demo-content.js` defaults to dry run; `--execute` publishes. It reserves numeric catalogue IDs starting at 900000001 to match the actual hosted bigint schema, uses deterministic gallery UUIDs, rejects existing-ID/title collisions, never overwrites existing rows, uses content-addressed storage objects without overwrite, verifies exact remote image bytes, and checks every published record anonymously. A second run completed without duplicates. Public counts: catalogue 6, gallery 7. All rows are labelled `[Demo]`; sample prices are not verified studio prices. This upload covers the current 13 demo fixtures, not every unused image in the repository.

The deployed `https://paulina-studio.vercel.app/gallery.html` now reads the published rows but its old direct Supabase path passes snake_case fields to a camelCase renderer. Cards therefore show broken images; both deployed content API endpoints also return 404. Prepared a shared public reader that prefers the API, treats an empty successful API response as authoritative, falls back to published-only Supabase reads on HTTP 404, and normalizes gallery fields before rendering. The catalogue uses the same reader. Tests verify the query boundary, API authority and normalization.

Verified the pending frontend against hosted Supabase using a local static server with no Express API: five piercing images, two tattoo images and all six catalogue images loaded. See [piercing](fixes/supabase-static-gallery.png), [tattoos](fixes/supabase-static-tattoos.png), [catalogue](fixes/supabase-static-catalogue.png), and [deployed failure before fix](fixes/deployed-before-data-normalization.png). This does not establish live deployment of the prepared code.

Git push failed because no GitHub authentication was available. Generated a dedicated SSH key at `C:/Users/Admin/.ssh/id_ed25519_paulina_codex`; the user said they will add its public key later. Push and GitHub-triggered deployment are pending that step. No Vercel setting was changed. Google authorization was postponed at the user's request and its helper stopped; no email was sent.
