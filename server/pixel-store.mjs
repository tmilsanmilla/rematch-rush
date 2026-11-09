import { createRequire } from 'node:module';
import { assertTargetConfig, PixelTargetError } from './pixel-target.mjs';
import { createFirstProfileMethods } from './pixel-profile-store.mjs';
import { readAcceptedIdentityFact } from './pixel-accepted-identity.mjs';
import { createEnrollmentMethods } from './pixel-enrollment-store.mjs';

const require = createRequire(import.meta.url);
const digest = /^[a-f0-9]{64}$/;
const opaque = /^[A-Za-z0-9_-]{22,256}$/;
const verifier = /^[A-Za-z0-9._~-]{43,128}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class BoundRefusal extends Error {}
const ATTEMPT_LIMIT = 1000;
const SESSION_LIMIT = 10000;
const BINDING_SESSION_LIMIT = 10;

export class PixelStorageError extends Error {
  constructor(code = 'PIXEL_STORAGE_UNAVAILABLE', status = 503) {
    super('Pixel sign-in storage is not ready.');
    this.name = 'PixelStorageError';
    this.code = code;
    this.status = status;
  }
}

const invalid = () => { throw new PixelStorageError('PIXEL_STORAGE_INPUT', 400); };
const validHash = value => typeof value === 'string' && digest.test(value);
const date = value => {
  if (!(value instanceof Date) && typeof value !== 'number' && (typeof value !== 'string' || value.length > 64)) invalid();
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed;
};
const cleanSession = row => row ? { accountId: row.account_id, displayName: row.display_name, expiresAt: new Date(row.expires_at).toISOString() } : null;
const expectedColumns = new Map(Object.entries({
  schema_meta: { singleton: 'bool', contract_version: 'int4', migration_hash: 'text' },
  accounts: { id: 'uuid', display_name: 'text', created_at: 'timestamptz' },
  bindings: { issuer: 'text', subject: 'text', account_id: 'uuid', floor_epoch: 'int8', created_at: 'timestamptz' },
  attempts: { state_hash: 'text', browser_hash: 'text', nonce: 'text', code_verifier: 'text', redirect_uri: 'text', expires_at: 'timestamptz', created_at: 'timestamptz', consumed_at: 'timestamptz', cancelled_at: 'timestamptz', completed_at: 'timestamptz' },
  sessions: { token_hash: 'text', issuer: 'text', subject: 'text', account_id: 'uuid', attempt_state_hash: 'text', signed_epoch: 'int8', expires_at: 'timestamptz', created_at: 'timestamptz', revoked_at: 'timestamptz' },
}));

