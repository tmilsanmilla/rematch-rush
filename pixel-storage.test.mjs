import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readTargetConfig, PixelTargetError } from './server/pixel-target.mjs';
import { createPostgresStore } from './server/pixel-store.mjs';

const history = createHash('sha256').update('rematch-pixel-bound-return-local-v1').digest('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const envFor = (overrides = {}) => ({
  NODE_ENV: 'test', REMATCH_PIXEL_LOCAL_TEST_MODE: 'true', REMATCH_PIXEL_TARGET_APPROVED: 'true',
  REMATCH_PIXEL_DATABASE_URL: 'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef',
  REMATCH_PIXEL_APPROVED_HOST: '127.0.0.1', REMATCH_PIXEL_APPROVED_PORT: '5432',
  REMATCH_PIXEL_APPROVED_DATABASE: 'rematch_pixel_test_abcdef', REMATCH_PIXEL_APPROVED_ROLE: 'rematch_test',
  REMATCH_PIXEL_APPROVED_HISTORY: history, ...overrides,
});

// A query-recording adapter double, not PostgreSQL execution evidence. The real
// optional suite below exercises the same cases on an owned native local DB.
function guardedPoolDouble({ attempts = 0, sessions = 0, perBinding = 0, admitted = true, retired = false } = {}) {
  const statements = [];
  const shapes = {
    schema_meta: { singleton: 'bool', contract_version: 'int4', migration_hash: 'text' },
    accounts: { id: 'uuid', display_name: 'text', created_at: 'timestamptz' },
    bindings: { issuer: 'text', subject: 'text', account_id: 'uuid', floor_epoch: 'int8', created_at: 'timestamptz' },
    attempts: { state_hash: 'text', browser_hash: 'text', nonce: 'text', code_verifier: 'text', redirect_uri: 'text', expires_at: 'timestamptz', created_at: 'timestamptz', consumed_at: 'timestamptz', cancelled_at: 'timestamptz', completed_at: 'timestamptz' },
    sessions: { token_hash: 'text', issuer: 'text', subject: 'text', account_id: 'uuid', attempt_state_hash: 'text', signed_epoch: 'int8', expires_at: 'timestamptz', created_at: 'timestamptz', revoked_at: 'timestamptz' },
  };
  const constraints = [
    ['schema_meta','p',['singleton']], ['accounts','p',['id']], ['bindings','p',['issuer','subject']], ['bindings','u',['account_id']],
    ['bindings','u',['issuer','subject','account_id']], ['bindings','f',['account_id'],'accounts',['id']], ['attempts','p',['state_hash']],
    ['sessions','p',['token_hash']], ['sessions','u',['attempt_state_hash']], ['sessions','f',['attempt_state_hash'],'attempts',['state_hash']],
    ['sessions','f',['issuer','subject','account_id'],'bindings',['issuer','subject','account_id']],
  ].map(([table_name,contype,columns,referenced_table,referenced_columns]) => ({ table_name,contype,columns,referenced_schema: referenced_table ? 'rematch_pixel' : null,referenced_table,referenced_columns: referenced_columns || [],confdeltype: referenced_table ? 'r' : ' ' }));
  class PoolDouble {
    on() {}
    async connect() { return { release() {}, query: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT current_database')) return { rows: [{ database: 'rematch_pixel_test_abcdef', role: 'rematch_test', server_address: '127.0.0.1', server_port: 5432 }] };
      if (sql.includes('FROM rematch_pixel.schema_meta')) return { rows: [{ singleton: true, contract_version: 1, migration_hash: history }] };
      if (sql.includes('FROM information_schema.columns')) return { rows: Object.entries(shapes).flatMap(([table_name, columns]) => Object.entries(columns).map(([column_name, udt_name]) => ({ table_name,column_name,udt_name,is_nullable: ['consumed_at','cancelled_at','completed_at','revoked_at'].includes(column_name) ? 'YES' : 'NO' }))) };
      if (sql.includes('FROM pg_constraint')) return { rows: constraints };
      if (sql.startsWith('SELECT count(*)::text AS retained FROM rematch_pixel.attempts')) return { rows: [{ retained: String(attempts) }] };
      if (sql.startsWith('SELECT count(*)::text AS retained,')) return { rows: [{ retained: String(sessions), per_binding: String(perBinding) }] };
      if (sql.startsWith('SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=$1 AND cancelled_at')) return { rows: retired ? [{ state_hash: hash('retired-attempt') }] : [] };
      if (sql.startsWith('SELECT state_hash FROM rematch_pixel.attempts WHERE state_hash=')) return { rows: admitted ? [{ state_hash: params[0] }] : [] };
      if (sql.startsWith('SELECT a.state_hash,a.expires_at::text AS attempt_expires_at')) return { rows: admitted ? [{ state_hash: params[0], attempt_expires_at: new Date(Date.now() + 60_000).toISOString(), attempt_snapshot: 'synthetic' }] : [] };
      if (sql.startsWith('SELECT account_id,floor_epoch FROM rematch_pixel.bindings')) return { rows: [{ account_id: 'a6d2a7ec-7232-44f3-b512-cf63835d0b59', floor_epoch: '1' }] };
      if (sql.startsWith('SELECT b.account_id')) return { rows: [{ account_id: 'a6d2a7ec-7232-44f3-b512-cf63835d0b59', floor_epoch: '1', display_name: 'Original' }] };
      return { rows: [], rowCount: 0 };
    } }; }
    async end() {}
  }
  return { PoolDouble, statements };
}

