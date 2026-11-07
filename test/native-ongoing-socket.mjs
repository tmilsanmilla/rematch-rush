// Actual PG17 SQL + real receiver/JOSE; all identities/keys are fictional.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash,randomBytes} from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';
import {ONGOING_SOURCE_FILES} from './native-ongoing-plan.mjs';
import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';import dns from 'node:dns';import cp from 'node:child_process';
assert.equal(process.env.NODE_ENV,'test');for(const k of ['DATABASE_URL','PGHOST','PGPORT','PGUSER','PGPASSWORD','REMATCH_PIXEL_DATABASE_URL'])assert.equal(process.env[k],undefined);
const file=path.resolve(process.argv[2]||'');assert.match(file,/^\/private\/tmp\/rematch-enrollment-pg-[A-Za-z0-9]{6,}\/context\.json$/);const ctx=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(path.dirname(file),ctx.owned);assert.equal(ctx.socket,path.join(ctx.owned,'socket'));assert.equal(ctx.data,path.join(ctx.owned,'data'));assert.equal(ctx.port,55472);assert.equal(ctx.user,'owned_rematch_test');assert.ok(Date.now()<ctx.expiresAt&&ctx.expiresAt-Date.now()<=180000);assert.equal(fs.statSync(ctx.owned).mode&0o777,0o700);
assert.equal(ctx.root,path.resolve(new URL('../',import.meta.url).pathname));assert.deepEqual(Object.keys(ctx.pins).sort(),[...ONGOING_SOURCE_FILES].sort());
for(const [f,h]of Object.entries(ctx.pins)){assert.ok(!f.includes('..'));assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ctx.root,f))).digest('hex'),h);}
let denied=0;const deny=()=>{denied++;throw Error('Native validation denied external/shared I/O');};const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const a=args[0],target=typeof a==='string'?a:a&&typeof a==='object'?a.path:undefined;assert.ok(target===path.join(ctx.socket,'.s.PGSQL.55472'),'Only the exact newly owned socket may be contacted');return connect.apply(this,args);};
net.Server.prototype.listen=deny;tls.connect=deny;http.request=http.get=http.createServer=https.request=https.get=https.createServer=deny;dns.lookup=dns.resolve=deny;globalThis.fetch=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();
const {default:pg}=await import('pg');const {createPostgresStore}=await import('../server/pixel-store.mjs');const {readTargetConfig}=await import('../server/pixel-target.mjs');const {SCHEMA_SQL,TABLE_PRIVILEGES}=await import('../ops/target-contract.mjs');const {createSyntheticProfileTransport}=await import('./support/pixel-profile-transport.mjs');
const hash=s=>createHash('sha256').update(s).digest('hex'),base=hash('rematch-pixel-bound-return-local-v1'),first=hash('rematch-pixel-first-profile-local-v1'),ongoing=hash('synthetic-ongoing-enrollment-v1');
const owner='rematch_fixture_owner',migrator='rematch_fixture_migrator',runtime='rematch_fixture_runtime',database='rematch_pixel_test_'+randomBytes(12).toString('hex'),generation='33333333-3333-4333-8333-333333333333';
const admin=new pg.Pool({host:ctx.socket,port:ctx.port,user:ctx.user,database:'postgres',max:1});let db,store,roles;const results=[];const policy={configured:true,valid:true,enabled:true,generation};
// Diagnostics stay inside the fictional owned fixture. Production errors remain
// masked. Record SQLSTATE and statement only, never parameters or connections.
class FixtureDiagnosticPool extends pg.Pool {
 constructor(options){super(options);this.on('connect',client=>{
  const query=client.query.bind(client);
  client.query=(...args)=>{const result=query(...args);return result&&typeof result.catch==='function'?result.catch(error=>{
   console.error(JSON.stringify({nativeRuntimeSqlError:{code:error.code||null,message:String(error.message).slice(0,200),statement:String(args[0]).slice(0,240)}}));throw error;
  }):result;};
 });}
}
const id=s=>'"'+s.replaceAll('"','""')+'"';
const notice=r=>new URL(r.headers.get('location')).searchParams.get('pixel');
async function check(name,fn){await fn();results.push({name,pass:true});}
try{
 const target=(await admin.query("SELECT current_user AS role,inet_server_addr() AS address,current_setting('data_directory') AS data,current_setting('unix_socket_directories') AS socket,current_setting('port')::int AS port")).rows[0];assert.deepEqual(target,{role:ctx.user,address:null,data:ctx.data,socket:ctx.socket,port:ctx.port});
 for(const r of [owner,migrator,runtime])await admin.query(`CREATE ROLE ${id(r)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await admin.query(`GRANT ${id(owner)} TO ${id(migrator)} WITH INHERIT FALSE,SET TRUE`);await admin.query(`CREATE DATABASE ${id(database)} OWNER ${id(owner)}`);
 db=new pg.Pool({host:ctx.socket,port:ctx.port,user:ctx.user,database,max:2});
 const tables=(await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','S','f')")).rows[0].n;assert.equal(tables,0);
 const schema=SCHEMA_SQL.split('-- BEGIN REMATCH SCHEMA DEFINITION\n')[1].split('-- END REMATCH SCHEMA DEFINITION\n')[0];
 const connection=await db.connect();try{await connection.query('BEGIN');await connection.query('SET LOCAL ROLE '+id(owner));await connection.query(schema);
 await connection.query('INSERT INTO rematch_pixel.schema_meta VALUES(true,1,$1)',[base]);await connection.query('INSERT INTO rematch_pixel_first.schema_meta VALUES(true,1,$1,$2)',[first,base]);await connection.query('INSERT INTO rematch_pixel_ongoing.schema_meta VALUES(true,1,$1,$2,$3)',[ongoing,base,first]);await connection.query('INSERT INTO rematch_pixel_ongoing.policy VALUES(true,true,$1,0)',[generation]);
 await connection.query(`REVOKE ALL ON DATABASE ${id(database)} FROM PUBLIC,${id(runtime)}`);await connection.query(`GRANT CONNECT ON DATABASE ${id(database)} TO ${id(runtime)},${id(migrator)}`);await connection.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC,${id(runtime)}`);await connection.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${id(owner)} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
 for(const s of ['rematch_pixel','rematch_pixel_first','rematch_pixel_ongoing']){await connection.query(`REVOKE ALL ON SCHEMA ${id(s)} FROM PUBLIC,${id(runtime)}`);await connection.query(`GRANT USAGE ON SCHEMA ${id(s)} TO ${id(runtime)}`);await connection.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${id(s)} FROM PUBLIC,${id(runtime)}`);}
 for(const [table,p]of Object.entries(TABLE_PRIVILEGES)){const q=table.split('.').map(id).join('.');await connection.query(`GRANT ${p.table.join(',')} ON ${q} TO ${id(runtime)}`);if(p.updateColumns.length)await connection.query(`GRANT UPDATE(${p.updateColumns.map(id).join(',')}) ON ${q} TO ${id(runtime)}`);}
 await connection.query('COMMIT');}catch(e){await connection.query('ROLLBACK');throw e;}finally{connection.release();}
 const config=readTargetConfig({NODE_ENV:'test',REMATCH_PIXEL_LOCAL_TEST_MODE:'true',REMATCH_PIXEL_TARGET_APPROVED:'true',REMATCH_PIXEL_DATABASE_URL:`postgresql://${runtime}@127.0.0.1:55472/${database}`,REMATCH_PIXEL_APPROVED_HOST:'127.0.0.1',REMATCH_PIXEL_APPROVED_PORT:'55472',REMATCH_PIXEL_APPROVED_DATABASE:database,REMATCH_PIXEL_APPROVED_ROLE:runtime,REMATCH_PIXEL_APPROVED_HISTORY:base,REMATCH_PIXEL_OWNED_SOCKET:ctx.socket});
 store=createPostgresStore(config,{PoolClass:FixtureDiagnosticPool,firstProfileHistory:first,enrollmentHistory:ongoing,readEnrollmentPolicy:()=>policy});roles=new pg.Pool({host:ctx.socket,port:ctx.port,user:runtime,database,max:1});
 const actorA='11111111-1111-4111-8111-111111111111',actorB='22222222-2222-4222-8222-222222222222';
 const createTransport=subject=>createSyntheticProfileTransport({store,subject,enrollmentPolicy:()=>policy});
 const discovery=async t=>{const flow=await t.beginDiscovery();assert.equal(notice(await t.complete(flow)),'discovered');return flow;};
 const count=async()=>Number((await db.query('SELECT count(*) AS n FROM rematch_pixel.accounts')).rows[0].n);
 const t=await createTransport(actorA);
 await check('actual socket target, source DDL and narrow runtime schema admission',async()=>{assert.equal(await store.checkReady(),true);assert.equal(await store.checkProfileReady(),true);});
 await check('real JOSE discovery stores receipt without provisioning',async()=>{await discovery(t);assert.equal(await count(),0);assert.equal((await(await t.session()).json()).discoveryReady,true);assert.equal(t.stats().proof,0);});
 let flow;await check('two native workers consume one discovery at most once',async()=>{const r=await Promise.allSettled([t.beginCreate(),t.beginCreate()]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);flow=r.find(x=>x.status==='fulfilled').value;assert.equal(Number((await db.query("SELECT count(*) AS n FROM rematch_pixel_ongoing.flows WHERE purpose='create'")).rows[0].n),1);});
 await check('actual native callback race creates one immutable standalone profile',async()=>{const r=await Promise.all([t.complete(flow),t.replay(flow)]);assert.equal(r.filter(x=>notice(x)==='created').length,1);assert.equal(await count(),1);assert.equal((await(await t.session()).json()).authenticated,true);});
 await check('runtime cannot mutate policy generation/enabled, actor ownership or truncate',async()=>{for(const sql of ["UPDATE rematch_pixel_ongoing.policy SET enabled=false","UPDATE rematch_pixel_ongoing.policy SET generation='22222222-2222-4222-8222-222222222222'","UPDATE rematch_pixel_ongoing.discoveries SET subject='forbidden'",'TRUNCATE rematch_pixel.accounts'])await assert.rejects(roles.query(sql),e=>e.code==='42501');await assert.rejects(roles.query('UPDATE rematch_pixel_ongoing.policy SET lock_tag=1'),e=>e.code==='23514');});
 const b=await createTransport(actorB);await check('second verified actor needs its own receipt/fresh proof',async()=>{await discovery(b);const f=await b.beginCreate();assert.equal(notice(await b.complete(f)),'created');assert.equal(await count(),2);});
 await check('closed enrollment retains original known-bound return',async()=>{await t.signOut();policy.enabled=false;await db.query('UPDATE rematch_pixel_ongoing.policy SET enabled=false');const a=await t.beginReturn();assert.equal(notice(await t.complete(a)),'returned');assert.equal((await(await t.session()).json()).authenticated,true);assert.equal(await count(),2);});
 await check('native unknown ordinary return still refuses without provisioning',async()=>{const unknown=await createTransport('44444444-4444-4444-8444-444444444444');assert.equal(notice(await unknown.complete(await unknown.beginReturn())),'refused');assert.equal(await count(),2);});
 assert.equal(denied,0);console.log(JSON.stringify({status:'PASS',tests:results,nativeCases:results.length,externalIoDenied:denied,qualified:'Actual private socket PG17 SQL/concurrency/ACL + real JOSE with synthetic in-process issuer. NOT genuine provider/password/hosted/PG18 or production migration proof.'}));
}catch(error){console.error(String(error.stack||error));process.exitCode=1;}
finally{await store?.close();await roles?.end();await db?.end();await admin.end();}
