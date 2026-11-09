# Account durability and the first-click journey

The existing approved Rematch Neon target remains the account backend. Money,
XP, styles, Flows, DLSI counters and selections are read from `rematch_game.profiles`
for the live, session-resolved original account UUID. The new `preferences`
operation stores name, sound, reduced motion, avatar background and avatar font
inside that table's existing progress JSON. No migration, bulk update, extra
resource, role, key, provider or credential is needed. Missing preference fields
get compatible defaults; existing balances, cents, counters and unlocks survive.
An existing account's display name supplies the initial name until preferences
are explicitly saved; the identity/binding row is never renamed by that save.

Only the authenticated account service may confirm an account save. Request
failure leaves the original pending operation and its idempotency key available;
local/session storage is recovery metadata, never a success receipt. A failed
refresh keeps the last known account visible and blocks new changes until sync
returns. Explicit confirmed sign-out restores the preserved guest profile and
labels it DEVICE. While signed in, account data is never written into that guest
save. No guest balance/unlock/settings import or same-email adoption is added.
Old device saves remain untouched; recovering/importing them into account money
or quests would need a separately reviewed, legitimate ownership/result plan.

New operations carry the expected original account UUID as a refusal guard,
not as an actor selector. The server resolves the actor from the live opaque
session and rejects a different owner before writes. A late successful response
for an earlier owner cannot overwrite the next signed-in account's displayed
profile. Existing native IDs, progress, roles, runtime session limits and final
transaction/session fences are preserved.

The top-right control is a circular initial, gray and a code-native 5×7 pixel
glyph by default. Background and font choices are allowlisted. Account Settings
and Settings always expose **Link account to Pixel Pulse — Highly recommended**.
An authenticated Rematch account is already Pixel-linked. Rematch has no native
password account: its genuine choices are existing immutable Pixel-linked
account return or explicit new standalone Rematch profile creation, never a
fictional native-Link or device-save adoption route.

With approved ongoing enrollment available, the first Continue starts the
existing ordinary discovery-purpose code/S256/state/nonce journey. A verified
known immutable binding receives its existing account session directly, bounded
by the original attempt/identity/enrollment cutoffs. A known binding whose mint
refuses never falls through into Create. An unknown identity gets the original
browser-bound discovery receipt, then the actual Create/return choice opens
immediately. Repeated Continue reopens that choice without repeating OAuth.
Only explicit Create starts the separate fresh CURRENT Pixel password proof;
Google/social authentication is not that proof. Closed enrollment keeps the
existing bound-only ordinary return route. No producer wire or callback changes.

Local verification includes fresh storage-free clients against the actual game
handler/service with an injected transactional repository, real JOSE with the
existing synthetic issuer, lifecycle/preservation/refusal regressions and
rendered local UI. These are NOT genuine two-device/production Neon acceptance.
The remaining end-to-end boundary is two genuinely fresh clients authenticated
to the same existing approved Pixel/Rematch identity, verifying server data
across sign-out/reload while preserving the original UUID and progress. No real
account/password/email workflow is run or resumed by this local change. Existing
native-engine execution and matched central Google/report work stay separate.
