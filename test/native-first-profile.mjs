// RUNNABLE NATIVE PREPARATION, NOT AN EXECUTION RECEIPT.
// This module is deliberately not imported by the default offline suite. Even
// its exported runner validates an exact finite context and on-disk source pin
// before dynamically importing pg or constructing any connection.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BASE_HISTORY, FIRST_HISTORY, NATIVE_SCENARIOS, validateNativeContext,
  assertNativeSourcePin, matchesOwnedWait } from './native-first-profile-contract.mjs';
import { nativeSourcePin } from './native-first-profile-plan.mjs';

const ISSUER = 'https://pixel-pulse-websites.vercel.app/api/sso';
const CALLBACK = 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';
const root = new URL('../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const quoted = value => {
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
  return '"' + value + '"';
};
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const ambient = ['DATABASE_URL', 'REMATCH_PIXEL_DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
  'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGREPLICATION', 'PGSSLMODE', 'PGSSLROOTCERT'];
const allTables = ['rematch_pixel_first.receipts', 'rematch_pixel.sessions', 'rematch_pixel_first.attempts',
  'rematch_pixel.attempts', 'rematch_pixel.bindings', 'rematch_pixel.accounts'];

export async function runNativeFirstProfileSuite(t, { context, permit } = {}) {
  const approved = validateNativeContext(context, { permit });
  assertNativeSourcePin(approved, await nativeSourcePin());
  assert.equal(process.env.NODE_ENV, 'test', 'Native fixture run must explicitly use NODE_ENV=test');
  for (const key of ambient) assert.equal(process.env[key], undefined, 'Ambient database/credential settings are forbidden.');
  let scenarioAborted = false;
  const live = () => {
    if (t.signal?.aborted || scenarioAborted) throw new Error('Native fixture run was aborted; no new SQL is permitted.');
    return validateNativeContext(approved, { permit });
  };
  // Nothing above imports a native driver or contacts a target. The two roles
  // and empty disposable database must already exist under separate authority.
  const { Pool } = await import('pg');
  const [{ createPostgresStore }, { readTargetConfig }, { createAcceptedIdentityMarker }, { createSyntheticProfileTransport }] = await Promise.all([
    import('../server/pixel-store.mjs'), import('../server/pixel-target.mjs'),
    import('../server/pixel-accepted-identity.mjs'), import('./support/pixel-profile-transport.mjs'),
  ]);
  const connection = role => ({ host: approved.host, port: approved.port, database: approved.database, user: role,
    password: () => '', ssl: false, options: '-c search_path=pg_catalog -c timezone=UTC -c statement_timeout=5000ms -c lock_timeout=3000ms', replication: 'false',
    client_encoding: 'UTF8', sslnegotiation: 'postgres', connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 5000, max: 3, application_name: 'rematch-native-first-profile-owner' });
  live();
  const owner = new Pool(connection(approved.ownerRole));
  let probe, store, ownerLock, fixtureInstalled = false, executed = 0, passed = 0;
  const hooks = [], activeQueries = new Map();
  const rawQuery = Symbol('owned runtime native query');
  let sequence = 0;

  async function exactPeer(client, role) {
    const row = (await client.query(`SELECT current_database() AS database,current_user AS role,session_user AS session_role,
      inet_server_addr()::text AS host,inet_server_port() AS port,pg_backend_pid() AS pid`)).rows[0];
    assert.equal(row?.database, approved.database); assert.equal(row?.role, role); assert.equal(row?.session_role, role);
    assert.equal(row?.host, '127.0.0.1'); assert.equal(Number(row?.port), approved.port);
    assert.ok(Number.isSafeInteger(Number(row?.pid)) && Number(row.pid) > 0);
    return Number(row.pid);
  }
  function guardClient(client) {
    if (!client[rawQuery]) client[rawQuery] = client.query.bind(client);
    const query = client[rawQuery];
    client.query = (sql, params) => {
      if (sql !== 'ROLLBACK' && !String(sql).startsWith('SELECT pg_advisory_unlock(')) live();
      return query(sql, params);
    };
    return client;
  }
  const ownerQuery = async (sql, params) => {
    live(); const client = guardClient(await owner.connect());
    try { return await client.query(sql, params); } finally { client.release(); }
  };
  const runtimeObserve = async (sql, params) => {
    // A separate same-role observer can inspect its own receiver's wait state.
    // No pg_read_all_stats role, superuser or owner/runtime membership is added.
    live(); const client = guardClient(await probe.connect());
    try { return await client.query(sql, params); } finally { client.release(); }
  };
  async function roleAndEmptyTargetPreflight() {
    live();
    const own = guardClient(await owner.connect());
    try {
      await exactPeer(own, approved.ownerRole);
      const database = (await own.query(`SELECT r.rolname AS owner FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
        WHERE d.datname=current_database()`)).rows[0];
      assert.equal(database?.owner, approved.ownerRole, 'Fixture owner must own the exact disposable DB.');
      const lock = (await own.query('SELECT pg_try_advisory_lock(1919249761,1885960614) AS held')).rows[0];
      assert.equal(lock?.held, true, 'Another native fixture run already owns this DB.'); ownerLock = own;
      const relations = (await own.query(`SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp_%'`)).rows;
      assert.deepEqual(relations, [], 'Refuse a DB with existing user data or objects.');
      const schemas = (await own.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public')
        AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%'`)).rows;
      assert.deepEqual(schemas, [], 'Refuse pre-existing private schemas.');
      const routines = (await own.query(`SELECT n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'`)).rows;
      assert.deepEqual(routines, [], 'Refuse pre-existing user routines.');
    } catch (error) { if (ownerLock !== own) own.release(); throw error; }
    live(); probe = new Pool(connection(approved.runtimeRole));
    const runtime = guardClient(await probe.connect());
    try {
      await exactPeer(runtime, approved.runtimeRole);
      const flags = (await runtime.query(`SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolcanlogin,
        pg_has_role(current_user,$1,'USAGE') AS inherits_owner FROM pg_roles WHERE rolname=current_user`, [approved.ownerRole])).rows[0];
      assert.ok(flags); assert.equal(flags.rolcanlogin, true);
      for (const name of ['rolsuper','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls','inherits_owner']) assert.equal(flags[name], false, 'Runtime role may not carry owner/admin bypass authority.');
      const inherited = (await runtime.query(`SELECT rolname FROM pg_roles WHERE rolname IN
        ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program','pg_signal_backend')
        AND pg_has_role(current_user,oid,'USAGE')`)).rows;
      assert.deepEqual(inherited, [], 'Runtime role cannot inherit broad data/server powers.');
      const memberships = (await runtime.query(`SELECT rolname FROM pg_roles
        WHERE rolname<>current_user AND pg_has_role(current_user,oid,'MEMBER')`)).rows;
      assert.deepEqual(memberships, [], 'Runtime role cannot use NOINHERIT/SET ROLE membership to obtain another role.');
    } finally { runtime.release(); }
  }
  async function installFixturesAndRuntimeGrants() {
    // This setup only runs after exact target/role/emptiness checks. No database
    // or role is created, altered or dropped. The fixtures themselves also
    // enforce loopback and the random disposable database-name prefix.
    live();
    await ownerQuery(await readFile(new URL('test/fixtures/pixel-local-schema.sql', root), 'utf8'));
    fixtureInstalled = true;
    await ownerQuery(await readFile(new URL('test/fixtures/pixel-first-profile-local.sql', root), 'utf8'));
    const role = quoted(approved.runtimeRole);
    await ownerQuery(`GRANT USAGE ON SCHEMA rematch_pixel,rematch_pixel_first TO ${role}`);
    await ownerQuery(`GRANT SELECT ON rematch_pixel.schema_meta,rematch_pixel_first.schema_meta TO ${role}`);
    await ownerQuery(`GRANT SELECT,INSERT ON rematch_pixel.accounts,rematch_pixel.bindings,rematch_pixel.attempts,
      rematch_pixel.sessions,rematch_pixel_first.attempts,rematch_pixel_first.receipts TO ${role}`);
    // SELECT FOR UPDATE requires an UPDATE privilege on at least one column.
    // Only created_at is granted on INSERT-only profile/proof rows. The real
    // runtime does not issue an UPDATE to those rows and rereads their tuples.
    await ownerQuery(`GRANT UPDATE(created_at) ON rematch_pixel.accounts,rematch_pixel_first.attempts,rematch_pixel_first.receipts TO ${role}`);
    await ownerQuery(`GRANT UPDATE(floor_epoch) ON rematch_pixel.bindings TO ${role}`);
    await ownerQuery(`GRANT UPDATE(consumed_at,cancelled_at,completed_at) ON rematch_pixel.attempts TO ${role}`);
    await ownerQuery(`GRANT UPDATE(revoked_at) ON rematch_pixel.sessions TO ${role}`);
    await ownerQuery(`GRANT DELETE ON rematch_pixel.attempts,rematch_pixel.sessions TO ${role}`);
  }
  class CapturedRuntimePool extends Pool {
    constructor(options) {
      super({ ...options, options: options.options + ' -c statement_timeout=5000ms -c lock_timeout=3000ms' });
    }
    async connect() {
      live();
      const client = await super.connect();
      try {
        live();
        if (!client[rawQuery]) client[rawQuery] = client.query.bind(client);
        const query = client[rawQuery];
        const row = (await query(`SELECT pg_backend_pid() AS pid,current_database() AS database,current_user AS role,session_user AS session_role,
          inet_server_addr()::text AS host,inet_server_port() AS port`)).rows[0];
        assert.equal(row?.database, approved.database); assert.equal(row?.role, approved.runtimeRole); assert.equal(row?.session_role, approved.runtimeRole);
        assert.equal(row?.host, approved.host); assert.equal(Number(row?.port), approved.port);
        const pid = Number(row.pid); assert.ok(Number.isSafeInteger(pid) && pid > 0);
        client.query = async (sql, values) => {
          if (sql !== 'ROLLBACK') live();
          activeQueries.set(pid, String(sql));
          try { return await query(sql, values); }
          finally { activeQueries.delete(pid); }
        };
        const release = client.release.bind(client);
        client.release = (...args) => { activeQueries.delete(pid); return release(...args); };
        return client;
      } catch (error) { client.release(); throw error; }
    }
  }
  async function removeHooks() {
    while (hooks.length) {
      const hook = hooks.at(-1);
      if (hook.triggerCreated) {
        await ownerQuery(`DROP TRIGGER ${quoted(hook.trigger)} ON ${hook.table}`);
        hook.triggerCreated = false;
      }
      await ownerQuery(`DROP FUNCTION rematch_pixel.${quoted(hook.fn)}()`);
      hooks.pop();
    }
  }
  async function reset() {
    await removeHooks();
    await ownerQuery('TRUNCATE ' + allTables.join(','));
  }
  async function snapshot() {
    const result = {};
    for (const [name, order] of [['rematch_pixel.accounts','id'],['rematch_pixel.bindings','issuer,subject'],
      ['rematch_pixel.attempts','state_hash'],['rematch_pixel.sessions','token_hash'],
      ['rematch_pixel_first.attempts','state_hash'],['rematch_pixel_first.receipts','proof_hash']]) {
      result[name] = (await ownerQuery(`SELECT to_jsonb(x)::text AS value FROM ${name} x ORDER BY ${order}`)).rows;
    }
    return result;
  }
  const markAccepted = createAcceptedIdentityMarker();
  async function makeAttempt({ subject = 'synthetic_native_' + randomBytes(8).toString('hex'), epoch = 2 } = {}) {
    const now = (await ownerQuery('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
    const stateHash = hash('native-state-' + randomUUID()), browserHash = hash('native-browser-' + randomUUID());
    const input = { issuer: ISSUER, subject, credentialVersion: epoch, displayName: 'Native synthetic player',
      acceptedIdentity: markAccepted({ issuer: ISSUER, subject, credentialVersion: epoch }),
      stateHash, browserHash, tokenHash: hash('native-token-' + randomUUID()), targetAccountId: randomUUID(),
      nonce: 'create_' + randomBytes(32).toString('base64url'), codeVerifier: randomBytes(32).toString('base64url'), redirectUri: CALLBACK,
      expiresAt: new Date(now + 120_000).toISOString(), admissionExpiresAt: new Date(now + 60_000).toISOString(),
      identityExpiresAt: new Date(now + 120_000).toISOString(), expectedFlowHash: hash('native-flow-' + randomUUID()) };
    input.proof = { issuer: ISSUER, subject, credentialVersion: epoch, jti: randomBytes(32).toString('base64url'),
      flowHash: input.expectedFlowHash, issuedAt: Math.floor(now / 1000), authTime: Math.floor(now / 1000), expiresAt: new Date(now + 20_000).toISOString() };
    await store.createProfileAttempt(input);
    assert.ok(await store.consumeAttempt(input));
    return input;
  }
  async function hook(table, event, body, { deferred = false } = {}) {
    const fn = 'native_first_profile_hook_' + ++sequence, trigger = 'native_first_profile_trigger_' + sequence;
    await ownerQuery(`CREATE FUNCTION rematch_pixel.${quoted(fn)}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $native$
      BEGIN ${body} RETURN NEW; END $native$`);
    const owned = { fn, trigger, table, triggerCreated: false };
    hooks.push(owned);
    await ownerQuery(`REVOKE ALL ON FUNCTION rematch_pixel.${quoted(fn)}() FROM PUBLIC`);
    await ownerQuery(deferred
      ? `CREATE CONSTRAINT TRIGGER ${quoted(trigger)} AFTER ${event} ON ${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rematch_pixel.${quoted(fn)}()`
      : `CREATE TRIGGER ${quoted(trigger)} ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION rematch_pixel.${quoted(fn)}()`);
    owned.triggerCreated = true;
  }
  async function observeOwnedWait(predicate, expected) {
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      live();
      const candidate = [...activeQueries].find(([, sql]) => predicate(sql));
      if (candidate) {
        const receiverPid = candidate[0];
        const rows = (await runtimeObserve(`SELECT datname,usename,pid,application_name,wait_event_type,wait_event,pg_blocking_pids(pid) AS blocking_pids
          FROM pg_stat_activity WHERE datname=$1 AND pid=$2 AND usename=$3`, [approved.database, receiverPid, approved.runtimeRole])).rows;
        if (rows.length === 1 && matchesOwnedWait(rows[0], { database: approved.database, runtimeRole: approved.runtimeRole, receiverPid, ...expected })) return { receiverPid };
      }
      await pause(10);
    }
    assert.fail('Exact owned native receiver wait was not observed.');
  }
  async function passDeadline(deadline) {
    const until = Date.now() + 1600;
    while (Date.now() < until) {
      if ((await ownerQuery('SELECT clock_timestamp()>$1::timestamptz AS expired', [deadline])).rows[0].expired) return;
      await pause(20);
    }
    assert.fail('Original owned fixture deadline was not crossed while the lock remained held.');
  }
  async function noCreate(before) { assert.deepEqual(await snapshot(), before, 'No account/binding/receipt/session/completion survives refusal.'); }
  const caseRun = async (name, work) => {
    assert.equal(NATIVE_SCENARIOS[executed], name, 'Native scenario plan and implementation must agree.');
    executed++;
    let failure, inFlight, workSettled = false;
    await t.test(name, { timeout: 15_000 }, async child => {
      child.signal.addEventListener('abort', () => {
        // Some runners close a signal at ordinary completion too. Only an
        // abort while owned work is still pending latches the SQL refusal.
        if (!workSettled) { scenarioAborted = true; failure ||= new Error('Native fixture scenario was aborted.'); }
      }, { once: true });
      inFlight = (async () => { live(); await reset(); await work(); passed++; })().finally(() => { workSettled = true; });
      try { await inFlight; } catch (error) { failure = error; throw error; }
    });
    // A test timeout is not a database cancellation mechanism. Drain this
    // owned work before any next reset/cleanup; never kill a foreign backend.
    if (inFlight) await inFlight.catch(error => { failure ||= error; });
    if (passed !== executed) failure ||= new Error('Native fixture scenario did not record a completed pass.');
    if (failure) throw new Error('Native fixture scenario failed; stop before further fixture work.', { cause: failure });
  };
  try {
    await roleAndEmptyTargetPreflight();
    await installFixturesAndRuntimeGrants();
    const config = readTargetConfig({ NODE_ENV: 'test', REMATCH_PIXEL_LOCAL_TEST_MODE: 'true', REMATCH_PIXEL_TARGET_APPROVED: 'true',
      REMATCH_PIXEL_DATABASE_URL: `postgresql://${approved.runtimeRole}@127.0.0.1:${approved.port}/${approved.database}`,
      REMATCH_PIXEL_APPROVED_HOST: approved.host, REMATCH_PIXEL_APPROVED_PORT: String(approved.port), REMATCH_PIXEL_APPROVED_DATABASE: approved.database,
      REMATCH_PIXEL_APPROVED_ROLE: approved.runtimeRole, REMATCH_PIXEL_APPROVED_HISTORY: BASE_HISTORY });
    store = createPostgresStore(config, { PoolClass: CapturedRuntimePool, firstProfileHistory: FIRST_HISTORY });
    assert.equal(await store.checkProfileReady(), true);
    await caseRun(NATIVE_SCENARIOS[0], async () => {
      const transport = await createSyntheticProfileTransport({ store, subject: 'synthetic_native_transport_' + randomBytes(8).toString('hex') });
      const first = await transport.beginCreate(), created = await transport.complete(first);
      assert.equal(created.status, 303); assert.equal(new URL(created.headers.get('location')).searchParams.get('pixel'), 'created');
      const saved = await snapshot(); assert.equal(saved['rematch_pixel.accounts'].length, 1); assert.equal(saved['rematch_pixel_first.receipts'].length, 1);
      assert.equal((await (await transport.session()).json()).authenticated, true);
      await transport.signOut(); assert.equal((await (await transport.session()).json()).authenticated, false);
      const returned = await transport.complete(await transport.beginReturn());
      assert.equal(new URL(returned.headers.get('location')).searchParams.get('pixel'), 'returned');
      assert.deepEqual((await snapshot())['rematch_pixel.accounts'], saved['rematch_pixel.accounts']);
      assert.deepEqual((await snapshot())['rematch_pixel.bindings'], saved['rematch_pixel.bindings']);
      assert.equal((await transport.replay(first)).headers.getSetCookie().some(value => value.startsWith('__Host-rematch-pixel-session=')), false);
    });
    await caseRun(NATIVE_SCENARIOS[1], async () => {
      const input = await makeAttempt();
      const outcomes = await Promise.all([store.createStandaloneProfile(input), store.createStandaloneProfile(input)]);
      assert.equal(outcomes.filter(Boolean).length, 1);
      const rows = await snapshot(); for (const name of ['rematch_pixel.accounts','rematch_pixel.bindings','rematch_pixel.sessions','rematch_pixel_first.receipts']) assert.equal(rows[name].length, 1);
    });
    await caseRun(NATIVE_SCENARIOS[2], async () => {
      const subject = 'synthetic_native_same_subject_' + randomBytes(8).toString('hex');
      const a = await makeAttempt({ subject }), b = await makeAttempt({ subject });
      const outcomes = await Promise.all([store.createStandaloneProfile(a), store.createStandaloneProfile(b)]);
      const accepted = outcomes.filter(Boolean); assert.equal(accepted.length, 1);
      const saved = await snapshot(); assert.equal(saved['rematch_pixel.accounts'].length, 1); assert.equal(saved['rematch_pixel_first.receipts'].length, 1);
      const binding = JSON.parse(saved['rematch_pixel.bindings'][0].value); assert.equal(binding.account_id, accepted[0].accountId);
    });
    await caseRun(NATIVE_SCENARIOS[3], async () => {
      const input = await makeAttempt(); assert.ok(await store.createStandaloneProfile(input));
      const saved = await snapshot(); assert.equal(await store.createStandaloneProfile(input), null); await noCreate(saved);
    });
    await caseRun(NATIVE_SCENARIOS[4], async () => {
      live(); const client = guardClient(await probe.connect());
      try {
        await exactPeer(client, approved.runtimeRole);
        for (const sql of ['UPDATE rematch_pixel.accounts SET display_name=display_name',
          'UPDATE rematch_pixel.accounts SET id=id', 'DELETE FROM rematch_pixel.accounts',
          'UPDATE rematch_pixel_first.attempts SET target_account_id=target_account_id',
          'UPDATE rematch_pixel_first.receipts SET proof_hash=proof_hash', 'DELETE FROM rematch_pixel_first.receipts',
          'UPDATE rematch_pixel.schema_meta SET migration_hash=migration_hash',
          'CREATE TABLE rematch_pixel.native_first_profile_forbidden(id integer)']) {
          await assert.rejects(client.query(sql), error => error.code === '42501');
        }
      } finally { client.release(); }
    });
    for (const [index, deferred] of [[5, false], [6, true]]) await caseRun(NATIVE_SCENARIOS[index], async () => {
      const input = await makeAttempt(), before = await snapshot();
      await hook('rematch_pixel.sessions', deferred ? 'INSERT' : 'AFTER INSERT', `IF NEW.token_hash=${literal(input.tokenHash)} THEN RAISE EXCEPTION 'OWNED_NATIVE_SYNTHETIC_FAILURE'; END IF;`, { deferred });
      await assert.rejects(store.createStandaloneProfile(input)); await noCreate(before);
    });
    await caseRun(NATIVE_SCENARIOS[7], async () => {
      const input = await makeAttempt(), before = await snapshot();
      await hook('rematch_pixel.bindings', 'AFTER INSERT', `IF NEW.subject=${literal(input.subject)} THEN
        UPDATE rematch_pixel.accounts SET created_at=created_at-interval '1 second' WHERE id=NEW.account_id; END IF;`);
      assert.equal(await store.createStandaloneProfile(input), null); await noCreate(before);
    });
    for (const [index, end] of [[8,'attempt'],[9,'proof'],[10,'admission'],[11,'identity']]) await caseRun(NATIVE_SCENARIOS[index], async () => {
      const input = await makeAttempt();
      const deadline = (await ownerQuery("SELECT clock_timestamp()+interval '850 milliseconds' AS deadline")).rows[0].deadline.toISOString();
      if (end === 'attempt') await ownerQuery('UPDATE rematch_pixel.attempts SET expires_at=$2 WHERE state_hash=$1', [input.stateHash, deadline]);
      if (end === 'proof') input.proof.expiresAt = deadline;
      if (end === 'admission') { input.admissionExpiresAt = deadline; await ownerQuery('UPDATE rematch_pixel_first.attempts SET admission_expires_at=$2 WHERE state_hash=$1', [input.stateHash, deadline]); }
      if (end === 'identity') input.identityExpiresAt = deadline;
      const before = await snapshot(), locker = guardClient(await owner.connect()); let pending, outcome;
      try {
        await locker.query('BEGIN'); const blockerPid = await exactPeer(locker, approved.ownerRole);
        await locker.query('SELECT state_hash FROM rematch_pixel.attempts WHERE state_hash=$1 FOR UPDATE', [input.stateHash]);
        pending = store.createStandaloneProfile(input).then(value => ({ value }), error => ({ error }));
        await observeOwnedWait(sql => sql.includes('FOR UPDATE OF a,f'), { blockerPid, event: 'held-row' });
        await passDeadline(deadline); await locker.query('COMMIT');
      } finally {
        await locker.query('ROLLBACK').catch(() => {}); locker.release();
        if (pending) outcome = await pending;
      }
      assert.equal(outcome.error, undefined); assert.equal(outcome.value, null); await noCreate(before);
    });
    for (const [index, phase] of [[12,'session'],[13,'completion'],[14,'deferred'],[15,'short-session']]) await caseRun(NATIVE_SCENARIOS[index], async () => {
      const input = await makeAttempt();
      const deadline = (await ownerQuery("SELECT clock_timestamp()+interval '850 milliseconds' AS deadline")).rows[0].deadline.toISOString();
      if (phase === 'completion') await ownerQuery('UPDATE rematch_pixel.attempts SET expires_at=$2 WHERE state_hash=$1', [input.stateHash, deadline]);
      else if (phase !== 'short-session') input.proof.expiresAt = deadline;
      if (phase === 'short-session') await hook('rematch_pixel.sessions', 'BEFORE INSERT', `IF NEW.token_hash=${literal(input.tokenHash)} THEN NEW.expires_at=clock_timestamp()+interval '850 milliseconds'; END IF;`);
      if (phase === 'session' || phase === 'deferred') await hook('rematch_pixel.sessions', phase === 'deferred' ? 'INSERT' : 'AFTER INSERT',
        `IF NEW.token_hash=${literal(input.tokenHash)} THEN PERFORM pg_sleep(1.2); END IF;`, { deferred: phase === 'deferred' });
      else await hook('rematch_pixel.attempts', 'AFTER UPDATE', `IF NEW.state_hash=${literal(input.stateHash)} AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN PERFORM pg_sleep(1.2); END IF;`);
      const before = await snapshot();
      const pending = store.createStandaloneProfile(input).then(value => ({ value }), error => ({ error }));
      let outcome;
      try { await observeOwnedWait(sql => phase === 'session' ? sql.includes('INSERT INTO rematch_pixel.sessions') : phase === 'deferred' ? sql === 'SET CONSTRAINTS ALL IMMEDIATE' : sql.startsWith('UPDATE rematch_pixel.attempts SET completed_at'), { event: 'trigger-sleep' }); }
      finally { outcome = await pending; }
      assert.equal(outcome.error, undefined); assert.equal(outcome.value, null); await noCreate(before);
    });
    async function knownOwner() {
      const input = await makeAttempt(), account = randomUUID(), unrelatedAccount = randomUUID();
      await ownerQuery('INSERT INTO rematch_pixel.accounts(id,display_name) VALUES($1,$2),($3,$4)', [account,'Original native synthetic owner',unrelatedAccount,'Unrelated synthetic owner']);
      await ownerQuery('INSERT INTO rematch_pixel.bindings(issuer,subject,account_id,floor_epoch) VALUES($1,$2,$3,1),($1,$4,$5,4)', [ISSUER,input.subject,account,'synthetic_unrelated',unrelatedAccount]);
      const tokens = {};
      for (const [label,subject,id,epoch] of [['old',input.subject,account,1],['same',input.subject,account,2],['newer',input.subject,account,3],['unrelated','synthetic_unrelated',unrelatedAccount,4]]) {
        const state = hash('native-seed-' + label + randomUUID()), token = hash('native-seed-token-' + label + randomUUID()); tokens[label] = token;
        await ownerQuery(`INSERT INTO rematch_pixel.attempts(state_hash,browser_hash,nonce,code_verifier,redirect_uri,expires_at,consumed_at,completed_at)
          VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '2 minutes',clock_timestamp(),clock_timestamp())`, [state,hash('native-seed-browser-' + label),'n'.repeat(43),'v'.repeat(43),CALLBACK]);
        await ownerQuery(`INSERT INTO rematch_pixel.sessions(token_hash,issuer,subject,account_id,signed_epoch,expires_at,attempt_state_hash)
          VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '2 minutes',$6)`, [token,ISSUER,subject,id,epoch,state]);
      }
      return { input, account, tokens, before: await snapshot() };
    }
    async function retiredOnly(f) {
      const after = await snapshot(); assert.deepEqual(after['rematch_pixel.accounts'], f.before['rematch_pixel.accounts']);
      assert.deepEqual(after['rematch_pixel_first.receipts'], f.before['rematch_pixel_first.receipts']);
      const binding = (await ownerQuery('SELECT account_id,floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2', [ISSUER,f.input.subject])).rows[0];
      assert.equal(binding.account_id, f.account); assert.equal(Number(binding.floor_epoch), 2);
      assert.equal(await store.getSession({ tokenHash: f.tokens.old }), null);
      for (const label of ['same','newer','unrelated']) {
        const original = f.before['rematch_pixel.sessions'].find(row => JSON.parse(row.value).token_hash === f.tokens[label]);
        assert.deepEqual(after['rematch_pixel.sessions'].find(row => JSON.parse(row.value).token_hash === f.tokens[label]), original);
      }
      assert.equal(after['rematch_pixel.sessions'].length, f.before['rematch_pixel.sessions'].length);
      assert.equal(after['rematch_pixel.bindings'].length, f.before['rematch_pixel.bindings'].length);
      assert.equal((await ownerQuery('SELECT count(*)::int AS n FROM rematch_pixel.sessions WHERE token_hash=$1', [f.input.tokenHash])).rows[0].n, 0);
    }
    await caseRun(NATIVE_SCENARIOS[16], async () => {
      const f = await knownOwner(); assert.equal(await store.createStandaloneProfile(f.input), null); await retiredOnly(f);
    });
    await caseRun(NATIVE_SCENARIOS[17], async () => {
      const f = await knownOwner(); await assert.rejects(store.createStandaloneProfile({ ...f.input, displayName: '', proof: {} })); await retiredOnly(f);
    });
    await caseRun(NATIVE_SCENARIOS[18], async () => {
      const f = await knownOwner();
      await hook('rematch_pixel.bindings', 'BEFORE UPDATE', `IF NEW.subject=${literal(f.input.subject)} THEN RAISE EXCEPTION 'OWNED_NATIVE_SECURITY_PERSISTENCE_FAILURE'; END IF;`);
      await assert.rejects(store.createStandaloneProfile(f.input)); await noCreate(f.before);
    });
    await caseRun(NATIVE_SCENARIOS[19], async () => {
      const f = await knownOwner();
      const deadline = (await ownerQuery("SELECT clock_timestamp()+interval '850 milliseconds' AS deadline")).rows[0].deadline.toISOString();
      await ownerQuery('UPDATE rematch_pixel.attempts SET expires_at=$2 WHERE state_hash=$1', [f.input.stateHash,deadline]);
      const locker = guardClient(await owner.connect()); let pending, outcome;
      try {
        await locker.query('BEGIN'); const blockerPid = await exactPeer(locker, approved.ownerRole);
        await locker.query('SELECT token_hash FROM rematch_pixel.sessions WHERE token_hash=$1 FOR UPDATE', [f.tokens.old]);
        pending = store.createStandaloneProfile(f.input).then(value => ({ value }), error => ({ error }));
        await observeOwnedWait(sql => sql.startsWith('UPDATE rematch_pixel.sessions SET revoked_at=clock_timestamp()'), { blockerPid, event: 'held-row' });
        await passDeadline(deadline); await locker.query('COMMIT');
      } finally {
        await locker.query('ROLLBACK').catch(() => {}); locker.release();
        if (pending) outcome = await pending;
      }
      assert.equal(outcome.error, undefined); assert.equal(outcome.value, null); await retiredOnly(f);
    });
    assert.equal(executed, NATIVE_SCENARIOS.length);
    t.diagnostic(`Native first-profile cases attempted=${executed},passed=${passed}; fixture schemas/rows retained for operator review. Synthetic issuer/password attestations are not genuine provider proof.`);
    return { attempted: executed, passed, fixtureRetained: true };
  } finally {
    // Only own pools/connections and exact hooks created by this runner are
    // closed/removed. No DROP database/role/schema, forced disconnect, process,
    // global IPC or foreign service cleanup exists anywhere in this harness.
    if (fixtureInstalled) await removeHooks().catch(() => { t.diagnostic('Owned synthetic hook cleanup could not complete under the original authority; retained for operator review.'); });
    await store?.close(); await probe?.end();
    if (ownerLock) { await ownerLock.query('SELECT pg_advisory_unlock(1919249761,1885960614)').catch(() => {}); ownerLock.release(); }
    await owner.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5 || process.argv[2] !== '--run' || !process.argv[3] || !process.argv[4]) throw new Error('Use --run <exact-context.json> <separate-execution-permit> only after explicit target/execution authorization. For safe preparation use native-first-profile-plan.mjs --plan.');
  let context;
  try { context = JSON.parse(await readFile(process.argv[3], 'utf8')); }
  catch { throw new Error('Native fixture context could not be read as non-secret JSON.'); }
  const { test } = await import('node:test');
  test('explicitly authorized disposable native first-profile suite', { timeout: 120_000 }, t => runNativeFirstProfileSuite(t, { context, permit: process.argv[4] }));
}