// SYNTHETIC TRANSACTION MODEL, NOT POSTGRESQL/LOCK/TRIGGER PROOF. Unlike the
// query-recording guards above, each client gets a private draft on BEGIN.
// COMMIT publishes it and ROLLBACK discards it, so these tests inspect durable
// data rather than asserting that an UPDATE string appeared in a SQL log.
function transactionalPoolDouble(options = {}) {
  const issuer = 'https://pixel-pulse-websites.vercel.app/api/sso', subject = 'existing';
  const accountId = 'a6d2a7ec-7232-44f3-b512-cf63835d0b59', otherId = 'b6d2a7ec-7232-44f3-b512-cf63835d0b59';
  const stateHash = hash('state'), browserHash = hash('browser'), tokenHash = hash('new');
  const initialTime = 1_800_000_000_000;
  let now = initialTime, transaction = 0;
  let committed = {
    accounts: [{ id: accountId, display_name: 'Original', progress: { wins: 7 }, role: 'player' }, { id: otherId, display_name: 'Other', progress: { wins: 3 }, role: 'player' }],
    bindings: [{ issuer, subject, account_id: accountId, floor_epoch: options.floor ?? 1 }, { issuer, subject: 'unrelated', account_id: otherId, floor_epoch: 4 }],
    attempts: [{ state_hash: stateHash, browser_hash: browserHash, consumed_at: initialTime - 1000, cancelled_at: null, completed_at: null, expires_at: initialTime + (options.attemptRemaining ?? 60_000) }],
    sessions: [
      { token_hash: hash('old'), issuer, subject, account_id: accountId, signed_epoch: options.floor ?? 1, expires_at: initialTime + 120_000, revoked_at: null },
      { token_hash: hash('current'), issuer, subject, account_id: accountId, signed_epoch: 9, expires_at: initialTime + 120_000, revoked_at: null },
      { token_hash: hash('unrelated'), issuer, subject: 'unrelated', account_id: otherId, signed_epoch: 4, expires_at: initialTime + 120_000, revoked_at: null },
    ],
  };
  const original = structuredClone(committed), events = [], statements = [];
  const { PoolDouble: MetadataPool } = guardedPoolDouble();
  const metadata = new MetadataPool();
  class TransactionPool {
    on() {}
    async connect() {
      const descriptor = await metadata.connect();
      let draft, id;
      return { release() {}, query: async (sql, params = []) => {
        statements.push({ sql, params, transaction: id });
        if (sql === 'BEGIN') { assert.equal(draft, undefined); id = ++transaction; draft = structuredClone(committed); events.push({ type: 'begin', id }); return { rows: [], rowCount: 0 }; }
        if (sql === 'COMMIT') { assert.ok(draft); committed = structuredClone(draft); draft = undefined; events.push({ type: 'commit', id, state: structuredClone(committed) }); return { rows: [], rowCount: 0 }; }
        if (sql === 'ROLLBACK') { assert.ok(draft); draft = undefined; events.push({ type: 'rollback', id }); return { rows: [], rowCount: 0 }; }
        assert.ok(draft, 'all model queries require an explicit transaction');
        if (sql.startsWith('SET LOCAL') || sql === 'SET CONSTRAINTS ALL IMMEDIATE' || sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
        if (sql.startsWith('SELECT current_database') || sql.includes('FROM rematch_pixel.schema_meta') || sql.includes('FROM information_schema.columns') || sql.includes('FROM pg_constraint')) return descriptor.query(sql, params);
        if (sql.startsWith('DELETE FROM rematch_pixel.sessions')) {
          const before = draft.sessions.length; draft.sessions = draft.sessions.filter(row => row.expires_at > now);
          return { rows: [], rowCount: before - draft.sessions.length };
        }
        if (sql.startsWith('DELETE FROM rematch_pixel.attempts')) {
          const before = draft.attempts.length; draft.attempts = draft.attempts.filter(row => row.expires_at > now || draft.sessions.some(session => session.attempt_state_hash === row.state_hash));
          return { rows: [], rowCount: before - draft.attempts.length };
        }
        if (sql.startsWith('SELECT a.state_hash,a.expires_at::text AS attempt_expires_at')) {
          const attempt = draft.attempts.find(row => row.state_hash === params[0] && row.browser_hash === params[1] && row.consumed_at !== null && row.cancelled_at === null && row.completed_at === null && row.expires_at > now);
          const snapshot = attempt && { ...attempt }; if (snapshot) delete snapshot.completed_at;
          return { rows: attempt ? [{ state_hash: attempt.state_hash, attempt_expires_at: new Date(attempt.expires_at).toISOString(), attempt_snapshot: JSON.stringify(snapshot) }] : [] };
        }
        if (sql.startsWith('SELECT b.account_id')) {
          const binding = draft.bindings.find(row => row.issuer === params[0] && row.subject === params[1]);
          const account = binding && draft.accounts.find(row => row.id === binding.account_id);
          return { rows: account ? [{ ...binding, floor_epoch: String(binding.floor_epoch), display_name: account.display_name }] : [] };
        }
        if (sql.startsWith('SELECT account_id,floor_epoch FROM rematch_pixel.bindings')) {
          const binding = draft.bindings.find(row => row.issuer === params[0] && row.subject === params[1]);
          return { rows: binding ? [{ account_id: binding.account_id, floor_epoch: String(binding.floor_epoch) }] : [] };
        }
        if (sql.startsWith('SELECT count(*)::text AS retained,')) return { rows: [{ retained: String(options.globalCap ? 10000 : draft.sessions.length), per_binding: String(options.bindingCap ? 10 : draft.sessions.filter(row => row.issuer === params[0] && row.subject === params[1]).length) }] };
        if (sql === 'SELECT clock_timestamp()::text AS minted_at') return { rows: [{ minted_at: new Date(now).toISOString() }] };
        if (sql.startsWith('UPDATE rematch_pixel.bindings SET floor_epoch=')) {
          let changed = 0;
          for (const row of draft.bindings) if (row.issuer === params[0] && row.subject === params[1]) { row.floor_epoch = Math.max(row.floor_epoch, params[2]); changed++; }
          return { rows: [], rowCount: changed };
        }
        if (sql.startsWith('UPDATE rematch_pixel.sessions SET revoked_at=clock_timestamp() WHERE issuer=')) {
          let changed = 0;
          for (const row of draft.sessions) if (row.issuer === params[0] && row.subject === params[1] && row.signed_epoch < params[2] && row.revoked_at === null) { row.revoked_at = now; changed++; }
          return { rows: [], rowCount: changed };
        }
        if (sql.startsWith('INSERT INTO rematch_pixel.sessions')) {
          if (options.writeFailure) throw new Error('SYNTHETIC session write failed');
          if (options.expireBeforeInsert) now = initialTime + 61_000;
          const attempt = draft.attempts.find(row => row.state_hash === params[6] && row.cancelled_at === null && row.completed_at === null && row.expires_at > now);
          const identityExpiry = new Date(params[5]).getTime();
          if (!attempt || identityExpiry <= now) return { rows: [], rowCount: 0 };
          const row = { token_hash: params[0], issuer: params[1], subject: params[2], account_id: params[3], signed_epoch: params[4], expires_at: Math.min(identityExpiry, new Date(params[7]).getTime() + 300_000, initialTime + (options.shortSessionRemaining ?? 300_000)), attempt_state_hash: params[6], revoked_at: null };
          draft.sessions.push(row);
          if (options.advanceAfterInsert !== undefined) now = initialTime + options.advanceAfterInsert;
          return { rows: [{ ...row, expires_at: new Date(row.expires_at), session_expires_at: new Date(row.expires_at).toISOString(), session_snapshot: JSON.stringify(row) }], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE rematch_pixel.attempts SET completed_at=')) {
          if (options.completionFailure) throw new Error('SYNTHETIC completion write failed');
          const row = draft.attempts.find(attempt => attempt.state_hash === params[0]);
          if (row) row.completed_at = now;
          const completed = row ? new Date(row.completed_at).toISOString() : null;
          if (options.advanceAfterCompletion !== undefined) now = initialTime + options.advanceAfterCompletion;
          if (options.mutateAttempt && row) row.expires_at += 60_000;
          if (options.mutateSession) draft.sessions.find(session => session.token_hash === tokenHash).signed_epoch++;
          return { rows: row ? [{ completed_at: completed }] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.startsWith("SELECT (to_jsonb(a)-'completed_at')::text AS attempt_snapshot")) {
          const row = draft.attempts.find(attempt => attempt.state_hash === params[0] && attempt.browser_hash === params[1]);
          const snapshot = row && { ...row }; if (snapshot) delete snapshot.completed_at;
          return { rows: row ? [{ attempt_snapshot: JSON.stringify(snapshot), completed_at: row.completed_at === null ? null : new Date(row.completed_at).toISOString() }] : [] };
        }
        if (sql.startsWith('SELECT to_jsonb(s)::text AS session_snapshot')) {
          const row = draft.sessions.find(session => session.token_hash === params[0]);
          return { rows: row ? [{ session_snapshot: JSON.stringify(row) }] : [] };
        }
        if (sql.startsWith('WITH fence AS MATERIALIZED')) {
          if (options.fenceException) throw new Error('SYNTHETIC final clock read failed');
          const times = params.map(value => new Date(value).getTime());
          return { rows: [{ fence_at: new Date(now).toISOString(), deadlines_live: !options.fenceFailure && times.slice(0, 3).every(value => value > now) && times[2] <= times[1] && times[2] <= times[3] + 300_000 }] };
        }
        if (sql.startsWith('SELECT s.account_id,a.display_name,s.expires_at')) {
          const saved = draft.sessions.find(row => row.token_hash === params[0] && row.revoked_at === null && row.expires_at > now && draft.bindings.some(binding => binding.issuer === row.issuer && binding.subject === row.subject && binding.account_id === row.account_id && binding.floor_epoch === row.signed_epoch));
          return { rows: saved ? [{ account_id: saved.account_id, display_name: draft.accounts.find(row => row.id === saved.account_id).display_name, expires_at: new Date(saved.expires_at) }] : [] };
        }
        throw new Error(`Unmodeled transaction query: ${sql}`);
      } };
    }
    async end() {}
  }
  return { PoolDouble: TransactionPool, events, statements, original, state: () => structuredClone(committed), now: () => now,
    args: { issuer, subject, credentialVersion: 9, identityExpiresAt: new Date(initialTime + (options.identityRemaining ?? 120_000)), tokenHash, stateHash, browserHash } };
}

test('unapproved or incomplete targets fail before constructing a pool and ignore generic DATABASE_URL', () => {
  let pools = 0;
  class NoPool { constructor() { pools++; } }
  for (const candidate of [{}, { DATABASE_URL: envFor().REMATCH_PIXEL_DATABASE_URL }, { ...envFor(), REMATCH_PIXEL_TARGET_APPROVED: 'false' }]) {
    assert.throws(() => createPostgresStore(readTargetConfig(candidate), { PoolClass: NoPool }), PixelTargetError);
  }
  assert.throws(() => createPostgresStore({ connection: {}, pins: {} }, { PoolClass: NoPool }), PixelTargetError);
  assert.equal(pools, 0);
});

test('all explicit host/port/database/role/history pins are mandatory and exact', () => {
  for (const key of ['REMATCH_PIXEL_APPROVED_HOST', 'REMATCH_PIXEL_APPROVED_PORT', 'REMATCH_PIXEL_APPROVED_DATABASE', 'REMATCH_PIXEL_APPROVED_ROLE', 'REMATCH_PIXEL_APPROVED_HISTORY']) {
    assert.throws(() => readTargetConfig(envFor({ [key]: undefined })), PixelTargetError, key);
    assert.throws(() => readTargetConfig(envFor({ [key]: 'mismatch' })), PixelTargetError, key);
  }
});

test('URL aliases and TLS/query overrides cannot bypass exact target approval', () => {
  const attacks = [
    'postgresql://rematch_test@127.0.0.2:5432/rematch_pixel_test_abcdef',
    'postgresql://rematch_test@127.0.0.1:5433/rematch_pixel_test_abcdef',
    'postgresql://different@127.0.0.1:5432/rematch_pixel_test_abcdef',
    'postgresql://rematch_test@127.0.0.1:5432/different',
    'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef?sslmode=disable',
    'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef?options=-csearch_path=public',
    'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef?host=outside.example',
    'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef#fragment',
    'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef#',
    'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef/other',
    'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef%2Fother',
    'https://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef',
  ];
  for (const raw of attacks) assert.throws(() => readTargetConfig(envFor({ REMATCH_PIXEL_DATABASE_URL: raw })), PixelTargetError);
});

test('loopback access requires test mode and disposable database naming', () => {
  for (const overrides of [{ NODE_ENV: 'production' }, { REMATCH_PIXEL_LOCAL_TEST_MODE: 'false' }, { REMATCH_PIXEL_DATABASE_URL: 'postgresql://rematch_test@127.0.0.1:5432/production', REMATCH_PIXEL_APPROVED_DATABASE: 'production' }]) {
    assert.throws(() => readTargetConfig(envFor(overrides)), PixelTargetError);
  }
  assert.equal(readTargetConfig(envFor()).localTest, true);
});

test('owned socket fixture is confined to explicit test mode and an exact new private directory', () => {
  const socket = '/private/tmp/rematch-enrollment-pg-Abc123xy/socket';
  const config = readTargetConfig(envFor({ REMATCH_PIXEL_OWNED_SOCKET: socket }));
  assert.equal(config.connection.host, socket);
  assert.equal(config.ownedSocket, socket);
  assert.equal(config.pins.host, '127.0.0.1');
  for (const invalid of ['/tmp/rematch-enrollment-pg-Abc123xy/socket', '/private/tmp/other-owner/socket', '/private/tmp/rematch-enrollment-pg-Abc123xy/../socket', '/private/tmp/rematch-enrollment-pg-Abc123xy/socket/extra', '', null]) {
    assert.throws(() => readTargetConfig(envFor({ REMATCH_PIXEL_OWNED_SOCKET: invalid })), PixelTargetError);
  }
  assert.throws(() => readTargetConfig(envFor({ NODE_ENV: 'production', REMATCH_PIXEL_OWNED_SOCKET: socket })), PixelTargetError);
  assert.throws(() => readTargetConfig(envFor({ NODE_ENV: 'production', REMATCH_PIXEL_LOCAL_TEST_MODE: 'false', REMATCH_PIXEL_OWNED_SOCKET: socket,
    REMATCH_PIXEL_DATABASE_URL: 'postgresql://rematch_test:synthetic_only@db.example:5432/rematch', REMATCH_PIXEL_APPROVED_HOST: 'db.example', REMATCH_PIXEL_APPROVED_DATABASE: 'rematch' })), PixelTargetError);
});

test('owned socket runtime verifies NULL inet identity and exact port without privileged setting reads', async () => {
  const socket='/private/tmp/rematch-enrollment-pg-Abc123xy/socket';
  for (const patch of [{}, {configured_port:5433}, {server_address:'127.0.0.1'}, {server_port:5432}]) {
    const {PoolDouble:MetadataPool}=guardedPoolDouble();const metadata=await new MetadataPool().connect();const statements=[];
    class SocketPool {
      on() {} async end() {}
      async connect(){return {release(){},query(sql,args){statements.push(sql);
        assert.equal(sql.includes("current_setting('unix_socket_directories')"),false,'No broad settings role needed');
        if(sql.startsWith('SELECT current_database'))return Promise.resolve({rows:[{database:'rematch_pixel_test_abcdef',role:'rematch_test',server_address:null,server_port:null,configured_port:5432,...patch}]});
        return metadata.query(sql,args);
      } };}
    }
    const store=createPostgresStore(readTargetConfig(envFor({REMATCH_PIXEL_OWNED_SOCKET:socket})),{PoolClass:SocketPool});
    if(Object.keys(patch).length)await assert.rejects(store.checkReady(),{code:'PIXEL_TARGET_MISMATCH'});else assert.equal(await store.checkReady(),true);
    assert.ok(statements.some(sql=>sql.includes("current_setting('port')")));await store.close();
  }
});

test('malformed numeric/DNS targets and alternative loopback spellings reject before pool creation', () => {
  for (const host of ['db..example', 'db-.example', `${'a'.repeat(64)}.example`, '999.999.999.999', '2130706433', '127.1', '127.000.000.001', '127.0.0.2', '0.0.0.0']) {
    assert.throws(() => readTargetConfig(envFor({ NODE_ENV: 'production', REMATCH_PIXEL_LOCAL_TEST_MODE: 'false',
      REMATCH_PIXEL_DATABASE_URL: `postgresql://rematch_test:synthetic_only@${host}:5432/rematch`, REMATCH_PIXEL_APPROVED_HOST: host, REMATCH_PIXEL_APPROVED_DATABASE: 'rematch' })), PixelTargetError);
  }
});

test('future explicitly approved nonlocal connection requires TLS and never uses ambient PG password', async () => {
  const config = readTargetConfig(envFor({
    NODE_ENV: 'production', REMATCH_PIXEL_LOCAL_TEST_MODE: 'false',
    REMATCH_PIXEL_DATABASE_URL: 'postgresql://rematch_runtime:synthetic_only@db.example:5432/rematch',
    REMATCH_PIXEL_APPROVED_HOST: 'db.example', REMATCH_PIXEL_APPROVED_DATABASE: 'rematch', REMATCH_PIXEL_APPROVED_ROLE: 'rematch_runtime',
  }));
  let captured;
  class NoNetworkPool { constructor(value) { captured = value; } on() {} async end() {} }
  const store = createPostgresStore(config, { PoolClass: NoNetworkPool });
  assert.deepEqual(captured.ssl, { rejectUnauthorized: true });
  assert.equal(await captured.password(), 'synthetic_only');
  assert.equal(captured.host, 'db.example');
  assert.equal(Object.hasOwn(captured, 'connectionString'), false);
  assert.equal(captured.options, '-c search_path=pg_catalog -c timezone=UTC');
  assert.equal(captured.replication, 'false');
  assert.equal(captured.client_encoding, 'UTF8');
  assert.equal(captured.sslnegotiation, 'postgres');
  await store.close();
});

test('target configuration errors contain neither synthetic password nor connection value', () => {
  const secret = 'SYNTHETIC_DO_NOT_ECHO_123';
  try { readTargetConfig(envFor({ REMATCH_PIXEL_DATABASE_URL: `postgresql://rematch_test:${secret}@unapproved.example/private` })); assert.fail('must reject'); }
  catch (error) {
    assert.equal(error.code, 'PIXEL_TARGET_CONFIG');
    assert.equal(String(error).includes(secret), false);
    assert.equal(JSON.stringify(error).includes('unapproved.example'), false);
  }
});

test('an approved hostname resolving to a loopback backend is refused outside local test mode', async () => {
  const config = readTargetConfig(envFor({
    NODE_ENV: 'production', REMATCH_PIXEL_LOCAL_TEST_MODE: 'false',
    REMATCH_PIXEL_DATABASE_URL: 'postgresql://rematch_runtime:synthetic_only@db.example:5432/rematch',
    REMATCH_PIXEL_APPROVED_HOST: 'db.example', REMATCH_PIXEL_APPROVED_DATABASE: 'rematch', REMATCH_PIXEL_APPROVED_ROLE: 'rematch_runtime',
  }));
  for (const address of ['127.0.0.1', '127.7.8.9', '::1', '::ffff:127.0.0.1', null]) {
    const statements = [];
    class LoopbackPool {
      on() {}
      async connect() { return { query: async text => { statements.push(text); return { rows: text.startsWith('SELECT current_database') ? [{ database: 'rematch', role: 'rematch_runtime', server_address: address, server_port: 5432 }] : [] }; }, release() {} }; }
      async end() {}
    }
    const store = createPostgresStore(config, { PoolClass: LoopbackPool });
    await assert.rejects(store.checkReady(), { code: 'PIXEL_TARGET_MISMATCH' });
    assert.equal(statements.some(sql => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(sql)), false);
    await store.close();
  }
});

test('actual target mismatch rolls back before touching attempt/session data', async () => {
  const statements = [];
  let released = false;
  class WrongTargetPool {
    on() {}
    async connect() { return { query: async text => { statements.push(text); return { rows: text.startsWith('SELECT current_database') ? [{ database: 'different', role: 'rematch_test', server_address: '127.0.0.1', server_port: 5432 }] : [] }; }, release() { released = true; } }; }
    async end() {}
  }
  const store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: WrongTargetPool });
  await assert.rejects(store.checkReady(), { code: 'PIXEL_TARGET_MISMATCH' });
  assert.equal(statements.some(sql => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(sql)), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(released, true);
  await store.close();
});

test('missing schema history never falls back to runtime DDL or initializes storage', async () => {
  const statements = [];
  class MissingSchemaPool {
    on() {}
    async connect() { return { query: async text => {
      statements.push(text);
      if (text.startsWith('SELECT current_database')) return { rows: [{ database: 'rematch_pixel_test_abcdef', role: 'rematch_test', server_address: '127.0.0.1', server_port: 5432 }] };
      if (text.includes('FROM rematch_pixel.schema_meta')) throw new Error('synthetic database URL must not escape');
      return { rows: [] };
    }, release() {} }; }
    async end() {}
  }
  const store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: MissingSchemaPool });
  await assert.rejects(store.getSession({ tokenHash: hash('synthetic') }), error => error.code === 'PIXEL_STORAGE_UNAVAILABLE' && !String(error).includes('synthetic database'));
  assert.equal(statements.some(sql => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(sql)), false);
  await store.close();
});

