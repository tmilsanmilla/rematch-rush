import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbuseGuard } from './server/pixel-abuse.mjs';
const key = 'a'.repeat(64);
test('bounded worker budget refuses bursts without extending the fixed window', () => {
  let time = 1000;
  const guard = createAbuseGuard({ clock: () => time, perKey: 3 });
  assert.equal(guard.admit(key, 3), true);
  assert.equal(guard.admit(key), false);
  time = 60999; assert.equal(guard.admit(key), false);
  time = 61000; assert.equal(guard.admit(key), true);
});
test('distinct key and total caps fail closed without an unbounded map', () => {
  const guard = createAbuseGuard({ clock: () => 1000, maximumKeys: 2, total: 3 });
  assert.equal(guard.admit('a'.repeat(64)), true);
  assert.equal(guard.admit('b'.repeat(64)), true);
  assert.equal(guard.admit('c'.repeat(64)), false);
  assert.equal(guard.admit('a'.repeat(64)), true);
  assert.equal(guard.admit('b'.repeat(64)), false);
});
test('circuit breaker never stores raw addresses, identities or malformed keys', () => {
  const guard = createAbuseGuard({ clock: () => 1000 });
  for (const value of ['127.0.0.1', 'player@example.invalid', '', 'a'.repeat(1000), undefined]) assert.equal(guard.admit(value), false);
  assert.equal(guard.admit('anonymous'), true);
  for (const cost of [0, -1, NaN, 1.1, 13]) assert.equal(guard.admit(key, cost), false);
});
