import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {readTargetConfig} from '../../server/pixel-target.mjs';
import {createPostgresStore} from '../../server/pixel-store.mjs';
import {createAcceptedIdentityMarker} from '../../server/pixel-accepted-identity.mjs';
// Trusted server-side test capability; this models verifier acceptance, not JWT proof.
const markAccepted = createAcceptedIdentityMarker();

const hash = value => createHash('sha256').update(value).digest('hex');
const history = hash('rematch-pixel-bound-return-local-v1');
const firstHistory = hash('rematch-pixel-first-profile-local-v1');
const issuer = 'https://pixel-pulse-websites.vercel.app/api/sso';
const redirectUri = 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';
const baseShapes = {
  schema_meta: { singleton:'bool', contract_version:'int4', migration_hash:'text' },
  accounts: { id:'uuid', display_name:'text', created_at:'timestamptz' },
  bindings: { issuer:'text', subject:'text', account_id:'uuid', floor_epoch:'int8', created_at:'timestamptz' },
  attempts: { state_hash:'text', browser_hash:'text', nonce:'text', code_verifier:'text', redirect_uri:'text', expires_at:'timestamptz', created_at:'timestamptz', consumed_at:'timestamptz', cancelled_at:'timestamptz', completed_at:'timestamptz' },
  sessions: { token_hash:'text', issuer:'text', subject:'text', account_id:'uuid', attempt_state_hash:'text', signed_epoch:'int8', expires_at:'timestamptz', created_at:'timestamptz', revoked_at:'timestamptz' },
};
const firstShapes = {
  schema_meta: { singleton:'bool', contract_version:'int4', migration_hash:'text', base_history:'text' },
  attempts: { state_hash:'text', target_account_id:'uuid', purpose:'text', expected_subject:'text', admission_expires_at:'timestamptz', created_at:'timestamptz' },
  receipts: { proof_hash:'text', state_hash:'text', issuer:'text', subject:'text', target_account_id:'uuid', flow_hash:'text', proof_expires_at:'timestamptz', proof_issued_at:'timestamptz', proof_auth_time:'timestamptz', created_at:'timestamptz' },
};
const constraint = (table_name,contype,columns,referenced_table,referenced_columns,confdeltype='r') =>
  ({table_name,contype,columns,referenced_schema:referenced_table?'rematch_pixel':null,referenced_table,referenced_columns:referenced_columns||[],confdeltype});
const baseConstraints = [
  constraint('schema_meta','p',['singleton']),constraint('accounts','p',['id']),constraint('bindings','p',['issuer','subject']),
  constraint('bindings','u',['account_id']),constraint('bindings','u',['issuer','subject','account_id']),constraint('bindings','f',['account_id'],'accounts',['id']),
  constraint('attempts','p',['state_hash']),constraint('sessions','p',['token_hash']),constraint('sessions','u',['attempt_state_hash']),
  constraint('sessions','f',['attempt_state_hash'],'attempts',['state_hash']),constraint('sessions','f',['issuer','subject','account_id'],'bindings',['issuer','subject','account_id']),
];
const firstConstraints = [
  constraint('schema_meta','p',['singleton']),constraint('attempts','p',['state_hash']),constraint('attempts','u',['target_account_id']),
  constraint('attempts','f',['state_hash'],'attempts',['state_hash'],'c'),constraint('receipts','p',['proof_hash']),constraint('receipts','u',['state_hash']),
  constraint('receipts','u',['target_account_id']),constraint('receipts','u',['issuer','subject']),constraint('receipts','f',['target_account_id'],'accounts',['id']),
  constraint('receipts','f',['issuer','subject','target_account_id'],'bindings',['issuer','subject','account_id']),
];
const config = () => readTargetConfig({ NODE_ENV:'test', REMATCH_PIXEL_LOCAL_TEST_MODE:'true', REMATCH_PIXEL_TARGET_APPROVED:'true',
  REMATCH_PIXEL_DATABASE_URL:'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef', REMATCH_PIXEL_APPROVED_HOST:'127.0.0.1',
  REMATCH_PIXEL_APPROVED_PORT:'5432', REMATCH_PIXEL_APPROVED_DATABASE:'rematch_pixel_test_abcdef', REMATCH_PIXEL_APPROVED_ROLE:'rematch_test', REMATCH_PIXEL_APPROVED_HISTORY:history });

