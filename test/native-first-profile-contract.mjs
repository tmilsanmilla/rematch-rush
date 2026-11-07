// Pure preparation/authority contract. Importing this file never imports pg,
// opens a socket, starts an engine, installs SQL, or reads credentials.
export const NATIVE_AUTHORITY = 'rematch-native-first-profile-fixture-v1';
export const BASE_HISTORY = '086a080ccdb16a5d5186016563eb06ec007d55e1850079ae409c9b445f71f54c';
export const FIRST_HISTORY = 'eb007d0be98e106faa1dea876eae94362ae4d15bf8290ec8c9f37be0d889e9f1';
export const NATIVE_SCOPES = Object.freeze(['fixtureDDL', 'syntheticDML', 'ownedTriggers', 'readOnlyCatalog', 'roleUse']);
export const NATIVE_SOURCE_FILES = Object.freeze([
  'package.json', 'package-lock.json', 'pixel-profile-storage.test.mjs',
  'server/pixel-accepted-identity.mjs', 'server/pixel-handler.mjs',
  'server/pixel-abuse.mjs',
  'server/pixel-oidc.mjs', 'server/pixel-proof.mjs', 'server/pixel-store.mjs',
  'server/pixel-profile-store.mjs', 'server/pixel-target.mjs',
  'server/pixel-enrollment.mjs', 'server/pixel-enrollment-store.mjs',
  'test/support/pixel-profile-model.mjs',
  'test/fixtures/pixel-local-schema.sql', 'test/fixtures/pixel-first-profile-local.sql',
  'test/native-first-profile-contract.mjs', 'test/native-first-profile-plan.mjs',
  'test/native-first-profile.mjs', 'test/support/pixel-profile-transport.mjs',
]);
export const NATIVE_SCENARIOS = Object.freeze([
  'actual transport Create, signed proof, cookie session, logout and immutable return',
  'same consumed attempt concurrent completion creates exactly one profile',
  'different targets for one immutable subject cannot duplicate or rebind',
  'consumed proof/attempt replay leaves original rows unchanged',
  'runtime role is non-owner and cannot change protected owner/proof columns',
  'AFTER session insert failure atomically rolls back every Create write',
  'deferred session trigger failure atomically rolls back every Create write',
  'post-write created-at corruption is rejected by persisted tuple reread',
  'held attempt row crosses original attempt deadline',
  'held attempt row crosses original proof deadline',
  'held attempt row crosses original admission deadline',
  'held attempt row crosses original signed identity deadline',
  'AFTER session write wait crosses proof deadline',
  'AFTER completion write wait crosses attempt deadline',
  'deferred trigger flush wait crosses proof deadline',
  'shortened result session expires during AFTER completion wait',
  'known higher epoch persists before existing-owner Create refusal',
  'known higher epoch persists before optional name/proof refusal',
  'failed floor persistence rolls back security writes and stops Create',
  'held old-session lock preserves learned retirement after optional expiry',
]);

