# Pixel Pulse: local preparation, disabled

This source implements ordinary return to an **already bound** immutable Pixel
subject and a separately gated standalone first-profile flow. Both are local
preparation, not production activation or genuine receiving evidence.
Rematch currently has no approved persistent target and no registered OAuth
client. Do not enable the controls or copy another site's database/keys to make
them appear ready.

The existing game and `rematch-rush-profile-v1` guest save stay independent. The
account module never reads, uploads, adopts or overwrites browser progress.
Signing in does not change a character, inventory, peer identity or guest name.

## Fixed protocol

* Issuer: `https://pixel-pulse-websites.vercel.app/api/sso`
* Proposed public client: `rematch-rush` (not registered by this source)
* Design callback: `https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse`
* Code flow, S256 PKCE, browser-bound one-use state, nonce, EdDSA/JWKS,
  exact scalar audience, verified token/UserInfo correspondence and epoch.
* No client secret, refresh token, `offline_access`, arbitrary redirect or
  Skyway credential-status audience/signing authority.

Node 24 Vercel Web Handlers live under `api/auth/`; static output remains `dist`.
The session endpoint reports `available:false` while disabled. GitHub Pages has
no API, so its account controls remain hidden. POST start/sign-out/cancel require
an exact canonical Origin and bounded JSON. The callback consumes its durable
attempt before token exchange; replay, unknown subject and invalid proof refuse
without creating an account/binding. Minting also locks that exact durable
attempt and checks cancellation/completion before it creates the session.
Logout/cancel revoke an associated completed session as well as stopping pending
minting for the known opaque admission secret(s). Concurrent cold tabs may have
different secrets; this is not universal browser-wide or central logout. A
response racing after revocation may carry a stale cookie; that cookie
cannot restore a valid session. The only exposed profile value is the existing
server-side display name.

Opaque `__Host-` session and attempt cookies are Secure, HttpOnly, SameSite=Lax,
Path=/, with no Domain. Only token hashes enter the session table. A session ends
at the earlier of the accepted signed identity expiry and five minutes from
issuance. Reads do not extend it. Sign-out revokes the local token only. An
accepted higher credential epoch is learned for a known immutable binding in a
separately committed security transaction, before optional capacity, attempt
admission, profile projection or minting. It advances the monotonic floor and
retires older local sessions even when minting refuses or its transaction rolls
back. Same-epoch valid sessions are not evicted to make room. If persistence of
that security observation itself fails, the request fails closed; no durable
retirement is claimed without its successful commit. Ordinary reads do not poll
Pixel. Instant/global password-reset/logout/provider retirement is
therefore **not proved**. Ordinary immutable-bound reauthentication may reuse a
valid central cookie without a password prompt; it is not continuous authority.

## Default-off and target requirements

Both `REMATCH_PIXEL_SIGNIN_ENABLED=true` and
`REMATCH_PIXEL_CLIENT_REGISTRATION_APPROVED=true` are needed before dependencies
are constructed. Registration is an operator-reviewed fact, not permission to
register automatically. Standalone first profiles additionally require
`REMATCH_PIXEL_FIRST_PROFILE_ENABLED=true`, `REMATCH_PIXEL_FRESH_PROOF_APPROVED=true`
and an exact approved `REMATCH_PIXEL_FIRST_PROFILE_HISTORY`. These are separate
operator decisions; no values are configured here. Rematch has no native password
or native-Link/adoption route.

The adapter additionally requires every explicit storage pin:

| Setting | Required operator evidence |
| --- | --- |
| `REMATCH_PIXEL_TARGET_APPROVED` | Literal `true` after a dedicated Rematch target is deliberately chosen |
| `REMATCH_PIXEL_DATABASE_URL` | Dedicated connection, never generic `DATABASE_URL` or another site's connection |
| `REMATCH_PIXEL_APPROVED_HOST` / `PORT` | Exact approved endpoint, DNS destination and transport review |
| `REMATCH_PIXEL_APPROVED_DATABASE` / `ROLE` | Exact database and restricted runtime role |
| `REMATCH_PIXEL_APPROVED_HISTORY` | Reviewed target-specific schema history digest, not the synthetic fixture marker |

