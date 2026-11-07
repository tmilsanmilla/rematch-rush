# Pixel first-profile verification: executable preparation

This is local preparation on the accepted `3098d2b` auth source. It neither
selects a storage target nor authorizes a database connection, SQL, role/grant
change, provider registration, real identity, email, activation or publication.
The separate newer gameplay checkout must be preserved when auth is eventually
integrated; do not replace it with this prototype's entire game archive.

## Safe preparation commands

These commands read local source and print plans. They do not connect to a
database or Pixel Pulse:

```sh
node test/native-first-profile-plan.mjs --plan
node ops/target-preflight.mjs --plan
node ops/registration-handoff.mjs --plan
```

The target plan starts unselected and unapproved. A selected manifest must pin
the dedicated endpoint, project/branch, database, schema owner, migration role,
runtime role, endpoint evidence, source-derived histories and independently
reviewed catalog/DDL digests. Do not fill those fields from another website's
connection or treat a template as approval. Rendering is an offline review step;
the target and registration tools have no apply operation or database transport.

## Runnable native suite, not a placeholder

`test/native-first-profile.mjs` contains the actual future PostgreSQL cases.
The normal test registration skips them unless BOTH the separately reviewed
`REMATCH_PIXEL_NATIVE_FIRST_PROFILE_CONTEXT` and
`REMATCH_PIXEL_NATIVE_FIRST_PROFILE_PERMIT` are supplied. The older return-test
context alone cannot open this suite. No such context or permit is supplied by
this handoff.

Before importing the database driver, the exported runner validates the finite
execution permit, exact source hashes, allowed scopes and a random-named,
already provisioned, exclusively owned loopback test database. It then verifies
the actual TCP database/roles and emptiness before fixture setup. The owner and
runtime roles must already exist; it creates or drops no database or role, starts
no service and changes no IPC or system configuration.

Under a separate future authorization, the runner installs the two existing
LOCAL fixture schemas, grants the existing runtime role its reviewed fixture
rights, resets only its six synthetic fixture tables between cases, and creates
and removes only its own test triggers/functions. It retains fixture schemas and
final rows for operator inspection. It must never be pointed at an application
or another owner's database. A failed run is not permission to clear or reuse it.

The suite contains concrete cases for first creation through the real handler,
JOSE identity verifier and fresh-proof verifier; cookie/session reload, logout
and immutable return; concurrent duplicate targets and replay; protected-column
denial; atomic rollback; original deadline waits; AFTER/deferred work and final
tuple fences; and independently committed higher-epoch retirement. Held-lock
observations pin the exact database, runtime receiver PID and intended blocker.

The in-process transport in `test/support/pixel-profile-transport.mjs` uses
ephemeral synthetic signatures and injected responses, with no network fallback.
Its password assertion is synthetic. Even a future passing native run would not
prove genuine managed identity/current-password confirmation, the actual central
provider, a browser's Secure cookies/TLS or hosted Vercel behavior.

## Target and effective-privilege handoff

`ops/target-preflight.mjs` exports fixed read-only catalog queries and a separately
authorized injected-executor entry point. It requires complete results and checks
actual identity, owners, role membership, defaults, effective privileges, full
object definitions and an exact independently reviewed descriptor digest.
Partial, denied or missing results never mean an empty or safe database.

`ops/target-ddl.mjs` only renders an additive plan for an explicitly selected EMPTY
dedicated database with all three Rematch namespaces absent. It creates no provider,
database or role and performs no backfill, adoption or account import. The runtime
application still performs no DDL. Actual migration SQL, grants and activation
remain separate operator actions after native evidence and review.

The accepted runtime inserts first-profile rows without updating their ownership
fields. PostgreSQL row locks nevertheless require UPDATE privilege on at least
one column of each locked table. The privilege plan documents the narrow
`UPDATE(created_at)` capability needed for otherwise insert-only profile/proof
tables; that is a real SQL permission, not an enforcement of "lock only". Other
updates and retention deletes are separately enumerated. Global owner defaults
and PUBLIC/inherited permissions must be reviewed as well as direct grants.

## Fixed central registration

The exact proposed public client remains `rematch-rush`, code/S256, scalar
audience and callback
`https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse`.
`ops/registration-handoff.mjs` emits a disabled descriptor and checks exact
correspondence. It has no provider API, client secret or apply command. The
existing central owner must review its own registry/adapter mapping and any
separate confined admission. Public first-profile flags remain off.

Rematch has no native password or native-Link fixture. The central v1
`pixel_intent=link` is the unchanged fresh-proof protocol term for the receiver's
explicit standalone Create; it does not permit adopting email or browser saves.
Root alone owns the genuine identity/inbox/at-most-one-send checkpoint. No send
is established by this preparation, and no signup, resend or password action is
requested here.

The next execution boundary is an explicitly selected owned native fixture
database with existing owner/runtime roles and a separately scoped execution
permit. Until that exists, native SQL remains unexecuted; the plans and guarded
offline checks are useful preparation rather than evidence of live sign-in.

Privilege review references: PostgreSQL 17's
[row-lock privilege requirements](https://www.postgresql.org/docs/17/sql-select.html),
[default-privilege scope](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)
and [effective-privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html).
