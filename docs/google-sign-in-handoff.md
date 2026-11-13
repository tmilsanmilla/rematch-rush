# Google sign-in through the existing Pixel identity

Rematch's existing account authority is Pixel Pulse. A Google-backed Pixel
login must return the SAME immutable Pixel issuer/subject/credential version;
Google subject, email equality, provider metadata and browser/device progress
are not Rematch binding or role authority. No second identity store is needed.

The receiver remains fixed to client `rematch-rush`, issuer
`https://pixel-pulse-websites.vercel.app/api/sso` and callback
`https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse`, using the existing
code/S256/state/nonce exchange. It does not accept Google ID tokens directly,
request Google access tokens or add an unreviewed provider/hint query field.
Ordinary return can only find an existing immutable binding. New standalone
profile creation remains explicit and requires the existing one-use CURRENT
Pixel password proof; a social session alone is insufficient. Rematch has no
native-password Link route and never adopts the device save or a same-email row.

## Central availability confirmed November 12

The sole Pixel owner's live contract now confirms normal central Pixel/Google
sign-in and the shared problem-report service. The fixed existing Rematch
Continue with Pixel Pulse authorization flow remains the entry; no guessed
provider selector, Google token, new credential or callback is added here.
Central availability is no longer a pending service dependency.

Settings and How to Play open only
`https://pixel-pulse-websites.vercel.app/report?site=rematch-rush`.
The link sends no user, role, email, timestamp, password, cookie or token in the
URL. Pixel owns sign-in, report storage and permission to view the private inbox.
No report is submitted by this local change.

Actual Google-backed receiving acceptance was not rerun in Rematch. Its latest
published existing-bound Pixel return passed on `aa8ec20`; that is not a new
Google/first-profile/current-password-proof result. Google-only identities
without a Pixel password still need the supported ownership path; a social
session never replaces the required proof or authorizes device/email adoption.

The focused tests use injected, locally signed synthetic tokens only. They
cover same-owner return across upstream authentication methods, rejection of
direct Google issuers, distinct-subject/same-email isolation and refusal to use
Google authentication as the fresh password proof. They do not establish real
Google OAuth, native SQL, a real identity or hosted receiving acceptance.