async function verifyTarget(client, config) {
  // The private native fixture's owner already attests its real data directory
  // and exact socket path under an I/O guard. The least-privilege runtime cannot
  // read unix_socket_directories (a restricted GUC), and must never gain
  // pg_read_all_settings for this test. This branch is explicit test-only.

  const identity = (await client.query('SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS server_address, inet_server_port() AS server_port' +
    (config.ownedSocket ? ",current_setting('port')::int AS configured_port" : ''))).rows;
  const serverIsLoopback = identity.length === 1 && (/^127\.[0-9]+\.[0-9]+\.[0-9]+$/.test(identity[0].server_address || '') || identity[0].server_address === '::1' || /^::ffff:127\./i.test(identity[0].server_address || ''));
  if (identity.length !== 1 || identity[0].database !== config.pins.database || identity[0].role !== config.pins.role ||
      (config.localTest && (config.ownedSocket ? identity[0].server_address !== null || identity[0].server_port !== null || identity[0].configured_port !== config.pins.port :
        !['127.0.0.1', '::1'].includes(identity[0].server_address) || Number(identity[0].server_port) !== config.pins.port)) ||
      (!config.localTest && (!identity[0].server_address || serverIsLoopback))) throw new PixelTargetError('PIXEL_TARGET_MISMATCH');
  const meta = (await client.query('SELECT singleton, contract_version, migration_hash FROM rematch_pixel.schema_meta')).rows;
  if (meta.length !== 1 || meta[0].singleton !== true || meta[0].contract_version !== 1 || meta[0].migration_hash !== config.pins.history) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
  const columns = (await client.query("SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema='rematch_pixel' ORDER BY table_name,column_name")).rows;
  const actual = new Map();
  for (const row of columns) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, {});
    actual.get(row.table_name)[row.column_name] = row.udt_name;
    const nullable = row.table_name === 'attempts' && ['consumed_at', 'cancelled_at', 'completed_at'].includes(row.column_name) || row.table_name === 'sessions' && row.column_name === 'revoked_at';
    if (row.is_nullable !== (nullable ? 'YES' : 'NO')) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
  }
  if (actual.size !== expectedColumns.size) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
  for (const [table, shape] of expectedColumns) {
    const found = actual.get(table);
    if (!found || Object.keys(found).length !== Object.keys(shape).length || Object.entries(shape).some(([key, type]) => found[key] !== type)) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
  }
  const constraints = (await client.query(`SELECT c.relname AS table_name,p.contype,
    ARRAY(SELECT a.attname::text FROM unnest(p.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,
    rn.nspname AS referenced_schema,rc.relname AS referenced_table,p.confdeltype,
    ARRAY(SELECT a.attname::text FROM unnest(p.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=rc.oid AND a.attnum=k.attnum ORDER BY k.ord) AS referenced_columns
    FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_class rc ON rc.oid=p.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
    WHERE n.nspname='rematch_pixel' AND p.contype IN ('p','u','f')`)).rows;
  const has = (table, type, columns) => constraints.some(row => row.table_name === table && row.contype === type && JSON.stringify(row.columns) === JSON.stringify(columns));
  const foreign = (table, columns, reference, referenceColumns) => constraints.some(row => row.table_name === table && row.contype === 'f' &&
    JSON.stringify(row.columns) === JSON.stringify(columns) && row.referenced_schema === 'rematch_pixel' && row.referenced_table === reference &&
    JSON.stringify(row.referenced_columns) === JSON.stringify(referenceColumns) && row.confdeltype === 'r');
  if (!has('schema_meta', 'p', ['singleton']) || !has('accounts', 'p', ['id']) || !has('bindings', 'p', ['issuer', 'subject']) || !has('bindings', 'u', ['account_id']) ||
      !has('bindings', 'u', ['issuer', 'subject', 'account_id']) || !foreign('bindings', ['account_id'], 'accounts', ['id']) || !has('attempts', 'p', ['state_hash']) ||
      !has('sessions', 'p', ['token_hash']) || !has('sessions', 'u', ['attempt_state_hash']) || !foreign('sessions', ['attempt_state_hash'], 'attempts', ['state_hash']) ||
      !foreign('sessions', ['issuer', 'subject', 'account_id'], 'bindings', ['issuer', 'subject', 'account_id'])) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
}

async function lockAuthRows(client) {
  await client.query('SELECT pg_advisory_xact_lock(1919249761,1885960613)');
}

async function maintainAuthRows(client) {
  // Both insertion paths share this transaction-scoped lock, so cleanup and
  // retained-row ceilings remain atomic across independently pooled workers.
  await lockAuthRows(client);
  await client.query(`DELETE FROM rematch_pixel.sessions WHERE token_hash IN
    (SELECT token_hash FROM rematch_pixel.sessions WHERE expires_at<=clock_timestamp() ORDER BY expires_at,token_hash LIMIT 100)`);
  await client.query(`DELETE FROM rematch_pixel.attempts WHERE state_hash IN
    (SELECT a.state_hash FROM rematch_pixel.attempts a WHERE a.expires_at<=clock_timestamp()
     AND NOT EXISTS (SELECT 1 FROM rematch_pixel.sessions s WHERE s.attempt_state_hash=a.state_hash) ORDER BY a.expires_at,a.state_hash LIMIT 100)`);
}

const retainedCount = value => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new PixelStorageError();
  return count;
};