// Stateful transactional adapter double ONLY. It models rollback/commit and
// explicitly controlled waits/triggers; it does not execute PostgreSQL, parse
// SQL semantics or prove concurrent/native trigger/constraint behavior.
export function model(options={}) {
  const initialTime=1_800_000_000_000;
  let now=initialTime, committed={accounts:[],bindings:[],attempts:[],firstAttempts:[],receipts:[],sessions:[],...structuredClone(options.extraState||{})}, connections=0;
  const statements=[],events=[];
  const snapshot=value=>JSON.stringify(value);
  const withoutCompletion = row => { const copied={...row};delete copied.completed_at;return snapshot(copied); };
  const instant=()=>new Date(now).toISOString();
  const result=(rows=[])=>({rows,rowCount:rows.length});
  function failAfter(name){if(options.failAfter===name)throw Error('SYNTHETIC '+name+' failure');}
  class PoolDouble {
    on(){} async end(){}
    async connect(){
      connections++;let draft;
      return {release(){},query:async(sql,params=[])=>{
        statements.push({sql,params:structuredClone(params)});
        if(sql==='BEGIN'){assert.equal(draft,undefined);draft=structuredClone(committed);events.push('begin');return result();}
        if(sql==='COMMIT'){committed=structuredClone(draft);draft=undefined;events.push('commit');return result();}
        if(sql==='ROLLBACK'){draft=undefined;events.push('rollback');return result();}
        assert.ok(draft,'every adapter operation requires explicit transaction');
        const extra = options.queryHook?.({sql,params,draft,now,getNow:()=>now,initialTime,instant,result,snapshot,advance:value=>{now=value;}});
        if(extra!==undefined)return await extra;
        if(sql.startsWith('SET LOCAL')||sql.includes('pg_advisory_xact_lock'))return result();
        if(sql==='SET CONSTRAINTS ALL IMMEDIATE'){
          if(options.advanceAfterFlush!==undefined)now=initialTime+options.advanceAfterFlush;
          const mode=options.mutateAfterFlush;
          if(mode==='account'&&draft.accounts.length)draft.accounts.at(-1).display_name='Changed';
          if(mode==='binding'&&draft.bindings.length)draft.bindings.at(-1).floor_epoch++;
          if(mode==='receipt'&&draft.receipts.length)draft.receipts.at(-1).flow_hash=hash('changed');
          if(mode==='session'&&draft.sessions.length)draft.sessions.at(-1).revoked_at=instant();
          if(mode==='child'&&draft.firstAttempts.length)draft.firstAttempts.at(-1).target_account_id=randomUUID();
          if(mode==='policy'&&draft.firstAttempts.length)draft.firstAttempts.at(-1).admission_expires_at=new Date(now+600000).toISOString();
          if(mode==='actor'&&draft.firstAttempts.length)draft.firstAttempts.at(-1).expected_subject='other_actor';
          if(mode==='attempt'&&draft.attempts.length)draft.attempts.at(-1).expires_at=new Date(new Date(draft.attempts.at(-1).expires_at).getTime()+60000).toISOString();
          if(mode==='cancel'&&draft.attempts.length)draft.attempts.at(-1).cancelled_at=instant();
          options.onFlush?.(draft,{now,advance:value=>{now=value;}});failAfter('flush');return result();
        }
        if(sql.startsWith('SELECT current_database'))return result([{database:'rematch_pixel_test_abcdef',role:'rematch_test',server_address:'127.0.0.1',server_port:5432}]);
        if(sql.includes('FROM rematch_pixel.schema_meta'))return result([{singleton:true,contract_version:1,migration_hash:history}]);
        if(sql.includes('FROM rematch_pixel_first.schema_meta'))return result([{singleton:true,contract_version:1,migration_hash:options.wrongHistory?hash('wrong'):firstHistory,base_history:history}]);
        if(sql.includes('FROM information_schema.columns')){
          const first=sql.includes("table_schema='rematch_pixel_first'");
          const rows=Object.entries(first?firstShapes:baseShapes).flatMap(([table_name,shape])=>Object.entries(shape).map(([column_name,udt_name])=>
            ({table_name,column_name,udt_name,is_nullable:!first&&['consumed_at','cancelled_at','completed_at','revoked_at'].includes(column_name)?'YES':'NO'})));
          if(first&&options.badColumns)rows.pop();return result(rows);
        }
        if(sql.includes('FROM pg_constraint')){
          const first=sql.includes("n.nspname='rematch_pixel_first'");return result(first&&options.badConstraints?firstConstraints.slice(1):first?firstConstraints:baseConstraints);
        }
        if(sql.startsWith('DELETE FROM rematch_pixel.sessions')){draft.sessions=draft.sessions.filter(row=>new Date(row.expires_at).getTime()>now);return result();}
        if(sql.startsWith('DELETE FROM rematch_pixel.attempts')){
          draft.attempts=draft.attempts.filter(row=>new Date(row.expires_at).getTime()>now||draft.sessions.some(s=>s.attempt_state_hash===row.state_hash));
          draft.firstAttempts=draft.firstAttempts.filter(row=>draft.attempts.some(a=>a.state_hash===row.state_hash));return result();
        }
        if(sql.startsWith('SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=$1 AND cancelled_at'))return result(draft.attempts.filter(a=>a.browser_hash===params[0]&&a.cancelled_at!==null).slice(0,1));
        if(sql.startsWith('SELECT count(*)::text AS retained,'))return result([{retained:String(options.attemptCap?1000:draft.attempts.length),per_browser:String(options.browserCap?6:draft.firstAttempts.filter(f=>draft.attempts.some(a=>a.state_hash===f.state_hash&&a.browser_hash===params[0]&&new Date(a.created_at).getTime()>now-300000)).length)}]);
        if(sql==='SELECT clock_timestamp()::text AS minted_at')return result([{minted_at:instant()}]);
        if(sql.startsWith('INSERT INTO rematch_pixel.attempts AS a')){
          if(draft.attempts.some(a=>a.state_hash===params[0]))throw Error('Synthetic unique state');
          if(new Date(params[5]).getTime()<=now||new Date(params[7]).getTime()<=now||new Date(params[7]).getTime()>new Date(params[6]).getTime()+300000)return result();
          const a={state_hash:params[0],browser_hash:params[1],nonce:params[2],code_verifier:params[3],redirect_uri:params[4],
            expires_at:new Date(Math.min(new Date(params[5]).getTime(),new Date(params[6]).getTime()+300000,new Date(params[7]).getTime())).toISOString(),created_at:instant(),consumed_at:null,cancelled_at:null,completed_at:null};
          if(options.extendCreatedAttempt)a.expires_at=new Date(new Date(params[5]).getTime()+60000).toISOString();
          draft.attempts.push(a);failAfter('base');return result([{...a,attempt_expires_at:a.expires_at,attempt_snapshot:snapshot(a)}]);
        }
        if(sql.startsWith('INSERT INTO rematch_pixel_first.attempts AS f')){
          if(draft.firstAttempts.some(f=>f.state_hash===params[0]||f.target_account_id===params[1]))throw Error('Synthetic unique child');
          const f={state_hash:params[0],target_account_id:params[1],purpose:'create',expected_subject:params[2],admission_expires_at:params[3],created_at:instant()};draft.firstAttempts.push(f);failAfter('child');
          return result([{...f,admission_matches:true,first_snapshot:snapshot(f)}]);
        }
        if(sql.startsWith('SELECT to_jsonb(a)::text AS attempt_snapshot,to_jsonb(f)::text AS first_snapshot')){
          const a=draft.attempts.find(a=>a.state_hash===params[0]&&a.browser_hash===params[1]),f=draft.firstAttempts.find(f=>f.state_hash===params[0]);
          return result(a&&f?[{attempt_snapshot:snapshot(a),first_snapshot:snapshot(f)}]:[]);
        }
        if(sql.startsWith('SELECT ($1::timestamptz>clock_timestamp()'))return result([{attempt_live:new Date(params[0]).getTime()>now&&new Date(params[0]).getTime()<=new Date(params[1]).getTime()&&new Date(params[0]).getTime()<=new Date(params[2]).getTime()+300000&&new Date(params[3]).getTime()>now&&new Date(params[0]).getTime()<=new Date(params[3]).getTime()&&new Date(params[3]).getTime()<=new Date(params[2]).getTime()+300000}]);
        if(sql.startsWith('UPDATE rematch_pixel.attempts SET consumed_at=')){
          const a=draft.attempts.find(a=>a.state_hash===params[0]&&a.browser_hash===params[1]&&a.consumed_at===null&&a.cancelled_at===null&&a.completed_at===null&&new Date(a.expires_at).getTime()>now);
          if(a)a.consumed_at=instant();return result(a?[{...a}]:[]);
        }
        if(sql.startsWith('SELECT f.target_account_id')){
          const a=draft.attempts.find(a=>a.state_hash===params[0]&&a.browser_hash===params[1]&&a.consumed_at!==null&&a.cancelled_at===null&&a.completed_at===null&&new Date(a.expires_at).getTime()>now);
          const f=a&&draft.firstAttempts.find(f=>f.state_hash===a.state_hash&&f.purpose==='create'&&new Date(f.admission_expires_at).getTime()>now);return result(f?[{target_account_id:f.target_account_id,expected_subject:f.expected_subject,admission_expires_at:f.admission_expires_at}]:[]);
        }
        if(sql.startsWith('SELECT a.expires_at::text AS attempt_expires_at')){
          const a=draft.attempts.find(a=>a.state_hash===params[0]&&a.browser_hash===params[1]&&a.nonce===params[2]&&a.code_verifier===params[3]&&a.redirect_uri===params[4]&&a.consumed_at!==null&&a.cancelled_at===null&&a.completed_at===null&&new Date(a.expires_at).getTime()>now);
          const f=a&&draft.firstAttempts.find(f=>f.state_hash===params[0]&&f.target_account_id===params[5]&&f.purpose==='create'&&f.expected_subject===params[7]&&new Date(f.admission_expires_at).getTime()>now&&new Date(params[6]).getTime()>now&&new Date(params[6]).getTime()<=new Date(f.admission_expires_at).getTime());
          return result(a&&f?[{attempt_expires_at:a.expires_at,admission_expires_at:f.admission_expires_at,attempt_snapshot:withoutCompletion(a),first_snapshot:snapshot(f)}]:[]);
        }
        if(sql.startsWith('SELECT account_id,floor_epoch FROM rematch_pixel.bindings'))return result(draft.bindings.filter(b=>b.issuer===params[0]&&b.subject===params[1]).map(b=>({account_id:b.account_id,floor_epoch:String(b.floor_epoch)})));
        if(sql.startsWith('UPDATE rematch_pixel.bindings SET floor_epoch=')){
          const b=draft.bindings.find(b=>b.issuer===params[0]&&b.subject===params[1]&&b.account_id===params[3]&&b.floor_epoch<params[2]);
          if(b)b.floor_epoch=params[2];failAfter('securityFloor');return result(b?[{account_id:b.account_id,floor_epoch:String(b.floor_epoch)}]:[]);
        }
        if(sql.startsWith('UPDATE rematch_pixel.sessions SET revoked_at=clock_timestamp()')){
          const rows=draft.sessions.filter(s=>s.issuer===params[0]&&s.subject===params[1]&&s.signed_epoch<params[2]&&s.account_id===params[3]&&s.revoked_at===null);
          for(const row of rows)row.revoked_at=instant();failAfter('securityRetirement');return result(rows);
        }
        if(sql.startsWith('SELECT s.account_id,a.display_name,s.expires_at')){
          const s=draft.sessions.find(s=>s.token_hash===params[0]&&s.revoked_at===null&&new Date(s.expires_at).getTime()>now&&draft.bindings.some(b=>b.issuer===s.issuer&&b.subject===s.subject&&b.account_id===s.account_id&&b.floor_epoch===s.signed_epoch));
          const a=s&&draft.accounts.find(a=>a.id===s.account_id);return result(s&&a?[{account_id:s.account_id,display_name:a.display_name,expires_at:s.expires_at}]:[]);
        }
        if(sql.startsWith('SELECT account_id FROM rematch_pixel.bindings'))return result(draft.bindings.filter(b=>b.issuer===params[0]&&b.subject===params[1]));
        if(sql.startsWith('SELECT id FROM rematch_pixel.accounts'))return result(draft.accounts.filter(a=>a.id===params[0]));
        if(sql.startsWith('SELECT (SELECT count(*)::text FROM rematch_pixel.accounts)'))return result([{profiles:String(options.profileCap?100000:draft.accounts.length),sessions:String(options.sessionCap?10000:draft.sessions.length),receipts:String(options.receiptCap?100000:draft.receipts.length)}]);
        if(sql.startsWith('WITH sampled AS MATERIALIZED'))return result([{first_live:params.slice(0,3).every(v=>new Date(v).getTime()>now)&&params[3]*1000<=now&&params[4]*1000>=now-90000&&params.slice(5,7).every(v=>new Date(v).getTime()>now)&&new Date(params[6]).getTime()<=new Date(params[5]).getTime()}]);
        if(sql.startsWith('INSERT INTO rematch_pixel.accounts AS a')){
          if(draft.accounts.some(a=>a.id===params[0]))throw Error('Synthetic account conflict');
          const a={id:params[0],display_name:params[1],created_at:instant()};draft.accounts.push(a);failAfter('account');return result([{...a,account_snapshot:snapshot(a)}]);
        }
        if(sql.startsWith('INSERT INTO rematch_pixel.bindings AS b')){
          if(draft.bindings.some(b=>b.issuer===params[0]&&b.subject===params[1]||b.account_id===params[2]))throw Error('Synthetic binding conflict');
          const b={issuer:params[0],subject:params[1],account_id:params[2],floor_epoch:params[3],created_at:instant()};draft.bindings.push(b);failAfter('binding');return result([{...b,binding_snapshot:snapshot(b)}]);
        }
        if(sql.startsWith('INSERT INTO rematch_pixel_first.receipts AS r')){
          if(draft.receipts.some(r=>r.proof_hash===params[0]||r.state_hash===params[1]||r.target_account_id===params[4]))throw Error('Synthetic replay refusal');
          const r={proof_hash:params[0],state_hash:params[1],issuer:params[2],subject:params[3],target_account_id:params[4],flow_hash:params[5],proof_expires_at:params[6],proof_issued_at:new Date(params[7]*1000).toISOString(),proof_auth_time:new Date(params[8]*1000).toISOString(),created_at:instant()};
          draft.receipts.push(r);failAfter('receipt');return result([{...r,receipt_matches:options.receiptCorruption!==true,receipt_snapshot:snapshot(r)}]);
        }
        if(sql.startsWith('INSERT INTO rematch_pixel.sessions AS s')){
          if(draft.sessions.some(s=>s.token_hash===params[0]||s.attempt_state_hash===params[6]))throw Error('Synthetic session conflict');
          const s={token_hash:params[0],issuer:params[1],subject:params[2],account_id:params[3],signed_epoch:params[4],expires_at:new Date(Math.min(new Date(params[5]).getTime(),new Date(params[7]).getTime()+300000)).toISOString(),attempt_state_hash:params[6],created_at:instant(),revoked_at:null};
          draft.sessions.push(s);failAfter('session');if(options.advanceAfterSession!==undefined)now=initialTime+options.advanceAfterSession;
          return result([{...s,session_expires_at:s.expires_at,session_snapshot:snapshot(s)}]);
        }
        if(sql.startsWith('UPDATE rematch_pixel.attempts SET completed_at=')){
          const a=draft.attempts.find(a=>a.state_hash===params[0]);if(a)a.completed_at=instant();failAfter('completion');
          if(options.advanceAfterCompletion!==undefined)now=initialTime+options.advanceAfterCompletion;
          return result(a?[{completed_at:a.completed_at}]:[]);
        }
        if(sql.startsWith("SELECT (to_jsonb(a)-'completed_at')::text AS attempt_snapshot")){
          const a=draft.attempts.find(a=>a.state_hash===params[0]&&a.browser_hash===params[1]),f=draft.firstAttempts.find(f=>f.state_hash===params[0]);
          return result(a&&f?[{attempt_snapshot:withoutCompletion(a),completed_at:a.completed_at,first_snapshot:snapshot(f)}]:[]);
        }
        if(sql.startsWith('SELECT to_jsonb(a)::text AS account_snapshot'))return result(draft.accounts.filter(a=>a.id===params[0]).map(a=>({account_snapshot:snapshot(a)})));
        if(sql.startsWith('SELECT to_jsonb(b)::text AS binding_snapshot'))return result(draft.bindings.filter(b=>b.issuer===params[0]&&b.subject===params[1]).map(b=>({binding_snapshot:snapshot(b)})));
        if(sql.startsWith('SELECT to_jsonb(r)::text AS receipt_snapshot'))return result(draft.receipts.filter(r=>r.proof_hash===params[0]).map(r=>({receipt_snapshot:snapshot(r)})));
        if(sql.startsWith('SELECT to_jsonb(s)::text AS session_snapshot')){
          if(options.advanceAfterLastRead!==undefined)now=initialTime+options.advanceAfterLastRead;failAfter('lastRead');
          return result(draft.sessions.filter(s=>s.token_hash===params[0]).map(s=>({session_snapshot:snapshot(s)})));
        }
        if(sql.startsWith('WITH first_fence AS MATERIALIZED')){
          failAfter('clock');return result([{deadlines_live:params.slice(0,4).every(v=>new Date(v).getTime()>now)&&new Date(params[3]).getTime()<=new Date(params[1]).getTime()&&new Date(params[3]).getTime()<=new Date(params[4]).getTime()+300000&&params[5]*1000<=now&&params[6]*1000>=now-90000&&params.slice(7,9).every(v=>new Date(v).getTime()>now)&&new Date(params[8]).getTime()<=new Date(params[7]).getTime()}]);
        }
        throw Error('Unexpected synthetic query: '+sql.slice(0,110));
      }};
    }
  }
  const store=createPostgresStore(config(),{PoolClass:PoolDouble,firstProfileHistory:options.omitHistory?undefined:firstHistory,...options.storeOptions});
  const context={stateHash:hash('state'),browserHash:hash('browser'),nonce:'n'.repeat(32),codeVerifier:'v'.repeat(43),redirectUri,targetAccountId:randomUUID(),expiresAt:new Date(initialTime+60000),expectedSubject:'new_actor',admissionExpiresAt:new Date(initialTime+50000)};
  const issuedAt=initialTime/1000,proof={issuer,subject:'new_actor',credentialVersion:2,jti:randomUUID(),flowHash:hash('exact-nine-field-flow'),issuedAt,authTime:issuedAt-5,expiresAt:new Date(initialTime+20000).toISOString()};
  const input={...context,issuer,subject:'new_actor',credentialVersion:2,acceptedIdentity:markAccepted({issuer,subject:'new_actor',credentialVersion:2}),identityExpiresAt:new Date(initialTime+120000),displayName:'New player',tokenHash:hash('new session'),expectedFlowHash:proof.flowHash,proof};
  return {store,context,input,initialTime,statements,events,get now(){return now;},get connections(){return connections;},get state(){return structuredClone(committed);},
    change(fn){fn(committed);},setNow(value){now=value;},async prepare(){await store.createProfileAttempt(context);assert.ok(await store.consumeAttempt(context));return store.getProfileAttempt(context);}};
}


export {history,firstHistory,hash,issuer,markAccepted};
