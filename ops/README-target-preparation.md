# Dedicated Rematch target preparation

This directory provides a runnable **plan/render CLI and injected read-only
collector**, not a connection, provisioning tool or migration runner. No real
target is selected. `target-manifest.template.json` deliberately has null target,
history and catalog pins and `approved:false`. No credentials belong in it.

`node ops/target-preflight.mjs --plan` is safe without credentials. It prints the
unselected handoff and required catalog categories, with `connectionAttempted:false`.
There is no CLI execute/apply option or `pg` import. `--render --manifest FILE`
requires an explicit, independently approved dedicated target, three distinct
existing roles, endpoint/project/branch correspondence receipt and derived history
pins. It only prints SQL. The raw `sql/target-schema.sql` is a guarded unrendered
source template: direct execution aborts its transaction and rolls back. It is
not a production migration or the executable local test fixture.

## Future operator sequence — separately authorized

1. Select an existing **empty, dedicated Rematch** database and existing schema
   owner, migration and runtime roles. Do not borrow another game's endpoint,
   create a resource/role or retrieve a secret under this preparation authority.
   Independently pin endpoint/project/branch/database/server-address correspondence.
2. Derive histories with `deriveHistories(target)` and render/hash the reviewed
   additive plan. Histories cover exact selected target, roles, semantic schema
   source and privileges. They exclude their own stored values and differ from
   synthetic fixture markers. The actual rendered SQL has a separate frozen hash.
3. Under a **new finite read-only authorization**, provide an existing executor
   already in `REPEATABLE READ READ ONLY` with `search_path=pg_catalog`. The
   collector's permit must bind the exact manifest digest and <=15-minute window.
   `collectReadOnlyCatalog` returns only `COLLECTED_UNREVIEWED_NOT_ACCEPTANCE` when
   catalog pins are not yet independently reviewed. An executor must report
   `complete:true`, exact `rowCount` and all rows for every unpaginated query.
   A forbidden/partial/missing result is an error, never zero/empty usage.
4. Independently review the full ordered descriptor, freeze its expected digest,
   then use `runReadOnlyPreflight`/`assertCatalogSnapshot`. The latter also verifies
   exact rendered-DDL bytes. Empty-stage eligibility is not activation readiness.
5. Any DDL, grant/default-ACL change, native execution, configuration/registration
   or genuine identity flow requires its own later explicit authority. There is
   no apply runner. After separately reviewed application, independently pin and
   recheck installed descriptors and all three exact history rows. No data backfill,
   account insertion, same-email adoption or existing schema replay is included.

The rendered transaction rejects TCP-null/wrong database/user/server pins and any
existing user relations or Rematch namespaces before creating the three new schemas.
It uses the selected existing schema owner via `SET LOCAL ROLE`. The selected owner
must own this dedicated database in legacy mode; an explicit operator-owned DB
mode retains bootstrap ownership and uses CREATE-only schema-owner rights. The
migrator must have separately reviewed permission to assume the selected owner. It renders explicit PUBLIC database/schema revocations,
exact runtime grants and per-owner defaults. The owner-global function EXECUTE
default revoke is **per database**, required because a per-schema revoke cannot
subtract a global PUBLIC default. It is only text for review; it does not change a
role or global default now. Unexpected other global/schema default grants refuse
preflight rather than being broadly auto-sanitized.

## Actual runtime privilege tradeoff

`TABLE_PRIVILEGES` is the exact reviewed mapping. Schema history tables need
SELECT only. Accounts, first-attempts and receipts need SELECT/INSERT and the
narrow **real `UPDATE(created_at)` permission** required by existing
`SELECT ... FOR UPDATE` row locks. This permission can update those columns; it is
not a special lock-only privilege. Bindings need UPDATE(floor_epoch), base attempts
need UPDATE(consumed_at,cancelled_at,completed_at), and sessions need
UPDATE(revoked_at). DELETE is allowed on the two base retention tables and expired, unreferenced discovery receipts. The new ongoing policy requires SELECT and UPDATE(lock_tag) for SHARE locking; its CHECK forces lock_tag=0, and the runtime cannot change enabled/generation. Discovery receipts permit only UPDATE(consumed_at); flow rows permit UPDATE(created_at) for existing row-lock semantics.
No runtime owner, membership/SET ROLE path, superuser/bypass-RLS/role/database
creation, schema CREATE, database CREATE/TEMP, table-wide UPDATE, MAINTAIN,
TRUNCATE, REFERENCES, TRIGGER or grant options are accepted.