test('attempt ceiling refuses insertion while committing only bounded expired-row cleanup', async () => {
  const { PoolDouble, statements } = guardedPoolDouble({ attempts: 1000 });
  const store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: PoolDouble });
  await assert.rejects(store.createAttempt({ stateHash: hash('cap-state'), browserHash: hash('cap-browser'), nonce: 'n'.repeat(43), codeVerifier: 'v'.repeat(43), expiresAt: new Date(Date.now()+60000), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse' }), { code: 'PIXEL_STORAGE_UNAVAILABLE' });
  const sql = statements.map(row => row.sql);
  assert.ok(sql.findIndex(value => value.includes('pg_advisory_xact_lock')) < sql.findIndex(value => value.startsWith('DELETE')));
  for (const deletion of sql.filter(value => value.startsWith('DELETE'))) { assert.match(deletion, /expires_at<=clock_timestamp\(\)/); assert.match(deletion, /LIMIT 100/); }
  assert.ok(sql.findIndex(value => value.startsWith('DELETE FROM rematch_pixel.sessions')) < sql.findIndex(value => value.startsWith('DELETE FROM rematch_pixel.attempts')));
  assert.match(sql.find(value => value.startsWith('DELETE FROM rematch_pixel.attempts')), /NOT EXISTS/);
  assert.equal(sql.some(value => value.startsWith('INSERT')), false);
  assert.equal(sql.at(-1), 'COMMIT');
  await store.close();
});

test('synthetic transaction model: trusted higher epoch retirement survives mint capacity, expiry and write refusal', async t => {
  for (const [name, options, throws] of [
    ['global retained ceiling', { globalCap: true }, false], ['per-binding retained ceiling', { bindingCap: true }, false],
    ['already expired optional identity mint', { identityRemaining: -1 }, false],
    ['identity/attempt expires before insertion', { expireBeforeInsert: true, identityRemaining: 60_000 }, false],
    ['forced session write exception', { writeFailure: true }, true],
    ['forced completion write exception', { completionFailure: true }, true],
    ['original attempt expires during session write', { advanceAfterInsert: 60_000 }, false],
    ['original attempt expires during final completion write', { advanceAfterCompletion: 60_000 }, false],
    ['forced final fence refusal', { fenceFailure: true }, false],
    ['forced final fence exception', { fenceException: true }, true],
    ['late attempt deadline extension cannot replace original snapshot', { mutateAttempt: true }, false],
    ['late session mutation cannot replace original minted snapshot', { mutateSession: true }, false],
  ]) await t.test(name, async () => {
    const model = transactionalPoolDouble(options), store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: model.PoolDouble });
    try {
      if (throws) await assert.rejects(store.issueBoundSession(model.args), { code: 'PIXEL_STORAGE_UNAVAILABLE' });
      else assert.equal(await store.issueBoundSession(model.args), null);
      const state = model.state(), prior = model.original;
      assert.equal(state.bindings[0].floor_epoch, 9, 'learned generation must survive optional mint refusal/rollback');
      assert.deepEqual(state.accounts, prior.accounts);
      assert.deepEqual({ ...state.bindings[0], floor_epoch: prior.bindings[0].floor_epoch }, prior.bindings[0], 'immutable binding target is unchanged');
      assert.deepEqual(state.bindings[1], prior.bindings[1]);
      assert.notEqual(state.sessions.find(row => row.token_hash === hash('old')).revoked_at, null);
      assert.deepEqual(state.sessions.find(row => row.token_hash === hash('current')), prior.sessions.find(row => row.token_hash === hash('current')), 'unchanged accepted-generation row is not evicted');
      assert.deepEqual(state.sessions.find(row => row.token_hash === hash('unrelated')), prior.sessions.find(row => row.token_hash === hash('unrelated')));
      assert.equal(state.sessions.some(row => row.token_hash === model.args.tokenHash), false, 'refused mint must have no committed session');
      assert.equal(state.attempts[0]?.completed_at ?? null, null, 'failed mint completion is rolled back');
      assert.equal(await store.getSession({ tokenHash: hash('old') }), null);
      assert.equal((await store.getSession({ tokenHash: hash('current') })).accountId, prior.accounts[0].id);
      assert.equal((await store.getSession({ tokenHash: hash('unrelated') })).accountId, prior.accounts[1].id);
      const commits = model.events.filter(event => event.type === 'commit');
      assert.equal(commits[0].state.bindings[0].floor_epoch, 9);
      assert.notEqual(commits[0].state.sessions.find(row => row.token_hash === hash('old')).revoked_at, null);
      if (throws || options.advanceAfterInsert || options.advanceAfterCompletion || options.expireBeforeInsert || options.fenceFailure || options.mutateAttempt || options.mutateSession) {
        const rollbacks = model.events.filter(event => event.type === 'rollback');
        assert.ok(rollbacks.some(event => event.id > commits[0].id), 'optional phase rollback must occur after durable retirement commit');
      }
    } finally { await store.close(); }
  });
});

