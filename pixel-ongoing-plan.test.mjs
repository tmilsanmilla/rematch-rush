import test from 'node:test';import assert from 'node:assert/strict';
import {ONGOING_SOURCE_FILES,ONGOING_NATIVE_CASES,ongoingPreparationPlan} from './test/native-ongoing-plan.mjs';
test('ongoing native plan pins the complete current runtime/DDL/driver harness without starting it',async()=>{
 const p=await ongoingPreparationPlan();assert.equal(p.connectionAttempted,false);assert.equal(p.nativeExecuted,false);assert.equal(p.action,'PREPARATION_ONLY_NO_CONNECTION');
 assert.deepEqual(Object.keys(p.sourcePins),[...ONGOING_SOURCE_FILES]);assert.equal(ONGOING_NATIVE_CASES.length,8);assert.equal(new Set(ONGOING_SOURCE_FILES).size,ONGOING_SOURCE_FILES.length);
 for(const h of Object.values(p.sourcePins))assert.match(h,/^[a-f0-9]{64}$/);
 for(const f of ['server/pixel-enrollment.mjs','server/pixel-enrollment-store.mjs','test/native-ongoing-socket.mjs','ops/sql/target-schema.sql'])assert.ok(Object.hasOwn(p.sourcePins,f));
 assert.match(p.requiredAuthority,/automatic review refusals/);assert.match(p.limitations.join(' '),/not SQL/);
});
