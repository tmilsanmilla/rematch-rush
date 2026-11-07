import { createHash } from 'node:crypto';
import { readAcceptedIdentityFact } from './pixel-accepted-identity.mjs';

// Additional, default-unavailable standalone-profile contract. This module never
// installs a schema, adopts browser progress, searches email, or updates a binding.
const ISSUER = 'https://pixel-pulse-websites.vercel.app/api/sso';
const CALLBACK = 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const shapes = {
  schema_meta: { singleton: 'bool', contract_version: 'int4', migration_hash: 'text', base_history: 'text' },
  attempts: { state_hash: 'text', target_account_id: 'uuid', purpose: 'text', expected_subject: 'text', admission_expires_at: 'timestamptz', created_at: 'timestamptz' },
  receipts: { proof_hash: 'text', state_hash: 'text', issuer: 'text', subject: 'text', target_account_id: 'uuid', flow_hash: 'text', proof_expires_at: 'timestamptz', proof_issued_at: 'timestamptz', proof_auth_time: 'timestamptz', created_at: 'timestamptz' },
};

export function createFirstProfileMethods({ operation, config, history, maintainAuthRows, observeKnownBindingSecurity, enrollmentHooks, StorageError, TargetError, Refusal }) {
  const invalid = () => { throw new StorageError('PIXEL_STORAGE_INPUT', 400); };
  const digest = value => typeof value === 'string' && hashPattern.test(value);
  const instant = value => {
    if (!(value instanceof Date) && typeof value !== 'number' && (typeof value !== 'string' || value.length > 64)) invalid();
    const copied = new Date(value);
    if (!Number.isFinite(copied.getTime())) invalid();
    return copied.toISOString();
  };
  const count = value => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new StorageError();
    return n;
  };
  const requirePin = () => {
    if (!digest(history)) throw new TargetError('PIXEL_FIRST_PROFILE_CONTRACT_UNAPPROVED');
  };
  const validContext = ({ stateHash, browserHash, nonce, codeVerifier, redirectUri, targetAccountId }) => {
    if (!digest(stateHash) || !digest(browserHash) || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22,256}$/.test(nonce) ||
        typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) || redirectUri !== CALLBACK ||
        typeof targetAccountId !== 'string' || !uuidPattern.test(targetAccountId)) invalid();
  };
  async function verifyFirst(client) {
    const meta = (await client.query('SELECT singleton,contract_version,migration_hash,base_history FROM rematch_pixel_first.schema_meta')).rows;
    if (meta.length !== 1 || meta[0].singleton !== true || meta[0].contract_version !== 1 || meta[0].migration_hash !== history || meta[0].base_history !== config.pins.history) throw new TargetError('PIXEL_FIRST_PROFILE_SCHEMA_MISMATCH');
    const columns = (await client.query("SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema='rematch_pixel_first' ORDER BY table_name,column_name")).rows;
    const actual = new Map();
    for (const row of columns) {
      if (row.is_nullable !== 'NO') throw new TargetError('PIXEL_FIRST_PROFILE_SCHEMA_MISMATCH');
      if (!actual.has(row.table_name)) actual.set(row.table_name, {});
      actual.get(row.table_name)[row.column_name] = row.udt_name;
    }
    if (actual.size !== Object.keys(shapes).length || Object.entries(shapes).some(([table, shape]) => {
      const found = actual.get(table);
      return !found || Object.keys(found).length !== Object.keys(shape).length || Object.entries(shape).some(([name, type]) => found[name] !== type);
    })) throw new TargetError('PIXEL_FIRST_PROFILE_SCHEMA_MISMATCH');
    const constraints = (await client.query(`SELECT c.relname AS table_name,p.contype,
      ARRAY(SELECT a.attname::text FROM unnest(p.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,
      rn.nspname AS referenced_schema,rc.relname AS referenced_table,p.confdeltype,
      ARRAY(SELECT a.attname::text FROM unnest(p.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=rc.oid AND a.attnum=k.attnum ORDER BY k.ord) AS referenced_columns
      FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_class rc ON rc.oid=p.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
      WHERE n.nspname='rematch_pixel_first' AND p.contype IN ('p','u','f')`)).rows;
    const has = (table, type, names) => constraints.some(r => r.table_name === table && r.contype === type && JSON.stringify(r.columns) === JSON.stringify(names));
    const fk = (table, names, target, targetNames, deletion) => constraints.some(r => r.table_name === table && r.contype === 'f' &&
      JSON.stringify(r.columns) === JSON.stringify(names) && r.referenced_schema === 'rematch_pixel' && r.referenced_table === target &&
      JSON.stringify(r.referenced_columns) === JSON.stringify(targetNames) && r.confdeltype === deletion);
    if (!has('schema_meta', 'p', ['singleton']) || !has('attempts', 'p', ['state_hash']) || !has('attempts', 'u', ['target_account_id']) ||
        !fk('attempts', ['state_hash'], 'attempts', ['state_hash'], 'c') || !has('receipts', 'p', ['proof_hash']) ||
        !has('receipts', 'u', ['state_hash']) || !has('receipts', 'u', ['target_account_id']) || !has('receipts', 'u', ['issuer', 'subject']) ||
        !fk('receipts', ['target_account_id'], 'accounts', ['id'], 'r') ||
        !fk('receipts', ['issuer', 'subject', 'target_account_id'], 'bindings', ['issuer', 'subject', 'account_id'], 'r')) throw new TargetError('PIXEL_FIRST_PROFILE_SCHEMA_MISMATCH');
  }
  const firstOperation = work => { requirePin(); return operation(async client => { await verifyFirst(client); return work(client); }); };
  const no = () => { throw new Refusal(); };
  return {
    checkProfileReady() { return firstOperation(async () => true); },
    createProfileAttempt(input = {}) {
      requirePin(); validContext(input);
      const { stateHash, browserHash, nonce, codeVerifier, redirectUri } = input;
      if (typeof input.expectedSubject !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(input.expectedSubject)) invalid();
      const expectedSubject = input.expectedSubject, target = input.targetAccountId.toLowerCase(), expiry = instant(input.expiresAt), admissionEnd = instant(input.admissionExpiresAt);
      const ongoing = /^enroll_create_/.test(nonce);
      if (ongoing !== Boolean(input.enrollment) || ongoing && !enrollmentHooks) invalid();
      return firstOperation(async client => {
        let enrollmentGuard = ongoing ? await enrollmentHooks.prepareAttempt(client, input) : null;
        await maintainAuthRows(client);
        const retired = (await client.query('SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=$1 AND cancelled_at IS NOT NULL LIMIT 1', [browserHash])).rows[0];
        if (retired) no();
        const retained = (await client.query(`SELECT count(*)::text AS retained,
          (count(*) FILTER (WHERE a.browser_hash=$1 AND a.created_at>clock_timestamp()-interval '5 minutes' AND f.state_hash IS NOT NULL))::text AS per_browser
          FROM rematch_pixel.attempts a LEFT JOIN rematch_pixel_first.attempts f ON f.state_hash=a.state_hash`, [browserHash])).rows[0];
        if (count(retained?.retained) >= 1000 || count(retained?.per_browser) >= 6) no();
        const mintedAt = (await client.query('SELECT clock_timestamp()::text AS minted_at')).rows[0]?.minted_at;
        if (!mintedAt) no();
        const base = (await client.query(`INSERT INTO rematch_pixel.attempts AS a(state_hash,browser_hash,nonce,code_verifier,redirect_uri,expires_at)
          SELECT $1,$2,$3,$4,$5,LEAST($6::timestamptz,$7::timestamptz+interval '5 minutes',$8::timestamptz)
          WHERE $6::timestamptz>clock_timestamp() AND $8::timestamptz>clock_timestamp() AND $8::timestamptz<=$7::timestamptz+interval '5 minutes'
          RETURNING state_hash,browser_hash,nonce,code_verifier,redirect_uri,consumed_at,cancelled_at,completed_at,
            expires_at::text AS attempt_expires_at,to_jsonb(a)::text AS attempt_snapshot`, [stateHash, browserHash, nonce, codeVerifier, redirectUri, expiry, mintedAt, admissionEnd])).rows[0];
        if (!base || base.state_hash !== stateHash || base.browser_hash !== browserHash || base.nonce !== nonce || base.code_verifier !== codeVerifier ||
            base.redirect_uri !== redirectUri || base.consumed_at !== null || base.cancelled_at !== null || base.completed_at !== null || !base.attempt_snapshot) no();
        const child = (await client.query(`INSERT INTO rematch_pixel_first.attempts AS f(state_hash,target_account_id,purpose,expected_subject,admission_expires_at)
          VALUES($1,$2,'create',$3,$4) RETURNING state_hash,target_account_id,purpose,
            (expected_subject=$3 AND admission_expires_at=$4::timestamptz) AS admission_matches,to_jsonb(f)::text AS first_snapshot`, [stateHash, target, expectedSubject, admissionEnd])).rows[0];
        if (!child || child.state_hash !== stateHash || child.target_account_id !== target || child.purpose !== 'create' || child.admission_matches !== true) no();
        if (enrollmentGuard) enrollmentGuard = await enrollmentHooks.writeFlow(client, enrollmentGuard, input);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        const confirmed = (await client.query(`SELECT to_jsonb(a)::text AS attempt_snapshot,to_jsonb(f)::text AS first_snapshot
          FROM rematch_pixel.attempts a JOIN rematch_pixel_first.attempts f ON f.state_hash=a.state_hash
          WHERE a.state_hash=$1 AND a.browser_hash=$2 FOR UPDATE OF a,f`, [stateHash, browserHash])).rows[0];
        const live = (await client.query(`SELECT ($1::timestamptz>clock_timestamp() AND $1::timestamptz<=$2::timestamptz
          AND $1::timestamptz<=$3::timestamptz+interval '5 minutes' AND $4::timestamptz>clock_timestamp()
          AND $1::timestamptz<=$4::timestamptz AND $4::timestamptz<=$3::timestamptz+interval '5 minutes') AS attempt_live`, [base.attempt_expires_at, expiry, mintedAt, admissionEnd])).rows[0];
        if (!confirmed || confirmed.attempt_snapshot !== base.attempt_snapshot || confirmed.first_snapshot !== child.first_snapshot || live?.attempt_live !== true) no();
        if (enrollmentGuard) await enrollmentHooks.fenceAttempt(client, enrollmentGuard, input, [base.attempt_expires_at]);
        return true;
      }).then(accepted => { if (!accepted) throw new StorageError(); return true; });
    },
    getProfileAttempt({ stateHash, browserHash } = {}) {
      requirePin(); if (!digest(stateHash) || !digest(browserHash)) invalid();
      return firstOperation(async client => {
        const row = (await client.query(`SELECT f.target_account_id,f.expected_subject,f.admission_expires_at FROM rematch_pixel_first.attempts f JOIN rematch_pixel.attempts a ON a.state_hash=f.state_hash
          WHERE a.state_hash=$1 AND a.browser_hash=$2 AND f.purpose='create' AND a.consumed_at IS NOT NULL
            AND a.cancelled_at IS NULL AND a.completed_at IS NULL AND a.expires_at>clock_timestamp() AND f.admission_expires_at>clock_timestamp()`, [stateHash, browserHash])).rows[0];
        return row && uuidPattern.test(row.target_account_id) && /^[A-Za-z0-9_-]{1,255}$/.test(row.expected_subject) ?
          { targetAccountId: row.target_account_id, expectedSubject: row.expected_subject, admissionExpiresAt: new Date(row.admission_expires_at).toISOString() } : null;
      });
    },
    async createStandaloneProfile(input = {}) {
      // Independently commit the already accepted minimal security fact before
      // any optional profile contract, proof, name, capacity or Create refusal.
      // It never supplies account/profile creation or binding authority.
      await observeKnownBindingSecurity(input.acceptedIdentity);
      const accepted = readAcceptedIdentityFact(input.acceptedIdentity);
      if (!accepted || input.issuer !== accepted.issuer || input.subject !== accepted.subject || input.credentialVersion !== accepted.credentialVersion) invalid();
      requirePin(); validContext(input);
      const { issuer, subject, credentialVersion, displayName, tokenHash, stateHash, browserHash, nonce, codeVerifier, redirectUri, expectedFlowHash } = input;
      const target = input.targetAccountId.toLowerCase(), identityEnd = instant(input.identityExpiresAt), admissionEnd = instant(input.admissionExpiresAt), proof = input.proof;
      if (issuer !== ISSUER || typeof subject !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(subject) || !Number.isSafeInteger(credentialVersion) || credentialVersion < 0 ||
          typeof displayName !== 'string' || !displayName || displayName !== displayName.trim() || displayName.length > 80 || /[\x00-\x1f\x7f]/.test(displayName) || !digest(tokenHash) || !digest(expectedFlowHash) ||
          proof?.issuer !== issuer || proof.subject !== subject || proof.credentialVersion !== credentialVersion || typeof proof.jti !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(proof.jti) ||
          proof.flowHash !== expectedFlowHash || !Number.isSafeInteger(proof.authTime) || !Number.isSafeInteger(proof.issuedAt) || proof.authTime < 0 || proof.authTime > proof.issuedAt || proof.issuedAt - proof.authTime > 90) invalid();
      const proofEnd = instant(proof.expiresAt), issuedAt = proof.issuedAt, authTime = proof.authTime, proofHash = hash(proof.jti);
      const ongoing = /^enroll_create_/.test(nonce);
      if (ongoing !== Boolean(input.enrollment) || ongoing && !enrollmentHooks) invalid();
      if (new Date(proofEnd).getTime() <= issuedAt * 1000 || new Date(proofEnd).getTime() > issuedAt * 1000 + 30_000) invalid();
      return firstOperation(async client => {
        const enrollmentGuard = ongoing ? await enrollmentHooks.prepareComplete(client, input) : null;
        await maintainAuthRows(client);
        const admitted = (await client.query(`SELECT a.expires_at::text AS attempt_expires_at,(to_jsonb(a)-'completed_at')::text AS attempt_snapshot,
          f.admission_expires_at::text AS admission_expires_at,to_jsonb(f)::text AS first_snapshot FROM rematch_pixel.attempts a JOIN rematch_pixel_first.attempts f ON f.state_hash=a.state_hash
          WHERE a.state_hash=$1 AND a.browser_hash=$2 AND a.nonce=$3 AND a.code_verifier=$4 AND a.redirect_uri=$5
            AND f.target_account_id=$6::uuid AND f.purpose='create' AND f.expected_subject=$8 AND f.admission_expires_at>clock_timestamp()
            AND $7::timestamptz>clock_timestamp() AND $7::timestamptz<=f.admission_expires_at
            AND a.consumed_at IS NOT NULL AND a.cancelled_at IS NULL AND a.completed_at IS NULL AND a.expires_at>clock_timestamp() FOR UPDATE OF a,f`,
        [stateHash, browserHash, nonce, codeVerifier, redirectUri, target, admissionEnd, subject])).rows[0];
        if (!admitted?.attempt_snapshot || !admitted.first_snapshot) no();
        if ((await client.query('SELECT account_id FROM rematch_pixel.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE', [issuer, subject])).rows.length ||
            (await client.query('SELECT id FROM rematch_pixel.accounts WHERE id=$1 FOR UPDATE', [target])).rows.length) no();
        const counts = (await client.query(`SELECT (SELECT count(*)::text FROM rematch_pixel.accounts) AS profiles,
          (SELECT count(*)::text FROM rematch_pixel.sessions) AS sessions,(SELECT count(*)::text FROM rematch_pixel_first.receipts) AS receipts`)).rows[0];
        if (count(counts?.profiles) >= 100000 || count(counts?.sessions) >= 10000 || count(counts?.receipts) >= 100000) no();
        const mintedAt = (await client.query('SELECT clock_timestamp()::text AS minted_at')).rows[0]?.minted_at;
        if (!mintedAt) no();
        const originalLive = (await client.query(`WITH sampled AS MATERIALIZED(SELECT clock_timestamp() AS at)
          SELECT ($1::timestamptz>at AND $2::timestamptz>at AND $3::timestamptz>at AND to_timestamp($4::double precision)<=at
            AND to_timestamp($5::double precision)>=at-interval '90 seconds' AND $6::timestamptz>at AND $7::timestamptz>at
            AND $7::timestamptz<=$6::timestamptz) AS first_live FROM sampled`,
        [admitted.attempt_expires_at, identityEnd, proofEnd, issuedAt, authTime, admitted.admission_expires_at, admissionEnd])).rows[0];
        if (originalLive?.first_live !== true) no();
        const account = (await client.query(`INSERT INTO rematch_pixel.accounts AS a(id,display_name) VALUES($1,$2)
          RETURNING id,display_name,to_jsonb(a)::text AS account_snapshot`, [target, displayName])).rows[0];
        if (!account || account.id !== target || account.display_name !== displayName || !account.account_snapshot) no();
        const binding = (await client.query(`INSERT INTO rematch_pixel.bindings AS b(issuer,subject,account_id,floor_epoch) VALUES($1,$2,$3,$4)
          RETURNING issuer,subject,account_id,floor_epoch,to_jsonb(b)::text AS binding_snapshot`, [issuer, subject, target, credentialVersion])).rows[0];
        if (!binding || binding.issuer !== issuer || binding.subject !== subject || binding.account_id !== target || String(binding.floor_epoch) !== String(credentialVersion) || !binding.binding_snapshot) no();
        const receipt = (await client.query(`INSERT INTO rematch_pixel_first.receipts AS r(proof_hash,state_hash,issuer,subject,target_account_id,flow_hash,proof_expires_at,proof_issued_at,proof_auth_time)
          VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8::double precision),to_timestamp($9::double precision))
          RETURNING proof_hash,state_hash,target_account_id,
            (issuer=$3 AND subject=$4 AND target_account_id=$5::uuid AND flow_hash=$6 AND proof_expires_at=$7::timestamptz
              AND proof_issued_at=to_timestamp($8::double precision) AND proof_auth_time=to_timestamp($9::double precision)) AS receipt_matches,
            to_jsonb(r)::text AS receipt_snapshot`, [proofHash, stateHash, issuer, subject, target, expectedFlowHash, proofEnd, issuedAt, authTime])).rows[0];
        if (!receipt || receipt.proof_hash !== proofHash || receipt.state_hash !== stateHash || receipt.target_account_id !== target || receipt.receipt_matches !== true || !receipt.receipt_snapshot) no();
        const session = (await client.query(`INSERT INTO rematch_pixel.sessions AS s(token_hash,issuer,subject,account_id,signed_epoch,expires_at,attempt_state_hash)
          SELECT $1,$2,$3,$4,$5,LEAST($6::timestamptz,$8::timestamptz+interval '5 minutes'),$7
          WHERE $6::timestamptz>clock_timestamp() AND EXISTS(SELECT 1 FROM rematch_pixel.attempts WHERE state_hash=$7 AND cancelled_at IS NULL AND completed_at IS NULL AND expires_at>clock_timestamp())
          RETURNING token_hash,issuer,subject,account_id,attempt_state_hash,signed_epoch,expires_at,revoked_at,expires_at::text AS session_expires_at,to_jsonb(s)::text AS session_snapshot`,
        [tokenHash, issuer, subject, target, credentialVersion, identityEnd, stateHash, mintedAt])).rows[0];
        if (!session || session.token_hash !== tokenHash || session.issuer !== issuer || session.subject !== subject || session.account_id !== target ||
            session.attempt_state_hash !== stateHash || String(session.signed_epoch) !== String(credentialVersion) || session.revoked_at !== null || !session.session_snapshot) no();
        const completion = (await client.query('UPDATE rematch_pixel.attempts SET completed_at=clock_timestamp() WHERE state_hash=$1 RETURNING completed_at::text AS completed_at', [stateHash])).rows[0];
        if (!completion?.completed_at) no();
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        const endAttempt = (await client.query(`SELECT (to_jsonb(a)-'completed_at')::text AS attempt_snapshot,a.completed_at::text AS completed_at,to_jsonb(f)::text AS first_snapshot
          FROM rematch_pixel.attempts a JOIN rematch_pixel_first.attempts f ON f.state_hash=a.state_hash WHERE a.state_hash=$1 AND a.browser_hash=$2 FOR UPDATE OF a,f`, [stateHash, browserHash])).rows[0];
        const endAccount = (await client.query('SELECT to_jsonb(a)::text AS account_snapshot FROM rematch_pixel.accounts a WHERE id=$1 FOR UPDATE', [target])).rows[0];
        const endBinding = (await client.query('SELECT to_jsonb(b)::text AS binding_snapshot FROM rematch_pixel.bindings b WHERE issuer=$1 AND subject=$2 FOR UPDATE', [issuer, subject])).rows[0];
        const endReceipt = (await client.query('SELECT to_jsonb(r)::text AS receipt_snapshot FROM rematch_pixel_first.receipts r WHERE proof_hash=$1 FOR UPDATE', [proofHash])).rows[0];
        const endSession = (await client.query('SELECT to_jsonb(s)::text AS session_snapshot FROM rematch_pixel.sessions s WHERE token_hash=$1 FOR UPDATE', [tokenHash])).rows[0];
        const fence = (await client.query(`WITH first_fence AS MATERIALIZED(SELECT clock_timestamp() AS sampled_at)
          SELECT ($1::timestamptz>sampled_at AND $2::timestamptz>sampled_at AND $3::timestamptz>sampled_at AND $4::timestamptz>sampled_at
            AND $4::timestamptz<=$2::timestamptz AND $4::timestamptz<=$5::timestamptz+interval '5 minutes'
            AND to_timestamp($6::double precision)<=sampled_at AND to_timestamp($7::double precision)>=sampled_at-interval '90 seconds'
            AND $8::timestamptz>sampled_at AND $9::timestamptz>sampled_at AND $9::timestamptz<=$8::timestamptz) AS deadlines_live FROM first_fence`,
        [admitted.attempt_expires_at, identityEnd, proofEnd, session.session_expires_at, mintedAt, issuedAt, authTime, admitted.admission_expires_at, admissionEnd])).rows[0];
        if (!endAttempt || endAttempt.attempt_snapshot !== admitted.attempt_snapshot || endAttempt.first_snapshot !== admitted.first_snapshot || endAttempt.completed_at !== completion.completed_at ||
            endAccount?.account_snapshot !== account.account_snapshot || endBinding?.binding_snapshot !== binding.binding_snapshot ||
            endReceipt?.receipt_snapshot !== receipt.receipt_snapshot || endSession?.session_snapshot !== session.session_snapshot || fence?.deadlines_live !== true) no();
        if (enrollmentGuard) await enrollmentHooks.fenceComplete(client, enrollmentGuard, input, [admitted.attempt_expires_at, session.session_expires_at]);
        return { accountId: target, displayName, expiresAt: new Date(session.expires_at).toISOString() };
      });
    },
  };
}