Every operation checks actual database/role, schema history, exact expected
columns, uniqueness and preserving foreign keys inside its transaction. Invalid
or absent configuration fails before a pool is made; schema mismatch fails before
data writes. Nonlocal connections require verified TLS. Ambient PG connection,
password, search-path and replication settings cannot select the target.
These runtime checks do not attest CHECK/default/trigger definitions, constraint
validity, object ownership or effective role privileges. A history marker alone
is not production schema/security acceptance; those require actual target review.

There is **no production migration or provisioning runner**. The table shape in
`test/fixtures/pixel-local-schema.sql` is guarded for a loopback disposable test
database and is not an approved production migration. A future owner must pin the
real target, review its existing schema/history/data/ACLs, design the additive
delta and rollback/preservation checks, and grant only needed SELECT/INSERT/UPDATE
operations (including bounded retention DELETE, but no runtime DDL). The return
path never creates accounts/bindings. The separately reviewed first-profile
contract needs narrowly scoped INSERT rights only after its own target/schema
approval. Exact pins do
not themselves prove least-privilege ACLs, backup readiness or resource capacity.
Insertion uses a shared transaction lock, bounded expired-row cleanup and retained
attempt/session ceilings. Valid sessions are not evicted to make room. These
storage bounds still need native concurrency validation and do not replace edge
abuse/rate limits or production capacity review. No production action is
authorized here.

The optional mint transaction rechecks the original observed binding target and
exact epoch under locks. After the last session/completion write it flushes
deferred constraints, rereads the owned attempt/session/binding, and samples the
database wall clock against the original fixed attempt deadline, accepted signed
identity deadline and resulting session deadline. A changed or expired deadline
rolls back mint/completion while keeping independently committed security
retirement. This is a final statement-time admission decision, not proof that
COMMIT durability or HTTP delivery finishes before the deadline. Native held-lock
and late-write cases remain unverified until an approved local endpoint exists.

No legitimate Rematch binding exists merely because this prototype has a local
fixture. Unknown ordinary sign-in users always refuse. The explicit first-profile
path below must be separately reviewed and genuinely verified before activation;
manual same-email adoption, password import, verification marking or guest-progress
import are not substitutes.

## Local verification

`npm test` runs the existing gameplay regression suite and offline receiver,
identity, adapter-guard and UI tests. The HTTP test uses only loopback servers,
ephemeral synthetic EdDSA keys and synthetic identity data; it is not real Pixel
authentication. Native PostgreSQL suites require an explicit
`REMATCH_PIXEL_TEST_CONTEXT` file containing only a local `host` (`127.0.0.1`),
`port`, `user` and `adminDatabase`. Each creates its own
`rematch_pixel_test_<hex>` database, installs the guarded local fixture, and drops
only that owned database in cleanup. `NODE_ENV=test` and
`REMATCH_PIXEL_LOCAL_TEST_MODE=true` are mandatory for loopback adapter access.
No fallback to a remote database exists. Do not weaken these checks for a mock or
an embedded engine with different transport/concurrency semantics.

Test results and any skipped native integration are recorded separately in the
owner's readiness manifest. Offline/HTTP results are not a genuine verified-email
receiving positive. One coordinator owns the bounded central identity/email;
this code does not create an identity, send mail, ask for passwords, provision a
provider or choose a production storage target.

## Standalone first profile (implemented locally, default OFF)

The manual UI offers **Create a Rematch profile** only when the backend reports
that a separately approved first-profile window is open. It asks for explicit
confirmation that this creates a new profile and leaves device progress separate.
It uses same-tab navigation; popups, pointer lock and opener messaging are not
required. No Rematch or Pixel password is entered into this game.

POST `/api/auth/pixel-pulse/create` accepts exactly
`{"intent":"create","acknowledgeSeparateProfile":true}`. The receiver generates
the target UUID, state, PKCE verifier and nonce. The persisted nonce has a
`create_` prefix plus 32 random bytes; ordinary nonces retain their original
format. A disabled gate, missing child purpose row or stripped ticket cannot
turn a stored Create attempt into ordinary return.

