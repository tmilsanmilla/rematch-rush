import test from 'node:test';import assert from 'node:assert/strict';import{gameNativePlan,validateGameNativeContext,gameFixturePool}from'./test/game-native.mjs';
test('game native preparation hashes its full runtime/DDL closure and creates no driver or target',async()=>{const p=await gameNativePlan();assert.equal(p.action,'PREPARATION_ONLY');assert.equal(p.nativeExecuted,false);assert.equal(Object.keys(p.sources).length,16);assert.match(p.sourceHash,/^[a-f0-9]{64}$/);assert.equal(p.cases.length,10);});
test('native execution context refuses missing permission, cloud/shared/expired/mismatched fixtures before driver import',async()=>{const now=Date.now(),context={host:'127.0.0.1',port:54339,database:'rematch_pixel_test_aabbccdd',ownerRole:'rematch_game_test_owner_aabbccdd',runtimeRole:'rematch_game_test_runtime_aabbccdd'},plan=await gameNativePlan(),permit={scope:'REMATCH_GAME_OWNED_EMPTY_LOCAL_FIXTURE_ONLY',...context,startsAt:now-100,endsAt:now+1000,sourceHash:plan.sourceHash,ddlHash:plan.ddlHash};assert.equal(validateGameNativeContext(context,permit,now).database,context.database);for(const bad of [{...context,host:'db.example.com'},{...context,database:'rematch_pixel'},{...context,runtimeRole:'neondb_owner'}])assert.throws(()=>validateGameNativeContext(bad,permit,now));for(const bad of [undefined,{...permit,endsAt:now},{...permit,database:'other'},{...permit,startsAt:now+1},{...permit,endsAt:now+700000}])assert.throws(()=>validateGameNativeContext(context,bad,now));});

// Mirrors the installed pg-pool's callback invocation shape, without importing
// a driver, creating a client or permitting any SQL/network operation.
class SyntheticPool{
 constructor(){this.calls=[];this.releases=0;this.client={query:async(sql,...args)=>{this.calls.push([sql,...args]);return {rows:[{sql}]};}};}
 connect(done){if(done){queueMicrotask(()=>done(null,this.client,()=>{this.releases++;}));return;}return Promise.resolve(this.client);}
 query(sql,values){return new Promise((resolve,reject)=>this.connect((error,client,release)=>{if(error)return reject(error);client.query(sql,values,(failure,result)=>{release();if(failure)reject(failure);else resolve(result);});}));}
}
test('native fixture wrapper preserves Pool callback and awaited Client query overloads without double wrapping',async()=>{
 const phases=[],Pool=gameFixturePool(SyntheticPool,{beforeQuery:sql=>phases.push('before '+sql),afterQuery:sql=>phases.push('after '+sql)}),pool=new Pool();
 assert.deepEqual(await pool.query('owner setup',[1]),{rows:[{sql:'owner setup'}]});assert.equal(pool.releases,1);
 const client=await pool.connect();assert.deepEqual(await client.query('runtime read',[2]),{rows:[{sql:'runtime read'}]});
 const callbackResult=await new Promise((resolve,reject)=>pool.connect((error,c,release)=>{if(error)return reject(error);c.query('observer read',(failure,result)=>{release();if(failure)reject(failure);else resolve(result);});}));
 assert.deepEqual(callbackResult,{rows:[{sql:'observer read'}]});assert.equal(pool.calls.length,3);assert.equal(pool.releases,2);assert.deepEqual(phases,['before owner setup','after owner setup','before runtime read','after runtime read','before observer read','after observer read']);
});
test('native fixture callback and promise refusals propagate without issuing a statement',async()=>{
 const Pool=gameFixturePool(SyntheticPool,{beforeQuery:()=>{throw Error('finite permit ended');}}),pool=new Pool();
 await assert.rejects(pool.query('denied setup',[]),/finite permit ended/);const client=await pool.connect();await assert.rejects(client.query('denied read'),/finite permit ended/);assert.equal(pool.calls.length,0);assert.equal(pool.releases,1);
 const Closed=gameFixturePool(SyntheticPool,{beforeConnect:()=>{throw Error('closed fixture');}}),closed=new Closed();await assert.rejects(closed.query('never connect'),/closed fixture/);await assert.rejects(closed.connect(),/closed fixture/);assert.equal(closed.calls.length,0);
});
test('native fixture waits for the after-query fence and reports its failure through callback form',async()=>{
 let finish;const Pool=gameFixturePool(SyntheticPool,{afterQuery:()=>new Promise((resolve,reject)=>{finish=()=>reject(Error('late final write'));})}),pool=new Pool();let settled=false;
 const pending=pool.query('last write',[]).finally(()=>{settled=true;});for(let i=0;i<8&&!finish;i++)await Promise.resolve();assert.equal(typeof finish,'function');assert.equal(settled,false);finish();await assert.rejects(pending,/late final write/);assert.equal(pool.calls.length,1);assert.equal(pool.releases,1);
});
