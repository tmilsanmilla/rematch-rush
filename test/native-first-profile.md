# Native first-profile harness: prepared, not executed

`native-first-profile.mjs` is a runnable suite against the actual exported store,
handler, OIDC verifier and fresh-proof verifier. It is not a model replacement for
those modules. Its transport uses an explicitly synthetic in-process EdDSA issuer
and proof producer; it never contacts Pixel, asks for passwords or sends mail.
Native execution still needs its own exact target and execution authorization.
No native module, PostgreSQL driver, SQL, engine or service was run to prepare it.

## Safe preparation

`node test/native-first-profile-plan.mjs --plan` only reads the fixed source and
fixture files to print the scenario plan and SHA256 `sourcePin`. It never imports
the native runner or `pg`, reads credentials, connects, initializes or installs
anything. `pixel-native-preparation.test.mjs` exercises the pure authority and
wait-observer contract with synthetic values only.

The default `npm test` registers the native suite as **skipped**. Both new flags
`REMATCH_PIXEL_NATIVE_FIRST_PROFILE_CONTEXT` and
`REMATCH_PIXEL_NATIVE_FIRST_PROFILE_PERMIT` must be present before that test even
imports the runner. The older `REMATCH_PIXEL_TEST_CONTEXT` cannot enable it.
The exported runner repeats its own validation, so importing/calling it directly
does not bypass the target/permit/source checks.

## Exact future operator boundary

Provide an **already provisioned, empty, exclusively owned** TCP loopback database
named `rematch_pixel_test_<16..32 hexadecimal digits>` and two already-existing,
distinct local login roles. The owner role must own that database; the runtime
role must be non-owner, non-admin, and have no membership in another role,
including a `NOINHERIT`/`SET ROLE` escape. No password, URL, service name or other
credential is accepted by this context or inferred from ambient PG settings.

After separate operator authorization, a non-secret JSON context must contain
exactly these fields:

- `authority`: `rematch-native-first-profile-fixture-v1`.
- `executionPermit`: an explicit 64-character lowercase hexadecimal marker,
  also passed separately through the new permit flag or CLI argument. This
  mechanical marker does not itself replace the human/operator approval record.
- `notBefore`, `expiresAt`: canonical ISO dates with an inclusive opening,
  exclusive closing and at most30minutes total duration.
- `scopes`: exactly `fixtureDDL`, `syntheticDML`, `ownedTriggers`,
  `readOnlyCatalog`, `roleUse`, all explicitly `true`.
- `host`: exactly `127.0.0.1`; `port`: the approved integer TCP port.
- `database`, `ownerRole`, `runtimeRole`: the approved existing local names.
- `baseHistory`: `086a080ccdb16a5d5186016563eb06ec007d55e1850079ae409c9b445f71f54c`.
- `firstHistory`: `eb007d0be98e106faa1dea876eae94362ae4d15bf8290ec8c9f37be0d889e9f1`.
- `sourceCommit`: the reviewed exact40-character candidate revision.
- `sourcePin`: the exact file/hash map printed by the safe plan after source is
  frozen. Changed, extra or missing source bytes refuse before `pg` is imported.
- `fixtureMode`: `install-empty-owned-schemas-leave-for-review`.

The two histories are LOCAL fixture identifiers, never production migration
approval. The source pin includes both fixtures, the actual runtime/accepted-fact
code, the synthetic transport and the native runner/contract/plan itself.

Only after that separate authorization may an operator run
`NODE_ENV=test node test/native-first-profile.mjs --run <context.json> <permit>`
or enable the two new flags for `node --test pixel-profile-storage.test.mjs` in a
cleared environment. The current preparation request does **not** authorize
either execution command.

## Later execution behavior and scope

Before any fixture DDL, the runner checks actual database, TCP address/port,
`current_user`, `session_user`, database ownership, runtime role flags/membership
and empty user relations/schemas/routines. It holds a separate private advisory
lock against competing harness runs. It installs only the two existing guarded
LOCAL fixtures and grants a fixed narrow permission map to the existing runtime
role. There is no `CREATE/ALTER/DROP ROLE`, `CREATE/DROP DATABASE`, schema drop,
remote target or service/process/IPC cleanup path.

The runtime role receives schemaUSAGE; tableSELECT/INSERT as required; DELETE
only on base attempts/sessions; UPDATE only on binding `floor_epoch`, base
attempt lifecycle fields and session `revoked_at`. `UPDATE(created_at)` on the
account/first-attempt/receipt rows is the minimum PostgreSQL privilege needed by
the actual `SELECT FOR UPDATE` statements. It does not authorize the application
to change profile ownership, name or proof tuples. A native case must confirm
protected mutations and schema DDL are denied to the actual runtime role.

Each case runs the actual store under that role. Tests prepare synthetic rows
only, snapshot entire accounts/bindings/attempts/proof receipts/sessions, and
assert all-or-nothing completion or exact rollback/preservation. They cover
parallel completion/replay, INSERT/AFTER/deferred failures, persisted tuple
corruption, original attempt/proof/admission/identity deadlines, AFTER-write
and deferred-trigger waits, result-session expiry, and independently committed
higher-epoch retirement surviving optional Create failure.
Between cases the owner truncates only the six exclusively owned fixture data
tables (base accounts/bindings/attempts/sessions and first attempts/receipts),
withoutCASCADE. Schema history rows remain unchanged. This synthetic reset is an
explicit part of the later `syntheticDML` scope; it is forbidden on a populated
or shared target. A failed case drains its own pending operation and stops the
suite before another reset. Observing a wait or test timeout never authorizes
cancelling a different backend.

Wait evidence uses a separate connection of the **same runtime role**, pinned
to the exact database and captured active receiver PID. A held-row test must
also observe the exact intended owner blocker in `pg_blocking_pids`. No broad
stats role, owner/runtime membership, other-database inventory or loose
application-name search substitutes for this evidence. All held waits remain
below the actual store’s3second lock timeout; original subsecond deadlines are
crossed while the observed blocker remains held. Trigger waits must be observed
as `PgSleep` on that exact receiver, not inferred from elapsed time alone.

The finite permit is rechecked before new connections and SQL. Rollback,
connection release and pool shutdown remain possible after expiry. Only exact
test trigger/function objects created by this runner are removed; if authority
has closed they are retained for review instead. Installed fixture schemas and
final synthetic rows are deliberately left for the operator. Do not run the
harness over an already-populated DB, borrow another game’s target, retry by
resetting it, or add cleanup authority merely to make another run possible.

## Evidence limits

Source/syntax/pure-contract checks establish preparation only. They do not prove
that PostgreSQL accepts the SQL or that its locks, triggers, ACLs, rollback and
transport actually behave as intended. A later native receipt must state each
case actually executed and its exact source/target-role scope. Even a successful
native run with the synthetic issuer does not establish a genuine managed
identity, current Pixel password, email verification, hosted Secure-cookie/
browser behavior, central registration, production target, global revocation,
public activation or release. Rematch has no native-password Link/adoption path.