test('synthetic clock boundary: final fence requires original attempt, signed identity and minted session strictly live', async t => {
  for (const [name, options, accepted] of [
    ['one millisecond before original attempt expiry', { advanceAfterCompletion: 59_999 }, true],
    ['exact original attempt expiry while identity/session remain live', { advanceAfterCompletion: 60_000 }, false],
    ['after original attempt expiry while identity/session remain live', { advanceAfterCompletion: 60_001 }, false],
    ['one millisecond before signed identity expiry', { identityRemaining: 30_000, advanceAfterCompletion: 29_999 }, true],
    ['exact signed identity expiry', { identityRemaining: 30_000, advanceAfterCompletion: 30_000 }, false],
    ['one millisecond before shorter minted-session expiry', { shortSessionRemaining: 30_000, advanceAfterCompletion: 29_999 }, true],
    ['exact shorter minted-session expiry', { shortSessionRemaining: 30_000, advanceAfterCompletion: 30_000 }, false],
  ]) await t.test(name, async () => {
    const model = transactionalPoolDouble(options), store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: model.PoolDouble });
    try {
      const saved = await store.issueBoundSession(model.args);
      assert.equal(Boolean(saved), accepted);
      const state = model.state(), mint = state.sessions.find(row => row.token_hash === model.args.tokenHash);
      assert.equal(Boolean(mint), accepted);
      assert.equal(state.bindings[0].floor_epoch, 9, 'late mint failure cannot undo previously committed security observation');
      assert.equal(state.attempts[0].completed_at !== null, accepted);
      assert.deepEqual(state.accounts, model.original.accounts);
      assert.equal(await store.getSession({ tokenHash: hash('old') }), null);
      const fence = model.statements.find(row => row.sql.startsWith('WITH fence AS MATERIALIZED'));
      assert.equal(new Date(fence.params[0]).getTime(), model.original.attempts[0].expires_at, 'fence must use the original attempt deadline');
      assert.equal(new Date(fence.params[1]).getTime(), model.args.identityExpiresAt.getTime(), 'fence must use accepted signed token expiry');
      if (accepted) assert.ok(await store.getSession({ tokenHash: model.args.tokenHash }));
      else assert.equal(await store.getSession({ tokenHash: model.args.tokenHash }), null);
    } finally { await store.close(); }
  });
});

