import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_AUTHORITY, NATIVE_SCOPES, NATIVE_SOURCE_FILES, BASE_HISTORY, FIRST_HISTORY,
  NATIVE_SCENARIOS, validateNativeContext, assertNativeSourcePin, matchesOwnedWait, nativePreparationPlan } from './test/native-first-profile-contract.mjs';

// Pure context/plan tests. They never import the native runner or pg, open a
// connection, initialize an engine or install a fixture.
const now = 1_800_000_000_000;
const permit = 'e'.repeat(64);
const pin = Object.fromEntries(NATIVE_SOURCE_FILES.map(file => [file, 'a'.repeat(64)]));
const valid = () => ({ authority: NATIVE_AUTHORITY, executionPermit: permit,
  notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
  scopes: Object.fromEntries(NATIVE_SCOPES.map(scope => [scope, true])), host: '127.0.0.1', port: 5432,
  database: 'rematch_pixel_test_0123456789abcdef', ownerRole: 'rematch_native_owner', runtimeRole: 'rematch_native_runtime',
  baseHistory: BASE_HISTORY, firstHistory: FIRST_HISTORY, sourceCommit: 'b'.repeat(40), sourcePin: { ...pin },
  fixtureMode: 'install-empty-owned-schemas-leave-for-review' });

test('native plan is executable preparation with concrete cases and no implicit target authority', () => {
  const plan = nativePreparationPlan();
  assert.equal(plan.action, 'PREPARATION_ONLY_NO_CONNECTION');
  assert.equal(plan.cases.length, 20); assert.equal(new Set(NATIVE_SCENARIOS).size, 20);
  assert.match(plan.forbiddenOperations, /No database\/role\/schema drop/);
  assert.ok(plan.filesToPin.includes('test/native-first-profile.mjs'));
});
test('exact finite approved native context and source pins copy/freeze without contacting anything', () => {
  const input = valid(), approved = validateNativeContext(input, { permit, now });
  assert.equal(Object.isFrozen(approved), true); assert.equal(Object.isFrozen(approved.sourcePin), true);
  input.sourcePin[NATIVE_SOURCE_FILES[0]] = 'c'.repeat(64);
  assert.equal(approved.sourcePin[NATIVE_SOURCE_FILES[0]], 'a'.repeat(64));
  assert.equal(assertNativeSourcePin(approved, pin), true);
});
for (const [name, patch] of Object.entries({
  remote: { host: 'db.example.invalid' }, socket: { host: '/tmp' }, alias: { host: 'localhost' },
  normalDatabase: { database: 'postgres' }, shortDatabase: { database: 'rematch_pixel_test_a' },
  sameRole: { runtimeRole: 'rematch_native_owner' }, missingRole: { runtimeRole: undefined }, nullRole: { ownerRole: null },
  roleInjection: { runtimeRole: 'role;DROP DATABASE x' },
  wrongHistory: { baseHistory: '0'.repeat(64) }, secret: { password: 'forbidden' }, connectionString: { url: 'postgres://forbidden' },
  noPermit: { executionPermit: '' }, noSource: { sourcePin: {} }, sourceExtra: { sourcePin: { ...pin, '../foreign': 'a'.repeat(64) } },
  wrongFixtureMode: { fixtureMode: 'production' }, sourceCommit: { sourceCommit: 'HEAD' },
})) test('native authority rejects ' + name, () => {
  assert.throws(() => validateNativeContext({ ...valid(), ...patch }, { permit, now }));
});
for (const name of NATIVE_SCOPES) test('native authority requires separate explicit ' + name + ' scope', () => {
  const context = valid(); context.scopes[name] = false;
  assert.throws(() => validateNativeContext(context, { permit, now }));
});
test('native permission is bounded and cannot be inferred from a context alone or an expired window', () => {
  for (const at of [now - 1, now + 60_000, now + 60_001]) assert.throws(() => validateNativeContext(valid(), { permit, now: at }));
  assert.throws(() => validateNativeContext(valid(), { now }));
  assert.throws(() => validateNativeContext(valid(), { permit: 'f'.repeat(64), now }));
  assert.throws(() => validateNativeContext({ ...valid(), expiresAt: new Date(now + 1_800_001).toISOString() }, { permit, now }));
  assert.throws(() => validateNativeContext({ ...valid(), expiresAt: 'tomorrow' }, { permit, now }));
});
test('changed, missing or extra source bytes refuse before a native connection could be constructed', () => {
  const context = validateNativeContext(valid(), { permit, now });
  assert.throws(() => assertNativeSourcePin(context, { ...pin, [NATIVE_SOURCE_FILES[0]]: 'c'.repeat(64) }));
  const missing = { ...pin }; delete missing[NATIVE_SOURCE_FILES[0]];
  assert.throws(() => assertNativeSourcePin(context, missing));
  assert.throws(() => assertNativeSourcePin(context, { ...pin, 'other.mjs': 'a'.repeat(64) }));
});
const expected = { database: 'rematch_pixel_test_0123456789abcdef', runtimeRole: 'rematch_native_runtime', receiverPid: 200, blockerPid: 100, event: 'held-row' };
const row = { datname: expected.database, usename: expected.runtimeRole, pid: 200,
  application_name: 'rematch-pixel-bound-return', wait_event_type: 'Lock', wait_event: 'transactionid', blocking_pids: [100] };
test('held wait requires exact owned DB/receiver and intended blocker, not an application-name match', () => {
  assert.equal(matchesOwnedWait(row, expected), true);
  for (const patch of [{ datname: 'other' }, { usename: 'other' }, { pid: 201 }, { application_name: 'other' },
    { blocking_pids: [101] }, { blocking_pids: [] }, { wait_event_type: 'Timeout' }]) assert.equal(matchesOwnedWait({ ...row, ...patch }, expected), false);
  assert.equal(matchesOwnedWait(row, { ...expected, receiverPid: 100 }), false);
});
test('trigger wait requires exact owned receiver PgSleep and no invented blocker proof', () => {
  const sleep = { ...row, wait_event_type: 'Timeout', wait_event: 'PgSleep', blocking_pids: [] };
  const own = { ...expected, blockerPid: null, event: 'trigger-sleep' };
  assert.equal(matchesOwnedWait(sleep, own), true);
  assert.equal(matchesOwnedWait({ ...sleep, pid: 201 }, own), false);
  assert.equal(matchesOwnedWait({ ...sleep, wait_event: 'ClientRead' }, own), false);
  assert.equal(matchesOwnedWait(sleep, { ...own, blockerPid: 100 }), false);
});
