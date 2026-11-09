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

## Central-owned handoff required

The sole Pixel owner must confirm the approved production Google provider and
its callback/origin configuration, then provide the existing supported Google
entry that preserves the ORIGINAL Rematch authorization flow and immutable
Pixel identity. If a consumer selector is necessary, its exact allowlisted wire
contract must be agreed before Rematch adds it; no guessed `provider`, prompt,
redirect URL or direct Google OAuth client is configured here. Google-only
identities without a Pixel password need a separately supported ownership path;
this request does not weaken current-password proof or invent a password.

Until that contract/configuration is confirmed, no button claims Google is
enabled and no unchanged product deployment is needed. The independently
requested Flow/XP/character gameplay release is already live at `21aacd6`.

The focused tests use injected, locally signed synthetic tokens only. They
cover same-owner return across upstream authentication methods, rejection of
direct Google issuers, distinct-subject/same-email isolation and refusal to use
Google authentication as the fresh password proof. They do not establish real
Google OAuth, native SQL, a real identity or hosted receiving acceptance.