test('synthetic transaction model: unchanged and older accepted generations preserve current and unrelated authority at capacity', async t => {
  for (const credentialVersion of [8, 9]) await t.test(`incoming ${credentialVersion} against floor9`, async () => {
    const model = transactionalPoolDouble({ floor: 9, globalCap: true }), store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: model.PoolDouble });
    try {
      assert.equal(await store.issueBoundSession({ ...model.args, credentialVersion }), null);
      assert.deepEqual(model.state().accounts, model.original.accounts);
      assert.deepEqual(model.state().bindings, model.original.bindings);
      assert.deepEqual(model.state().sessions, model.original.sessions);
      assert.ok(await store.getSession({ tokenHash: hash('old') }));
      assert.ok(await store.getSession({ tokenHash: hash('current') }));
      assert.ok(await store.getSession({ tokenHash: hash('unrelated') }));
    } finally { await store.close(); }
  });
});

test('retired browser admission cannot insert a new attempt after cancel/logout acknowledgment', async () => {
  const { PoolDouble, statements } = guardedPoolDouble({ retired: true });
  const store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: PoolDouble });
  await assert.rejects(store.createAttempt({ stateHash: hash('late-start'), browserHash: hash('retired-browser'), nonce: 'n'.repeat(43), codeVerifier: 'v'.repeat(43), expiresAt: new Date(Date.now()+60000), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse' }), { code: 'PIXEL_STORAGE_UNAVAILABLE' });
  const query = statements.find(row => row.sql.startsWith('SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=$1 AND cancelled_at'));
  assert.deepEqual(query.params, [hash('retired-browser')]);
  assert.equal(statements.some(row => row.sql.startsWith('INSERT')), false);
  assert.equal(statements.at(-1).sql, 'COMMIT');
  await store.close();
});

test('cancelled, completed, expired or wrong-browser attempt cannot reach account projection or mint', async () => {
  const { PoolDouble, statements } = guardedPoolDouble({ admitted: false });
  const store = createPostgresStore(readTargetConfig(envFor()), { PoolClass: PoolDouble });
  assert.equal(await store.issueBoundSession({ issuer: 'https://pixel-pulse-websites.vercel.app/api/sso', subject: 'existing', credentialVersion: 1, identityExpiresAt: new Date(Date.now()+60000), tokenHash: hash('new'), stateHash: hash('state'), browserHash: hash('browser') }), null);
  const admission = statements.find(row => row.sql.startsWith('SELECT a.state_hash,a.expires_at::text AS attempt_expires_at'));
  assert.match(admission.sql, /a\.consumed_at IS NOT NULL AND a\.cancelled_at IS NULL AND a\.completed_at IS NULL AND a\.expires_at>clock_timestamp\(\) FOR UPDATE/);
  assert.deepEqual(admission.params, [hash('state'), hash('browser')]);
  assert.equal(statements.some(row => row.sql.startsWith('SELECT b.account_id') || row.sql.startsWith('INSERT')), false);
  await store.close();
});

test('disposable local PostgreSQL validates persistence, replay, isolation, epochs and nonadoption', { skip: !process.env.REMATCH_PIXEL_TEST_CONTEXT }, async t => {
  const { Pool } = await import('pg');
  const context = JSON.parse(await readFile(process.env.REMATCH_PIXEL_TEST_CONTEXT, 'utf8'));
  assert.equal(context.host, '127.0.0.1');
  assert.ok(Number.isInteger(Number(context.port)) && Number(context.port) > 0 && Number(context.port) <= 65535);
  assert.match(context.user, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
  assert.ok(!context.adminDatabase || context.adminDatabase === 'postgres');
  const database = `rematch_pixel_test_${randomBytes(8).toString('hex')}`;
  const connection = { host: context.host, port: Number(context.port), user: context.user, database: 'postgres', password: () => '', ssl: false, options: '-c search_path=pg_catalog -c timezone=UTC', replication: 'false', client_encoding: 'UTF8', sslnegotiation: 'postgres', max: 2 };
  const admin = new Pool(connection);
  let direct;
  let store;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    direct = new Pool({ ...connection, database });
    await direct.query(await readFile(new URL('./test/fixtures/pixel-local-schema.sql', import.meta.url), 'utf8'));
    const configEnv = envFor({ REMATCH_PIXEL_DATABASE_URL: `postgresql://${context.user}@127.0.0.1:${context.port}/${database}`, REMATCH_PIXEL_APPROVED_PORT: String(context.port), REMATCH_PIXEL_APPROVED_ROLE: context.user, REMATCH_PIXEL_APPROVED_DATABASE: database });
    store = createPostgresStore(readTargetConfig(configEnv));
    const issuer = 'https://pixel-pulse-websites.vercel.app/api/sso';
    const subject = 'synthetic-owned-subject';
    const accountId = randomUUID();
    await direct.query('INSERT INTO rematch_pixel.accounts(id,display_name) VALUES($1,$2)', [accountId, 'Local fixture only']);
    await direct.query('INSERT INTO rematch_pixel.bindings(issuer,subject,account_id,floor_epoch) VALUES($1,$2,$3,0)', [issuer, subject, accountId]);
    const original = (await direct.query('SELECT to_jsonb(a) AS value FROM rematch_pixel.accounts a')).rows;
    let attemptNumber = 0;
    const prepareSessionAttempt = async (browserHash = hash('session-browser')) => {
      const stateHash = hash(`session-attempt-${attemptNumber++}`);
      await store.createAttempt({ stateHash, browserHash, nonce: 'n'.repeat(43), codeVerifier: 'v'.repeat(43), expiresAt: new Date(Date.now()+180000), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse' });
      assert.ok(await store.consumeAttempt({ stateHash, browserHash }));
      return { stateHash, browserHash };
    };
    const mint = async args => store.issueBoundSession({ ...args, ...await prepareSessionAttempt() });


    await t.test('readiness validates actual pinned schema without needing a session cookie', async () => {
      assert.equal(await store.checkReady(), true);
    });

    await t.test('one-use attempt survives new adapter and is bound to the initiating browser', async () => {
      const args = { stateHash: hash('one-use-state'), browserHash: hash('one-browser'), nonce: randomBytes(24).toString('base64url'), codeVerifier: randomBytes(32).toString('base64url'), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse', expiresAt: new Date(Date.now() + 120000) };
      await store.createAttempt(args);
      assert.equal(await store.consumeAttempt({ stateHash: args.stateHash, browserHash: hash('other-browser') }), null);
      const other = createPostgresStore(readTargetConfig(configEnv));
      const consumed = await other.consumeAttempt(args);
      assert.equal(consumed.nonce, args.nonce);
      assert.equal(consumed.codeVerifier, args.codeVerifier);
      assert.equal(await store.consumeAttempt(args), null);
      await other.close();
    });
    await t.test('simultaneous callbacks consume exactly once; cancellation and expiry cannot mint', async () => {
      const args = { stateHash: hash('parallel-state'), browserHash: hash('parallel-browser'), nonce: randomBytes(24).toString('base64url'), codeVerifier: randomBytes(32).toString('base64url'), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse', expiresAt: new Date(Date.now() + 120000) };
      await store.createAttempt(args);
      const results = await Promise.all([store.consumeAttempt(args), store.consumeAttempt(args)]);
      assert.equal(results.filter(Boolean).length, 1);
      await store.createAttempt({ ...args, stateHash: hash('canceled') });
      await store.cancelAttempt({ stateHash: hash('canceled'), browserHash: args.browserHash });
      assert.equal(await store.consumeAttempt({ stateHash: hash('canceled'), browserHash: args.browserHash }), null);
      await store.createAttempt({ ...args, stateHash: hash('expired-attempt'), browserHash: hash('expired-browser') });
      await direct.query("UPDATE rematch_pixel.attempts SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE state_hash=$1", [hash('expired-attempt')]);
      assert.equal(await store.consumeAttempt({ stateHash: hash('expired-attempt'), browserHash: hash('expired-browser') }), null);
    });
    await t.test('unknown identity creates no account/binding/session; token lifetime is bounded', async () => {
      assert.equal(await mint({ issuer, subject: 'unknown', credentialVersion: 0, identityExpiresAt: new Date(Date.now() + 60000), tokenHash: hash('unknown-token') }), null);
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.accounts')).rows[0].n), 1);
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.bindings')).rows[0].n), 1);
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.sessions')).rows[0].n), 0);
      const tokenHash = hash('token-one');
      const expiry = new Date(Date.now() + 55000);
      const first = await mint({ issuer, subject, credentialVersion: 0, identityExpiresAt: expiry, tokenHash });
      assert.equal(first.accountId, accountId);
      assert.equal(new Date(first.expiresAt).getTime() <= expiry.getTime(), true);
      assert.equal((await store.getSession({ tokenHash })).accountId, accountId);
      assert.equal(await store.getSession({ tokenHash: hash('raw-not-a-session') }), null);
      const long = await mint({ issuer, subject, credentialVersion: 0, identityExpiresAt: new Date(Date.now() + 3600000), tokenHash: hash('long-token') });
      assert.equal(new Date(long.expiresAt).getTime() <= Date.now() + 300000, true);
    });
    await t.test('trusted new observation retires prior sessions even when its optional identity mint is expired', async () => {
      const newerHash = hash('newer-token');
      const second = await mint({ issuer, subject, credentialVersion: 1, identityExpiresAt: new Date(Date.now() + 60000), tokenHash: newerHash });
      assert.equal(second.accountId, accountId);
      assert.equal(await store.getSession({ tokenHash: hash('token-one') }), null);
      assert.equal(await mint({ issuer, subject, credentialVersion: 0, identityExpiresAt: new Date(Date.now() + 60000), tokenHash: hash('stale') }), null);
      assert.equal(await mint({ issuer, subject, credentialVersion: 2, identityExpiresAt: new Date(Date.now() - 1000), tokenHash: hash('expired') }), null);
      assert.equal(Number((await direct.query('SELECT floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2', [issuer, subject])).rows[0].floor_epoch), 2);
      assert.equal(await store.getSession({ tokenHash: newerHash }), null);
      const currentHash = hash('current-generation-token');
      assert.ok(await mint({ issuer, subject, credentialVersion: 2, identityExpiresAt: new Date(Date.now() + 60000), tokenHash: currentHash }));
      await store.revokeSession({ tokenHash: currentHash });
      assert.equal(await store.getSession({ tokenHash: currentHash }), null);
      assert.deepEqual((await direct.query('SELECT to_jsonb(a) AS value FROM rematch_pixel.accounts a')).rows, original);
    });
    await t.test('consumed cancellation and browser logout reject late mint, completed cancellation revokes session', async () => {
      const cancelled = await prepareSessionAttempt(hash('cancel-browser'));
      await store.cancelAttempt(cancelled);
      await assert.rejects(store.createAttempt({ stateHash: hash('retired-start'), browserHash: cancelled.browserHash, nonce: 'n'.repeat(43), codeVerifier: 'v'.repeat(43), expiresAt: new Date(Date.now()+60000), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse' }), { code: 'PIXEL_STORAGE_UNAVAILABLE' });
      assert.equal(await store.issueBoundSession({ issuer, subject, credentialVersion: 2, identityExpiresAt: new Date(Date.now()+60000), tokenHash: hash('cancel-late'), ...cancelled }), null);
      const pending = await prepareSessionAttempt(hash('logout-browser'));
      await store.revokeBrowser({ browserHash: pending.browserHash });
      assert.equal(await store.issueBoundSession({ issuer, subject, credentialVersion: 2, identityExpiresAt: new Date(Date.now()+60000), tokenHash: hash('logout-late'), ...pending }), null);
      const completed = await prepareSessionAttempt(hash('completed-browser'));
      assert.ok(await store.issueBoundSession({ issuer, subject, credentialVersion: 2, identityExpiresAt: new Date(Date.now()+60000), tokenHash: hash('completed-token'), ...completed }));
      await store.cancelAttempt(completed);
      assert.equal(await store.getSession({ tokenHash: hash('completed-token') }), null);
      const tokenOnly = await prepareSessionAttempt(hash('token-only-browser'));
      assert.ok(await store.issueBoundSession({ issuer, subject, credentialVersion: 2, identityExpiresAt: new Date(Date.now()+60000), tokenHash: hash('token-only'), ...tokenOnly }));
      await store.revokeBrowser({ tokenHash: hash('token-only') });
      assert.equal(await store.getSession({ tokenHash: hash('token-only') }), null);
      assert.ok((await direct.query('SELECT cancelled_at FROM rematch_pixel.attempts WHERE state_hash=$1', [tokenOnly.stateHash])).rows[0].cancelled_at);
    });
    await t.test('retained per-binding cap refuses mint but commits higher epoch and denies old authority', async () => {
      let count = Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.sessions WHERE issuer=$1 AND subject=$2', [issuer, subject])).rows[0].n);
      let lastHash;
      while (count++ < 10) {
        lastHash = hash(`cap-session-${count}`);
        assert.ok(await mint({ issuer, subject, credentialVersion: 2, identityExpiresAt: new Date(Date.now()+120000), tokenHash: lastHash }));
      }
      assert.equal(await mint({ issuer, subject, credentialVersion: 9, identityExpiresAt: new Date(Date.now()+120000), tokenHash: hash('over-session-cap') }), null);
      assert.equal(Number((await direct.query('SELECT floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2', [issuer, subject])).rows[0].floor_epoch), 9);
      if (lastHash) assert.equal(await store.getSession({ tokenHash: lastHash }), null);
    });
    await t.test('retained attempt cap and bounded expiry cleanup preserve valid linked rows', async () => {
      const existing = Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.attempts')).rows[0].n);
      await direct.query(`INSERT INTO rematch_pixel.attempts(state_hash,browser_hash,nonce,code_verifier,redirect_uri,expires_at)
        SELECT md5('cap-state-'||n)||md5('cap-more-'||n),$2,$3,$4,$5,clock_timestamp()+interval '1 hour' FROM generate_series(1,$1::int) n`,
      [1000-existing, hash('bulk-cap-browser'), 'q'.repeat(43), 'l'.repeat(43), 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse']);
      const args = { stateHash: hash('over-attempt-cap'), browserHash: hash('new-cap-browser'), nonce: 'n'.repeat(43), codeVerifier: 'v'.repeat(43), expiresAt: new Date(Date.now()+60000), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse' };
      await assert.rejects(store.createAttempt(args), { code: 'PIXEL_STORAGE_UNAVAILABLE' });
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.attempts')).rows[0].n), 1000);
      await direct.query(`UPDATE rematch_pixel.attempts SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'
        WHERE state_hash IN (SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=$1 ORDER BY state_hash LIMIT 101)`, [hash('bulk-cap-browser')]);
      await store.createAttempt(args);
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.attempts WHERE expires_at<=clock_timestamp()')).rows[0].n), 1);
      await store.createAttempt({ ...args, stateHash: hash('second-cleanup') });
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.attempts WHERE expires_at<=clock_timestamp()')).rows[0].n), 0);
      assert.deepEqual((await direct.query('SELECT to_jsonb(a) AS value FROM rematch_pixel.accounts a')).rows, original);
    });
    await t.test('actual role/history/schema mismatch fails closed before writes', async () => {
      const mismatch = createPostgresStore(readTargetConfig({ ...configEnv, REMATCH_PIXEL_APPROVED_HISTORY: 'f'.repeat(64) }));
      await assert.rejects(mismatch.createAttempt({ stateHash: hash('no-write'), browserHash: hash('browser'), nonce: randomBytes(24).toString('base64url'), codeVerifier: randomBytes(32).toString('base64url'), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse', expiresAt: new Date(Date.now()+60000) }), { code: 'PIXEL_SCHEMA_MISMATCH' });
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.attempts WHERE state_hash=$1', [hash('no-write')])).rows[0].n), 0);
      await mismatch.close();
      await direct.query('ALTER TABLE rematch_pixel.sessions ADD COLUMN unapproved text');
      await assert.rejects(store.getSession({ tokenHash: hash('token-one') }), { code: 'PIXEL_SCHEMA_MISMATCH' });
      await direct.query('ALTER TABLE rematch_pixel.sessions DROP COLUMN unapproved');
      assert.equal((await direct.query('SELECT to_jsonb(a) AS value FROM rematch_pixel.accounts a')).rows.length, original.length);
    });
  } finally {
    await store?.close();
    await direct?.end();
    try { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); } finally { await admin.end(); }
  }
});

// PREPARED ONLY. This suite opens no connection unless the operator explicitly
// supplies the same owned-loopback context required by the original native suite.
// It is skipped in the default offline run and has NOT been executed as proof.
test('optional native PostgreSQL: durable retirement, real write/lock waits and final original-deadline fencing', { skip: !process.env.REMATCH_PIXEL_TEST_CONTEXT }, async t => {
  const { Pool } = await import('pg');
  const context = JSON.parse(await readFile(process.env.REMATCH_PIXEL_TEST_CONTEXT, 'utf8'));
  assert.equal(context.host, '127.0.0.1');
  assert.ok(Number.isInteger(Number(context.port)) && Number(context.port) > 0 && Number(context.port) <= 65535);
  assert.match(context.user, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
  assert.ok(!context.adminDatabase || context.adminDatabase === 'postgres');
  const database = `rematch_pixel_test_${randomBytes(8).toString('hex')}`;
  const connection = { host: context.host, port: Number(context.port), user: context.user, database: 'postgres', password: () => '', ssl: false,
    options: '-c search_path=pg_catalog -c timezone=UTC', replication: 'false', client_encoding: 'UTF8', sslnegotiation: 'postgres', max: 3 };
  const admin = new Pool(connection);
  let direct, store;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    direct = new Pool({ ...connection, database });
    await direct.query(await readFile(new URL('./test/fixtures/pixel-local-schema.sql', import.meta.url), 'utf8'));
    store = createPostgresStore(readTargetConfig(envFor({ REMATCH_PIXEL_DATABASE_URL: `postgresql://${context.user}@127.0.0.1:${context.port}/${database}`,
      REMATCH_PIXEL_APPROVED_PORT: String(context.port), REMATCH_PIXEL_APPROVED_ROLE: context.user, REMATCH_PIXEL_APPROVED_DATABASE: database })));
    const issuer = 'https://pixel-pulse-websites.vercel.app/api/sso', subject = 'native-security-fixture', otherSubject = 'native-unrelated-fixture';
    const account = randomUUID(), otherAccount = randomUUID();
    let sequence = 0;
    async function fixture({ globalCap = false, bindingCap = false, floor = 1, attemptMilliseconds = 60_000 } = {}) {
      await direct.query('DROP FUNCTION IF EXISTS rematch_pixel.test_session_hook() CASCADE');
      await direct.query('DROP FUNCTION IF EXISTS rematch_pixel.test_completion_hook() CASCADE');
      for (const table of ['sessions', 'attempts', 'bindings', 'accounts']) await direct.query(`DELETE FROM rematch_pixel.${table}`);
      await direct.query('INSERT INTO rematch_pixel.accounts(id,display_name) VALUES($1,$2),($3,$4)', [account, 'Original fixture', otherAccount, 'Unrelated fixture']);
      await direct.query('INSERT INTO rematch_pixel.bindings(issuer,subject,account_id,floor_epoch) VALUES($1,$2,$3,$4),($1,$5,$6,4)', [issuer, subject, account, floor, otherSubject, otherAccount]);
      const stateHash = hash(`native-security-attempt-${sequence++}`), browserHash = hash('native-security-browser');
      await store.createAttempt({ stateHash, browserHash, nonce: 'n'.repeat(43), codeVerifier: 'v'.repeat(43),
        expiresAt: new Date(Date.now() + attemptMilliseconds), redirectUri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse' });
      assert.ok(await store.consumeAttempt({ stateHash, browserHash }));
      const insertSession = async (label, rowSubject, rowAccount, epoch) => {
        const attempt = hash(`native-seed-attempt-${label}`), token = hash(`native-seed-token-${label}`);
        await direct.query(`INSERT INTO rematch_pixel.attempts(state_hash,browser_hash,nonce,code_verifier,redirect_uri,expires_at,consumed_at,completed_at)
          VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '2 minutes',clock_timestamp(),clock_timestamp())`, [attempt, browserHash, 'n'.repeat(43), 'v'.repeat(43), 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse']);
        await direct.query(`INSERT INTO rematch_pixel.sessions(token_hash,issuer,subject,account_id,signed_epoch,expires_at,attempt_state_hash)
          VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '2 minutes',$6)`, [token, issuer, rowSubject, rowAccount, epoch, attempt]);
        return token;
      };
      const old = await insertSession('old', subject, account, floor), current = await insertSession('current', subject, account, 9), unrelated = await insertSession('unrelated', otherSubject, otherAccount, 4);
      if (bindingCap) for (let index = 2; index < 10; index++) await insertSession(`capacity-${index}`, subject, account, 9);
      if (globalCap) {
        await direct.query(`INSERT INTO rematch_pixel.attempts(state_hash,browser_hash,nonce,code_verifier,redirect_uri,expires_at,consumed_at,completed_at)
          SELECT md5('security-cap-state-'||n)||md5('security-cap-state2-'||n),$1,$2,$3,$4,clock_timestamp()+interval '2 minutes',clock_timestamp(),clock_timestamp() FROM generate_series(1,9997) n`,
        [browserHash, 'n'.repeat(43), 'v'.repeat(43), 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse']);
        await direct.query(`INSERT INTO rematch_pixel.sessions(token_hash,issuer,subject,account_id,signed_epoch,expires_at,attempt_state_hash)
          SELECT md5('security-cap-token-'||n)||md5('security-cap-token2-'||n),$1,$2,$3,4,clock_timestamp()+interval '2 minutes',md5('security-cap-state-'||n)||md5('security-cap-state2-'||n) FROM generate_series(1,9997) n`, [issuer, otherSubject, otherAccount]);
      }
      const preserved = (await direct.query('SELECT token_hash,to_jsonb(s) AS value FROM rematch_pixel.sessions s WHERE token_hash=ANY($1::text[]) ORDER BY token_hash', [[current, unrelated]])).rows;
      const accounts = (await direct.query('SELECT to_jsonb(a) AS value FROM rematch_pixel.accounts a ORDER BY id')).rows;
      return { args: { issuer, subject, credentialVersion: 9, identityExpiresAt: new Date(Date.now() + 60_000), tokenHash: hash(`native-new-${sequence}`), stateHash, browserHash }, old, current, unrelated, preserved, accounts };
    }
    async function assertRetiredAndPreserved(f) {
      const bindings = (await direct.query('SELECT subject,account_id,floor_epoch FROM rematch_pixel.bindings ORDER BY subject')).rows;
      assert.equal(Number(bindings.find(row => row.subject === subject).floor_epoch), 9);
      assert.equal(bindings.find(row => row.subject === subject).account_id, account);
      assert.equal(Number(bindings.find(row => row.subject === otherSubject).floor_epoch), 4);
      assert.equal(bindings.find(row => row.subject === otherSubject).account_id, otherAccount);
      assert.equal(await store.getSession({ tokenHash: f.old }), null);
      assert.ok(await store.getSession({ tokenHash: f.current }));
      assert.ok(await store.getSession({ tokenHash: f.unrelated }));
      assert.deepEqual((await direct.query('SELECT to_jsonb(a) AS value FROM rematch_pixel.accounts a ORDER BY id')).rows, f.accounts);
      assert.deepEqual((await direct.query('SELECT token_hash,to_jsonb(s) AS value FROM rematch_pixel.sessions s WHERE token_hash=ANY($1::text[]) ORDER BY token_hash', [[f.current, f.unrelated]])).rows, f.preserved);
      assert.equal(Number((await direct.query('SELECT count(*) AS n FROM rematch_pixel.sessions WHERE token_hash=$1', [f.args.tokenHash])).rows[0].n), 0);
      const attempt = (await direct.query('SELECT completed_at FROM rematch_pixel.attempts WHERE state_hash=$1', [f.args.stateHash])).rows[0];
      if (attempt) assert.equal(attempt.completed_at, null);
    }
    for (const [name, options] of [['global session capacity', { globalCap: true }], ['per-binding capacity', { bindingCap: true }], ['expired optional mint', {}]]) await t.test(name, async () => {
      const f = await fixture(options);
      if (name === 'expired optional mint') f.args.identityExpiresAt = new Date(Date.now() - 1);
      assert.equal(await store.issueBoundSession(f.args), null);
      await assertRetiredAndPreserved(f);
    });
    await t.test('unchanged epoch capacity preserves all current and unrelated rows', async () => {
      const f = await fixture({ bindingCap: true, floor: 9 });
      const originalSessions = (await direct.query('SELECT to_jsonb(s) AS value FROM rematch_pixel.sessions s ORDER BY token_hash')).rows;
      assert.equal(await store.issueBoundSession(f.args), null);
      assert.deepEqual((await direct.query('SELECT to_jsonb(s) AS value FROM rematch_pixel.sessions s ORDER BY token_hash')).rows, originalSessions);
      assert.ok(await store.getSession({ tokenHash: f.old }));
      assert.ok(await store.getSession({ tokenHash: f.unrelated }));
    });
    for (const deferred of [false, true]) await t.test(`${deferred ? 'deferred constraint' : 'session insert'} failure rolls back mint but not retirement`, async () => {
      const f = await fixture();
      await direct.query(`CREATE FUNCTION rematch_pixel.test_session_hook() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN IF NEW.token_hash='${f.args.tokenHash}' THEN RAISE EXCEPTION 'synthetic session failure'; END IF; RETURN NEW; END $body$`);
      await direct.query(deferred
        ? 'CREATE CONSTRAINT TRIGGER security_session_failure AFTER INSERT ON rematch_pixel.sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rematch_pixel.test_session_hook()'
        : 'CREATE TRIGGER security_session_failure BEFORE INSERT ON rematch_pixel.sessions FOR EACH ROW EXECUTE FUNCTION rematch_pixel.test_session_hook()');
      await assert.rejects(store.issueBoundSession(f.args), { code: 'PIXEL_STORAGE_UNAVAILABLE' });
      await assertRetiredAndPreserved(f);
    });
    const observeAdapterWait = async (expected, isSettled = () => false) => {
      for (let index = 0; index < 30 && !isSettled(); index++) {
        const row = (await direct.query(`SELECT pid,wait_event_type,wait_event FROM pg_stat_activity
          WHERE datname=current_database() AND application_name='rematch-pixel-bound-return'
          AND wait_event=$1 AND wait_event_type=$2 ORDER BY pid LIMIT 1`, [expected === 'Lock' ? 'transactionid' : 'PgSleep', expected === 'Lock' ? 'Lock' : 'Timeout'])).rows[0];
        if (row) { assert.ok(Number(row.pid) > 0); return row; }
        await direct.query('SELECT pg_sleep(0.02)');
      }
      return null;
    };
    for (const stage of ['session-write', 'completion-write', 'signed-identity-expiry', 'shorter-session-expiry']) await t.test(`real observed ${stage} trigger wait crosses its original deadline`, async () => {
      const f = await fixture();
      if (stage === 'session-write') {
        await direct.query(`CREATE FUNCTION rematch_pixel.test_session_hook() RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN IF NEW.token_hash='${f.args.tokenHash}' THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $body$`);
        await direct.query('CREATE TRIGGER security_session_wait BEFORE INSERT ON rematch_pixel.sessions FOR EACH ROW EXECUTE FUNCTION rematch_pixel.test_session_hook()');
      } else {
        if (stage === 'shorter-session-expiry') {
          await direct.query(`CREATE FUNCTION rematch_pixel.test_session_hook() RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN IF NEW.token_hash='${f.args.tokenHash}' THEN NEW.expires_at=clock_timestamp()+interval '800 milliseconds'; END IF; RETURN NEW; END $body$`);
          await direct.query('CREATE TRIGGER security_short_session BEFORE INSERT ON rematch_pixel.sessions FOR EACH ROW EXECUTE FUNCTION rematch_pixel.test_session_hook()');
        }
        await direct.query(`CREATE FUNCTION rematch_pixel.test_completion_hook() RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN IF NEW.state_hash='${f.args.stateHash}' AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $body$`);
        await direct.query('CREATE TRIGGER security_completion_wait BEFORE UPDATE ON rematch_pixel.attempts FOR EACH ROW EXECUTE FUNCTION rematch_pixel.test_completion_hook()');
      }
      if (stage === 'session-write' || stage === 'completion-write') await direct.query("UPDATE rematch_pixel.attempts SET expires_at=clock_timestamp()+interval '800 milliseconds' WHERE state_hash=$1", [f.args.stateHash]);
      if (stage === 'signed-identity-expiry') f.args.identityExpiresAt = new Date(Date.now() + 800);
      let settled = false;
      const pending = store.issueBoundSession(f.args).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
      const observed = await observeAdapterWait('PgSleep', () => settled);
      assert.ok(observed, 'a different owned backend must observe the actual adapter pid in the trigger wait');
      assert.equal(observed.wait_event, 'PgSleep');
      const outcome = await pending;
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.value, null);
      const deadlines = (await direct.query('SELECT expires_at<=clock_timestamp() AS attempt_expired,$2::timestamptz>clock_timestamp() AS identity_live FROM rematch_pixel.attempts WHERE state_hash=$1', [f.args.stateHash, f.args.identityExpiresAt])).rows[0];
      if (stage === 'session-write' || stage === 'completion-write') { assert.equal(deadlines.attempt_expired, true); assert.equal(deadlines.identity_live, true); }
      else assert.equal(deadlines.attempt_expired, false);
      if (stage === 'signed-identity-expiry') assert.equal(deadlines.identity_live, false);
      if (stage === 'shorter-session-expiry') assert.equal(deadlines.identity_live, true);
      await assertRetiredAndPreserved(f);
    });
    await t.test('held old-session row lock delays retirement; later mint refusal cannot undo the learned epoch', async () => {
      const f = await fixture({ attemptMilliseconds: 800 }), locker = await direct.connect();
      let pending;
      try {
        await locker.query('BEGIN');
        await locker.query('SELECT token_hash FROM rematch_pixel.sessions WHERE token_hash=$1 FOR UPDATE', [f.old]);
        pending = store.issueBoundSession(f.args).then(value => ({ value }), error => ({ error }));
        const waiting = await observeAdapterWait('Lock');
        assert.ok(waiting, 'actual owned adapter pid must be observed waiting on the held row transaction');
        assert.equal(waiting.wait_event_type, 'Lock');
        await direct.query('SELECT pg_sleep(1.0)');
        await locker.query('COMMIT');
      } finally { try { await locker.query('ROLLBACK'); } finally { locker.release(); } }
      const outcome = await pending;
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.value, null);
      await assertRetiredAndPreserved(f);
    });
  } finally {
    await store?.close();
    await direct?.end();
    try { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); } finally { await admin.end(); }
  }
});
