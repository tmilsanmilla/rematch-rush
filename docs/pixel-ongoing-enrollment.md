# Ongoing enrollment — local implementation, inactive

The receiver supports ongoing new-player enrollment without a permanent actor
allowlist. It remains inactive until the existing operators deliberately approve
its dedicated storage, exact central registration/counterpart, runtime settings
and separately tested activation. No credentials or real selector values are in
this package. The old finite one-subject path remains available only when BOTH
new enrollment keys are absent; partially configured, false or invalid new
settings do not fall back to that older path.

A browser first chooses **Identify with Pixel Pulse**. This is ordinary fixed
code/S256/nonce OIDC with a distinct discovery purpose. The real verifier checks
signed issuer, immutable subject, epoch, identity expiry and matching verified
UserInfo. Discovery stores only a short-lived browser-bound server receipt; it
creates no account, immutable binding or admission session. The browser receives
only availability/expiry metadata, never an email-based adoption choice.

Only a subsequent explicit **Create a Rematch profile** acknowledgement starts
a NEW fresh-proof flow. Its server-sealed fields include discovered subject and
epoch, a newly generated standalone target UUID, the receiver's independent
local generation and ORIGINAL UTC-aligned 300-second window. The receipt is
consumed atomically with that new attempt. Neither browser JSON nor a newer
policy window can select or extend those fields. The unchanged nine-field v1
central `pixel_intent=link` wire means fresh proof for standalone receiving
Create; there is no native Rematch password, native Link, guest-save adoption,
email matching, password import, auto-create or rebind fallback.

Fresh current-Pixel-password proof, original identity/proof/attempt/window
cutoffs and exact actor/epoch are rechecked across awaits and in the SQL
transaction. Final DB-clock fences follow last writes, deferred-trigger flush
and locked persisted-tuple rereads. A newly accepted higher epoch for an exact
known immutable binding is durably learned independently before optional
profile/proof/Create failures. Unknown or untrusted facts never create a binding
or retire another owner. Ordinary known-bound return remains available when
first enrollment closes. Local opaque sessions last no longer than the accepted
signed identity and five minutes. No refresh grant, Skyway lease authority or
continuous/global logout/reset guarantee is invented.

## Exact counterpart and independent policy

The sole Pixel owner maintains the installed provider/broker/proof implementation.
Its final ongoing contract is `ongoing-enrollment-contract-final-20261106.json`.
Central owns `PIXEL_PULSE_REMATCH_SSO_ENABLED` and
`PIXEL_PULSE_REMATCH_SSO_GENERATION`. Receiver owns
`REMATCH_PIXEL_ENROLLMENT_ENABLED` and
`REMATCH_PIXEL_ENROLLMENT_GENERATION`; each generation is an independent
canonical UUIDv4. Neither generation, receiving mode nor target is attested by
v1. Central and receiver both use original aligned 300-second windows; their
reviewed operational enabled correspondence is separate from the signed wire.

Receiver prerequisites also include existing SIGNIN_ENABLED,
CLIENT_REGISTRATION_APPROVED, FIRST_PROFILE_ENABLED, FRESH_PROOF_APPROVED,
explicit target pins and three exact history digests (base, first, ongoing).
Those approval keys are names, not supplied values or permission to configure.
The dedicated DB's ongoing policy row must independently be enabled with the
same receiver generation. The rendered plan seeds it **false with NULL
generation**. Runtime has SELECT and UPDATE(lock_tag) only on this row; a CHECK
forces lock_tag=0. This real narrow UPDATE privilege is needed for SHARE locks
and does not permit changing enabled/generation. Operator updates conflict with
in-flight SHARE locks. Runtime rechecks its dynamic local policy and DB clock
at each final fence; no instantaneous distributed cancellation claim is made.

## Target, evidence and execution boundary

The target is still UNSELECTED. The exact additive plan now has three namespaces,
12 tables and three target-derived histories. The preflight requires complete
catalog/role/default-ACL/effective-privilege evidence, exact independently frozen
digests and three distinct schema-owner, migrator and runtime roles. It never
connects, provisions or applies SQL by itself. No existing site DB, account,
progress table, credential or role is imported. See the target preparation guide.

Guarded synthetic tests execute the actual handler and ephemeral JOSE/proof
crypto with fake transactional command adapters; they are not native SQL proof.
`node test/native-ongoing-plan.mjs --plan` prints current source pins and eight
runnable prepared native scenarios without importing a driver or engine. The
private socket-only PG17 runner requires separate accepted native execution
authority. Historical initialization/review refusals remain in the evidence;
they never authorize a workaround or borrowed endpoint. Root subsequently
obtained fresh direct approval and ran the exact owned fixture. Its first run
exposed a restricted runtime metadata read, repaired in the owned-socket branch
without granting broader privileges or changing remote production validation.
Current native execution/pass status belongs to the separately timestamped
receipts, not this source plan. PG17 synthetic fixture execution cannot certify
PG18 target compatibility, production privileges, hosted cookies/provider or
genuine current-password acceptance; those remain separate evidence.