Catalogs include complete columns/defaults/collations, constraints and FK order,
index expressions/predicates/validity, triggers and function source/security,
RLS/policies, view definitions and rewrite rules, incoming/outgoing dependencies,
owners, raw table/column/PUBLIC ACL entries, role memberships/default ACLs and
effective database/schema/table/column/function rights. Ordered arrays remain
ordered in descriptor hashes. Referenced exact internal `pg_catalog.RI_FKey_*`
functions are captured and pinned; their built-in PUBLIC EXECUTE is not mistaken
for an application function grant. User functions remain refused. PostgreSQL17+
is required by this prepared catalog query set. SQL syntax/behavior and live role
compatibility are **unverified until separately authorized native execution**.

Primary references used in review:
- https://www.postgresql.org/docs/17/sql-select.html (row-lock UPDATE privilege)
- https://www.postgresql.org/docs/17/functions-info.html (privilege checks, NULL socket address)
- https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html (global/per-schema defaults and MAINTAIN)

Credential-free unit tests use synthetic catalog response models. They do not
parse or execute PostgreSQL, prove a live ACL or authorize any connection.

## Explicit NOLOGIN migrator through an existing operator session

A selected target may additionally pin `operatorRole`, distinct from all three
application roles. The existing bootstrap session then keeps
`session_user=operatorRole`, assumes the exact NOLOGIN migration role, and the
renderer checks that split before assuming the schema owner. Both owner and
migrator must be NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOREPLICATION and NOBYPASSRLS. Runtime alone is LOGIN with the same limited
attributes, no role memberships and no unexpected role settings. A migrator
password or public login is unnecessary. No operator role means the original
strict direct-migrator-login contract, not a wildcard principal.

The proposed explicit graph is operator -> migrator -> owner, both edges with
SET TRUE, INHERIT FALSE, ADMIN FALSE. The existing operator's other original
provider memberships are captured and reviewed, never copied onto the runtime.
The selected schema owner must already own this EMPTY database before the source
preflight. Root owns that separately reviewed role/database setup, including
normalizing any read-only role API defaults. A read-only creation label alone
cannot prove runtime least privilege or write capability. No broad read-all or
settings membership is needed. Actual full BEFORE/AFTER descriptors and exact
hashes remain mandatory; expected catalog hashes cannot be generated from a
model or guessed by this renderer.

For an explicitly pinned `databaseOwner=operatorRole`, bootstrap retains ownership
of the database and the schema owner needs only database CREATE. Database/public
ACL operations execute under that exact operator before returning through the
migrator to the schema owner. Database ownership is never silently transferred.
The actual server `inet::text` value is pinned verbatim, including host-only /32
or /128 masks; a network-range mask is refused.

An explicit `bootstrapAdminGrantor` permits ONLY the three observed incoming
bootstrap ADMIN-only rows: member=operatorRole, granted role=one selected app
role, exact grantor, ADMIN TRUE / INHERIT FALSE / SET FALSE. It does not make the
runtime a member of any role or permit another actor/parent. The original rows
must each appear exactly once and full catalog hashes bind their grantor values.
For this selected Neon target the actual grantor is `cloud_admin`, not a guessed
provider role. The two explicit SET edges remain separately constrained. No
provider-global original role/default is changed by this source preparation.

The optional `providerDatabaseRole` is distinct from application roles, operator
and the admin-membership grantor. It preserves ONLY exactly one each of existing
CONNECT/CREATE/TEMPORARY non-grantable database ACL rows for that pinned role,
owner and target database. It never permits schema/table/column privileges or
runtime membership. This pins the observed `neon_superuser` DB baseline without
confusing it with actual `cloud_admin` grantor or revoking provider originals.

## Installed readback role sequencing

The NOLOGIN migrator is not a table reader. All 18 metadata categories and the
identity row are captured as the actual migrator under the pinned bootstrap
session in one REPEATABLE READ READ ONLY transaction. For ONLY `histories` and
`enrollmentPolicy`, the existing operator executor temporarily SET LOCAL ROLE
schema owner, executes those fixed SELECTs, and returns to migrator. No USAGE,
SELECT, INHERIT or other grant is added to the migrator.

Each plan query carries `requiredCurrentRole`, `requiredSessionRole`,
`restoreCurrentRole` and fixed `roleContextSql`. The injected executor receives
that context as its fourth argument. It must measure the actual SQL role/read-only
context before/after the query and after restoring the migrator, returning
`roleEvidence:{before,after,restored}` with actual `current_role`, `session_role`
and `transaction_read_only` values. Missing/mismatched evidence refuses the
collector. `roleObservations` are returned separately from the 20 raw catalog
arrays so role provenance is retained without inventing result fields or changing
the already-reviewed raw BEFORE descriptor. Historical captures lacking per-query
measurements do not gain them retroactively. The source module still constructs
no connection or role-changing SQL transport; Root owns the actual executor.
