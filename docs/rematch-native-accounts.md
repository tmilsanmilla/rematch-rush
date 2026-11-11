# Rematch email/password accounts

The normal account UI belongs to Rematch Rush. The maintained, pinned Neon Auth
client handles the game's own email/password identity and email verification;
the game never receives or stores a plaintext password. There is no shared Pixel
sign-in button in the normal account shell. Forgot password remains a simple
blue action, and errors are red.

The dedicated existing Rematch Neon project currently has no Managed Auth.
`node ops/native-accounts.mjs --plan` prints the precise prepared provider,
target, four-table additive storage, privilege and preservation handoff. It does
not connect, enable anything or run SQL. The unrendered SQL always raises an
exception. No production provider, SQL, roles, configuration or mail was changed
by this preparation.

Signed native identities must match the actual approved Managed issuer,
audience and EdDSA JWKS and have verified email. Browser login/setup has an
original five-minute, mode-sealed flow. Its generation prevents a late reply
from resurrecting a session after sign-out. Game operations still resolve the
account from the opaque HttpOnly/Secure cookie, lock the original owner and
recheck expiry after deferred work. The native cookie cannot outlive either the
signed identity, original flow or five minutes; the SDK may return a fresh token
only while its legitimate Managed session remains active.

Existing Rematch UUIDs, progress, balances, XP, unlocks and roles are retained.
An existing native binding returns the exact account. An unknown native identity
gets an explicit choice. **Keep existing Rematch progress** additionally requires
a current original Rematch session; equal emails/names never prove ownership.
The old callback is retained only as deliberate previous-account recovery, so
players who need it can prove the original profile before switching. Native
passwords/roles are never copied from Pixel Pulse. Explicit **Create a new,
separate profile** creates a distinct original game UUID with ordinary role and
zero starting money; device saves are never adopted.

Runtime stays unavailable until actual native provider metadata, exact reviewed
schema history and activation are supplied. Local crypto/model tests do not
establish native PostgreSQL or genuine email/signup acceptance. No automatic or
instantaneous global password-reset/logout retirement is claimed.