/** No schema creation or provisioning occurs here. First profiles require a separate explicit contract pin. */
export function createPostgresStore(config, { PoolClass, firstProfileHistory, enrollmentHistory, readEnrollmentPolicy = () => null } = {}) {
  assertTargetConfig(config);
  const Pool = PoolClass || require('pg').Pool;
  // A function password prevents node-postgres from falling back to PGPASSWORD.
  const pool = new Pool({ ...config.connection, password: () => config.connection.password,
    // Truthy fixed values also block node-postgres PGOPTIONS/PGREPLICATION fallbacks.
    options: '-c search_path=pg_catalog -c timezone=UTC', replication: 'false', client_encoding: 'UTF8', sslnegotiation: 'postgres',
    max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, application_name: 'rematch-pixel-bound-return' });
  pool.on?.('error', () => {});
  let closed = false;
  async function operation(work) {
    if (closed) throw new PixelStorageError();
    let client;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      began = true;
      await client.query('SET LOCAL search_path=pg_catalog');
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SET LOCAL lock_timeout='3000ms'");
      await verifyTarget(client, config);
      const result = await work(client);
      await client.query('COMMIT');
      began = false;
      return result;
    } catch (error) {
      if (client && began) { try { await client.query('ROLLBACK'); } catch {} }
      if (error instanceof BoundRefusal) return null;
      if (error instanceof PixelTargetError || error instanceof PixelStorageError) throw error;
      throw new PixelStorageError();
    } finally { client?.release(); }
  }
  // A verifier-owned minimal observation is security retirement only. This is
  // deliberately independent of profile schema/proof/name/expiry/mint checks.
  // The private marker cannot be reconstructed from request JSON or a cookie.
  function observeKnownBindingSecurity(acceptedIdentity) {
    const fact = readAcceptedIdentityFact(acceptedIdentity);
    if (!fact) invalid();
    const { issuer, subject, credentialVersion } = fact;
    return operation(async client => {
      await lockAuthRows(client);
      const binding = (await client.query('SELECT account_id,floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE', [issuer, subject])).rows[0];
      if (!binding || !uuid.test(binding.account_id)) return null;
      const floor = String(binding.floor_epoch);
      if (!/^(0|[1-9][0-9]*)$/.test(floor) || BigInt(floor) > BigInt(Number.MAX_SAFE_INTEGER)) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
      if (BigInt(credentialVersion) <= BigInt(floor)) return null;
      // Guard the live row, not equality with a previously cached floor. Only
      // the exact unchanged immutable owner returned by this write may retire.
      const advanced = (await client.query(`UPDATE rematch_pixel.bindings SET floor_epoch=$3
        WHERE issuer=$1 AND subject=$2 AND account_id=$4::uuid AND floor_epoch<$3
        RETURNING account_id,floor_epoch`, [issuer, subject, credentialVersion, binding.account_id])).rows[0];
      if (!advanced) return null;
      if (advanced.account_id !== binding.account_id || String(advanced.floor_epoch) !== String(credentialVersion)) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
      await client.query(`UPDATE rematch_pixel.sessions SET revoked_at=clock_timestamp()
        WHERE issuer=$1 AND subject=$2 AND signed_epoch<$3 AND account_id=$4::uuid AND revoked_at IS NULL`, [issuer, subject, credentialVersion, binding.account_id]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      const confirmed = (await client.query('SELECT account_id,floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE', [issuer, subject])).rows[0];
      if (!confirmed || confirmed.account_id !== binding.account_id || String(confirmed.floor_epoch) !== String(credentialVersion)) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
      return Object.freeze({ accountId: binding.account_id });
    });
  }
  const enrollment = createEnrollmentMethods({ operation, config, history: enrollmentHistory, firstProfileHistory, readPolicy: readEnrollmentPolicy,
    maintainAuthRows, observeKnownBindingSecurity, StorageError: PixelStorageError, TargetError: PixelTargetError, Refusal: BoundRefusal });
  return {
    ...createFirstProfileMethods({ operation, config, history: firstProfileHistory, maintainAuthRows, observeKnownBindingSecurity,
      enrollmentHooks: enrollment.hooks, StorageError: PixelStorageError, TargetError: PixelTargetError, Refusal: BoundRefusal }),
    ...enrollment.methods,
    observeKnownBindingSecurity,
    checkReady() { return operation(async () => true); },
    createAttempt({ stateHash, browserHash, nonce, codeVerifier, expiresAt, redirectUri } = {}) {
      if (!validHash(stateHash) || !validHash(browserHash) || typeof nonce !== 'string' || !opaque.test(nonce) || typeof codeVerifier !== 'string' || !verifier.test(codeVerifier) || typeof redirectUri !== 'string' || redirectUri.length > 2048) invalid();
      const expiry = date(expiresAt);
      return operation(async client => {
        await maintainAuthRows(client);
        const retired = (await client.query('SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=$1 AND cancelled_at IS NOT NULL LIMIT 1', [browserHash])).rows[0];
        if (retired) return false;
        const count = (await client.query('SELECT count(*)::text AS retained FROM rematch_pixel.attempts')).rows[0];
        if (retainedCount(count?.retained) >= ATTEMPT_LIMIT) return false;
        const result = await client.query(`INSERT INTO rematch_pixel.attempts(state_hash,browser_hash,nonce,code_verifier,redirect_uri,expires_at)
          SELECT $1,$2,$3,$4,$5,LEAST($6::timestamptz,clock_timestamp()+interval '5 minutes') WHERE $6::timestamptz>clock_timestamp()
          RETURNING state_hash`, [stateHash, browserHash, nonce, codeVerifier, redirectUri, expiry]);
        if (result.rowCount !== 1) invalid();
        return true;
      }).then(accepted => { if (!accepted) throw new PixelStorageError(); });
    },
    consumeAttempt({ stateHash, browserHash } = {}) {
      if (!validHash(stateHash) || !validHash(browserHash)) invalid();
      return operation(async client => {
        const row = (await client.query(`UPDATE rematch_pixel.attempts SET consumed_at=clock_timestamp()
          WHERE state_hash=$1 AND browser_hash=$2 AND consumed_at IS NULL AND cancelled_at IS NULL AND completed_at IS NULL AND expires_at>clock_timestamp()
          RETURNING nonce,code_verifier,redirect_uri,expires_at`, [stateHash, browserHash])).rows[0];
        return row ? { nonce: row.nonce, codeVerifier: row.code_verifier, redirectUri: row.redirect_uri, expiresAt: new Date(row.expires_at).toISOString() } : null;
      });
    },
    cancelAttempt({ stateHash, browserHash } = {}) {
      if (!validHash(stateHash) || !validHash(browserHash)) invalid();
      return operation(async client => {
        await lockAuthRows(client);
        const result = await client.query('UPDATE rematch_pixel.attempts SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()) WHERE state_hash=$1 AND browser_hash=$2 RETURNING state_hash', [stateHash, browserHash]);
        if (result.rowCount) await client.query('UPDATE rematch_pixel.sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE attempt_state_hash=$1', [stateHash]);
      });
    },
    hasKnownBinding({issuer,subject}={}) {
      if(typeof issuer!=='string'||!issuer||issuer.length>2048||typeof subject!=='string'||!subject||subject.length>256)invalid();
      return operation(async client=>{
        const row=(await client.query('SELECT account_id,floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE',[issuer,subject])).rows[0];
        return Boolean(row&&uuid.test(row.account_id));
      });
    },
    issueBoundSession({ issuer, subject, credentialVersion, identityExpiresAt, tokenHash, stateHash, browserHash } = {}) {
      if (typeof issuer !== 'string' || !issuer || issuer.length > 2048 || typeof subject !== 'string' || !subject || subject.length > 256 || !Number.isSafeInteger(credentialVersion) || credentialVersion < 0 || !validHash(tokenHash) || !validHash(stateHash) || !validHash(browserHash)) invalid();
      const expiry = date(identityExpiresAt);
      // The caller has already cryptographically verified this generation.
      // Learning it is security retirement, independent of optional minting:
      // capacity, cancellation, projection or expiry failure must not undo it.
      return operation(async client => {
        await lockAuthRows(client);
        const binding = (await client.query('SELECT account_id,floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE', [issuer, subject])).rows[0];
        if (!binding || !uuid.test(binding.account_id)) return null;
        const floorEpoch = String(binding.floor_epoch);
        if (!/^(0|[1-9][0-9]*)$/.test(floorEpoch) || BigInt(floorEpoch) > BigInt(Number.MAX_SAFE_INTEGER)) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
        if (BigInt(credentialVersion) < BigInt(floorEpoch)) return null;
        if (BigInt(credentialVersion) > BigInt(floorEpoch)) {
          await client.query('UPDATE rematch_pixel.bindings SET floor_epoch=$3 WHERE issuer=$1 AND subject=$2', [issuer, subject, credentialVersion]);
          await client.query('UPDATE rematch_pixel.sessions SET revoked_at=clock_timestamp() WHERE issuer=$1 AND subject=$2 AND signed_epoch<$3 AND revoked_at IS NULL', [issuer, subject, credentialVersion]);
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          const confirmed = (await client.query('SELECT account_id,floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE', [issuer, subject])).rows[0];
          if (!confirmed || confirmed.account_id !== binding.account_id || String(confirmed.floor_epoch) !== String(credentialVersion)) throw new PixelTargetError('PIXEL_SCHEMA_MISMATCH');
        }
        return { accountId: binding.account_id };
      }).then(observed => {
        if (!observed) return null;
        return operation(async client => {
          await maintainAuthRows(client);
          const admitted = (await client.query(`SELECT a.state_hash,a.expires_at::text AS attempt_expires_at,
            (to_jsonb(a)-'completed_at')::text AS attempt_snapshot FROM rematch_pixel.attempts a WHERE a.state_hash=$1 AND a.browser_hash=$2
            AND a.consumed_at IS NOT NULL AND a.cancelled_at IS NULL AND a.completed_at IS NULL AND a.expires_at>clock_timestamp() FOR UPDATE`, [stateHash, browserHash])).rows[0];
          if (!admitted) return null;
          const binding = (await client.query(`SELECT b.account_id,b.floor_epoch,a.display_name FROM rematch_pixel.bindings b JOIN rematch_pixel.accounts a ON a.id=b.account_id WHERE b.issuer=$1 AND b.subject=$2 FOR UPDATE OF b`, [issuer, subject])).rows[0];
          // A higher observation may have committed between these transactions.
          // Never mint against a changed target or a generation learned later.
          if (!binding || binding.account_id !== observed.accountId || String(binding.floor_epoch) !== String(credentialVersion)) return null;
          const count = (await client.query(`SELECT count(*)::text AS retained,
            (count(*) FILTER (WHERE issuer=$1 AND subject=$2))::text AS per_binding FROM rematch_pixel.sessions`, [issuer, subject])).rows[0];
          if (retainedCount(count?.retained) >= SESSION_LIMIT || retainedCount(count?.per_binding) >= BINDING_SESSION_LIMIT) return null;
          const mintedAt = (await client.query('SELECT clock_timestamp()::text AS minted_at')).rows[0]?.minted_at;
          if (typeof mintedAt !== 'string' || !mintedAt) throw new BoundRefusal();
          const row = (await client.query(`INSERT INTO rematch_pixel.sessions AS s(token_hash,issuer,subject,account_id,signed_epoch,expires_at,attempt_state_hash)
          SELECT $1,$2,$3,$4,$5,LEAST($6::timestamptz,$8::timestamptz+interval '5 minutes'),$7 WHERE $6::timestamptz>clock_timestamp()
          AND EXISTS (SELECT 1 FROM rematch_pixel.attempts WHERE state_hash=$7 AND expires_at>clock_timestamp() AND cancelled_at IS NULL AND completed_at IS NULL)
          RETURNING token_hash,issuer,subject,account_id,attempt_state_hash,signed_epoch,expires_at,revoked_at,
            expires_at::text AS session_expires_at,to_jsonb(s)::text AS session_snapshot`, [tokenHash, issuer, subject, binding.account_id, credentialVersion, expiry, stateHash, mintedAt])).rows[0];
          if (!row || row.token_hash !== tokenHash || row.issuer !== issuer || row.subject !== subject || row.account_id !== observed.accountId ||
              row.attempt_state_hash !== stateHash || String(row.signed_epoch) !== String(credentialVersion) || row.revoked_at !== null) throw new BoundRefusal();
          const completion = (await client.query('UPDATE rematch_pixel.attempts SET completed_at=clock_timestamp() WHERE state_hash=$1 RETURNING completed_at::text AS completed_at', [stateHash])).rows[0];
          if (!completion?.completed_at) throw new BoundRefusal();
          // Flush deferred trigger/constraint work before the last locked reads.
          // The final clock decision is function admission, not a COMMIT deadline.
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          const finalAttempt = (await client.query(`SELECT (to_jsonb(a)-'completed_at')::text AS attempt_snapshot,a.completed_at::text AS completed_at
            FROM rematch_pixel.attempts a WHERE a.state_hash=$1 AND a.browser_hash=$2 FOR UPDATE`, [stateHash, browserHash])).rows[0];
          const finalSession = (await client.query('SELECT to_jsonb(s)::text AS session_snapshot FROM rematch_pixel.sessions s WHERE s.token_hash=$1 FOR UPDATE', [tokenHash])).rows[0];
          const finalBinding = (await client.query('SELECT account_id,floor_epoch FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE', [issuer, subject])).rows[0];
          const fence = (await client.query(`WITH fence AS MATERIALIZED (SELECT clock_timestamp() AS sampled_at)
            SELECT sampled_at::text AS fence_at,($1::timestamptz>sampled_at AND $2::timestamptz>sampled_at AND $3::timestamptz>sampled_at
              AND $3::timestamptz<=$2::timestamptz AND $3::timestamptz<=$4::timestamptz+interval '5 minutes') AS deadlines_live FROM fence`,
          [admitted.attempt_expires_at, expiry, row.session_expires_at, mintedAt])).rows[0];
          if (!admitted.attempt_snapshot || !row.session_snapshot || !finalAttempt || finalAttempt.attempt_snapshot !== admitted.attempt_snapshot ||
              finalAttempt.completed_at !== completion.completed_at || !finalSession || finalSession.session_snapshot !== row.session_snapshot ||
              !finalBinding || finalBinding.account_id !== observed.accountId || String(finalBinding.floor_epoch) !== String(credentialVersion) || fence?.deadlines_live !== true) throw new BoundRefusal();
          return cleanSession({ ...row, display_name: binding.display_name });
        });
      });
    },
    getSession({ tokenHash } = {}) {
      if (!validHash(tokenHash)) invalid();
      return operation(async client => cleanSession((await client.query(`SELECT s.account_id,a.display_name,s.expires_at
        FROM rematch_pixel.sessions s JOIN rematch_pixel.bindings b ON b.issuer=s.issuer AND b.subject=s.subject AND b.account_id=s.account_id
        JOIN rematch_pixel.accounts a ON a.id=s.account_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.signed_epoch=b.floor_epoch`, [tokenHash])).rows[0]));
    },
    revokeSession({ tokenHash } = {}) {
      if (!validHash(tokenHash)) invalid();
      return operation(async client => { await client.query('UPDATE rematch_pixel.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash]); });
    },
    revokeBrowser({ tokenHash, browserHash } = {}) {
      if ((tokenHash !== undefined && !validHash(tokenHash)) || (browserHash !== undefined && !validHash(browserHash))) invalid();
      return operation(async client => {
        await lockAuthRows(client);
        const browsers = new Set(browserHash ? [browserHash] : []);
        if (tokenHash) {
          const saved = (await client.query(`SELECT a.browser_hash FROM rematch_pixel.sessions s JOIN rematch_pixel.attempts a ON a.state_hash=s.attempt_state_hash WHERE s.token_hash=$1`, [tokenHash])).rows[0];
          if (saved) browsers.add(saved.browser_hash);
        }
        const values = [...browsers];
        if (values.length) {
          await client.query('SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=ANY($1::text[]) ORDER BY state_hash FOR UPDATE', [values]);
          await client.query('UPDATE rematch_pixel.attempts SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()) WHERE browser_hash=ANY($1::text[])', [values]);
        }
        await client.query(`UPDATE rematch_pixel.sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE token_hash=$1
          OR attempt_state_hash IN (SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=ANY($2::text[]))`, [tokenHash || null, values]);
      });
    },
    async close() {
      if (!closed) {
        closed = true;
        try { await pool.end(); } catch { throw new PixelStorageError(); }
      }
    },
  };
}