const digest = /^[a-f0-9]{64}$/;
const role = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const reject = () => { throw new Error('Native first-profile execution is not authorized by an exact local fixture context.'); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** A context is an operator handoff, never authority inferred from a path/env. */
export function validateNativeContext(value, { permit, now = Date.now() } = {}) {
  const keys = ['authority', 'executionPermit', 'notBefore', 'expiresAt', 'scopes', 'host', 'port', 'database',
    'ownerRole', 'runtimeRole', 'baseHistory', 'firstHistory', 'sourceCommit', 'sourcePin', 'fixtureMode'];
  if (!exactKeys(value, keys) || value.authority !== NATIVE_AUTHORITY || value.fixtureMode !== 'install-empty-owned-schemas-leave-for-review' ||
      typeof permit !== 'string' || !digest.test(permit) || value.executionPermit !== permit ||
      value.host !== '127.0.0.1' || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 ||
      typeof value.database !== 'string' || !/^rematch_pixel_test_[a-f0-9]{16,32}$/.test(value.database) ||
      typeof value.ownerRole !== 'string' || typeof value.runtimeRole !== 'string' ||
      !role.test(value.ownerRole) || !role.test(value.runtimeRole) || value.ownerRole === value.runtimeRole ||
      value.baseHistory !== BASE_HISTORY || value.firstHistory !== FIRST_HISTORY ||
      typeof value.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
      !exactKeys(value.scopes, NATIVE_SCOPES) || NATIVE_SCOPES.some(key => value.scopes[key] !== true) ||
      !exactKeys(value.sourcePin, NATIVE_SOURCE_FILES) || NATIVE_SOURCE_FILES.some(key => typeof value.sourcePin[key] !== 'string' || !digest.test(value.sourcePin[key]))) reject();
  const start = Date.parse(value.notBefore), end = Date.parse(value.expiresAt);
  if (!Number.isSafeInteger(now) || !Number.isFinite(start) || !Number.isFinite(end) ||
      new Date(start).toISOString() !== value.notBefore || new Date(end).toISOString() !== value.expiresAt ||
      end <= start || end - start > 30 * 60_000 || now < start || now >= end) reject();
  return Object.freeze({ ...value, scopes: Object.freeze({ ...value.scopes }), sourcePin: Object.freeze({ ...value.sourcePin }) });
}

export function assertNativeSourcePin(context, actual) {
  if (!exactKeys(actual, NATIVE_SOURCE_FILES) || NATIVE_SOURCE_FILES.some(key => actual[key] !== context.sourcePin[key])) reject();
  return true;
}

/** Pin every observed wait to this DB, exact active receiver and intended blocker. */
export function matchesOwnedWait(row, { database, runtimeRole, receiverPid, blockerPid = null, event } = {}) {
  if (!row || row.datname !== database || row.usename !== runtimeRole || row.application_name !== 'rematch-pixel-bound-return' ||
      !Number.isSafeInteger(receiverPid) || receiverPid <= 0 || Number(row.pid) !== receiverPid) return false;
  if (event === 'held-row') return Number.isSafeInteger(blockerPid) && blockerPid > 0 && blockerPid !== receiverPid &&
    row.wait_event_type === 'Lock' && Array.isArray(row.blocking_pids) && row.blocking_pids.map(Number).includes(blockerPid);
  return event === 'trigger-sleep' && blockerPid === null && row.wait_event_type === 'Timeout' && row.wait_event === 'PgSleep';
}

export function nativePreparationPlan() {
  return Object.freeze({
    authority: NATIVE_AUTHORITY,
    action: 'PREPARATION_ONLY_NO_CONNECTION',
    host: '127.0.0.1',
    requiredTarget: 'An explicitly authorized, exclusively owned, already-created empty rematch_pixel_test_<16..32hex> TCP database and distinct already-existing owner/runtime login roles.',
    requiredScopes: NATIVE_SCOPES,
    finiteWindowMaximumSeconds: 1800,
    filesToPin: NATIVE_SOURCE_FILES,
    cases: NATIVE_SCENARIOS,
    fixtureMode: 'install-empty-owned-schemas-leave-for-review',
    permittedLaterOperations: 'Install the two exact LOCAL fixtures and narrowly grant the existing runtime role; synthetic DML including TRUNCATE of the six exclusively owned fixture data tables between cases; only harness-owned trigger/function setup/removal; pinned read-only catalog/wait observations. Leave fixture schemas/rows for operator review.',
    forbiddenOperations: 'No database/role/schema drop, no database/role creation, no process/service/IPC cleanup, no borrowed/remote endpoint, no secrets/ambient PG fallback, no real provider/identity/mail, no public activation.',
    evidenceLimit: 'A plan or guarded preparation pass is not native PostgreSQL execution. Synthetic transport signatures and password attestations are not genuine identity/current-password proof.',
  });
}