The exact registration proposal is `docs/pixel-client-contract.json`; it is not
applied. Fresh confirmation uses the existing central **v1 nine-field wire**,
including `pixel_intent=link` (the central proof protocol term, not native Rematch
linking). The callback redeems the one-use ticket using its original ID token,
code, verifier and flow. EdDSA proof checks bind issuer, scalar audience, subject,
credential epoch, original state/nonce/PKCE/code/callback and flow digest. Only
`amr:["pwd"]` is accepted, with current-password age at most90seconds and proof
lifetime at most30seconds. The target is created from the trusted canonical
Pixel display name; no email, roles, guest nickname or browser progress is
looked up, adopted or imported.

First-profile admission also requires these server-only pins, never browser input:

| Setting | Meaning |
| --- | --- |
| `REMATCH_PIXEL_FIRST_PROFILE_SUBJECT` | One reviewed immutable Pixel subject |
| `REMATCH_PIXEL_FIRST_PROFILE_STARTS_AT` | Exact ISO opening time |
| `REMATCH_PIXEL_FIRST_PROFILE_ENDS_AT` | Exact ISO close, at most5minutes after opening |

No real subject/window is configured. The first attempt stores the admitted
subject and original cutoff; later policy may shorten, never extend, that
attempt. Wrong subjects refuse before proof redemption. The transaction retains
the original admission, attempt, identity, proof and result-session ends through
ownership waits, final writes, deferred-trigger flush and locked snapshot reads.
A final fresh database-clock decision rejects equality/expiry and rolls back
receipt, account, immutable binding, session and completion together. It is not
a COMMIT/network-deadline guarantee.

The first-profile callback also checks its original attempt/admission cutoff at
each awaited phase, before exchanging or redeeming proof and after later work.
A newer same-subject window cannot extend an already-started flow. This avoids
requesting a one-use proof after the old window has closed, even though final
storage would independently refuse a late binding.

Once the verifier accepts the signed issuer/subject/epoch and matching UserInfo
tuple, it emits a private process-local security fact before optional profile
validation. That fact independently advances only an existing immutable binding's
strictly higher floor and retires only its older sessions. Profile/name/email
refusal, proof failure, Create refusal or mint failure cannot undo a successfully
committed observation. Unknown subjects cause no security write; raw JSON cannot
forge the private fact. The fact supplies no profile, binding, password, adoption
or session-mint authority. If observation persistence fails, proof and creation
stop; no successful retirement is claimed.

The additional `rematch_pixel_first` schema is isolated from the accepted return
contract. The guarded `test/fixtures/pixel-first-profile-local.sql` is a LOCAL
fixture, not a production migration. Its history must match both its explicit
pin and the base target history. Proof JTI/state/subject/target uniqueness prevents
replay and duplicate initial creation; existing bindings are never upserted or
rebound. Global profile/receipt/session and per-browser attempt ceilings fail
closed. A bounded per-worker request circuit breaker also limits bursts; it is
not distributed edge protection. Operator edge/capacity review remains necessary.

A failed creation acknowledgment is reported as **uncertain**, not as unchanged
data or permission to create again. Ordinary Continue can return to a binding
that actually committed. The UI hides Create on that uncertain return page.

## Local packaging and manual browser check

The static build copies exactly eight public assets. Vercel has six Web Handler
routes, explicit `server/**` tracing and test/docs exclusions; server code, SQL,
fixtures and provider tokens do not enter `dist`. Offline route/import and cached
NFT dependency tracing are packaging checks, not hosted acceptance.

Credential-free manual UI checks can use the synthetic session/start/create
responses from `pixel-ui.test.mjs`: confirm narrow/wide layout, explicit separate
profile acknowledgment, cancel, same-tab handoff and uncertain-result guidance.
Genuine OAuth, Secure cookies, actual PostgreSQL locks/roles/ACLs and hosted
routing must later be verified under a concrete approved operator handoff.
No live sign-in, password submission, account creation or email is requested now.
