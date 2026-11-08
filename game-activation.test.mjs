import test from 'node:test';import assert from 'node:assert/strict';
import {gameActivationPlan}from'./ops/game-activation.mjs';
import {renderGameExtension,GAME_TARGET}from'./ops/game-extension.mjs';
const startsAt='2026-11-08T20:00:00.000Z',pin='a'.repeat(64);
test('saved money and standings can prepare with explicitly deferred administrator and no selected account',()=>{
 const common={reviewed:true,target:GAME_TARGET,existingCatalogSha256:pin,expectedInstalledSha256:pin,startsAt};
 assert.throws(()=>renderGameExtension(common),/pin/);const deferred=renderGameExtension({...common,deferAdmin:true});assert.equal(deferred.initialAdmin,'deferred');assert.equal(deferred.commitEnabled,false);assert.doesNotMatch(deferred.sql,/INSERT INTO rematch_game.admins/);assert.match(deferred.sql,/ROLLBACK/);
 for(const extra of [{adminAccountId:'10000000-0000-4000-8000-000000000001'},{adminBindingSha256:pin}])assert.throws(()=>renderGameExtension({...common,deferAdmin:true,...extra}),/must not select/);
});
test('operator activation rejects absent review, expired phase names and missing actual rehearsal pins',()=>{
 assert.throws(()=>gameActivationPlan({phase:'apply',startsAt}),/review/);assert.throws(()=>gameActivationPlan({reviewed:true,phase:'commit',startsAt}),/phase/);assert.throws(()=>gameActivationPlan({reviewed:true,phase:'apply',startsAt}),/pins/);assert.throws(()=>gameActivationPlan({reviewed:true,phase:'rehearsal',startsAt,expectedCatalogSha256:pin}),/establish/);assert.throws(()=>gameActivationPlan({reviewed:true,phase:'apply',startsAt:"2026-11-08'; SELECT 1",expectedCatalogSha256:pin,expectedShapeSha256:pin}));
});
test('actual SQL plans keep account data comparisons inside one transaction and distinguish rollback from pinned apply',()=>{
 const rehearsal=gameActivationPlan({reviewed:true,phase:'rehearsal',startsAt});assert.equal(rehearsal.productionWrites,false);assert.equal(rehearsal.adminBootstrap,false);assert.equal(rehearsal.createsResources,false);
 const sql=rehearsal.statements.join('\n');assert.doesNotMatch(sql,/INSERT INTO rematch_(?:pixel|game\.admins)|UPDATE rematch_pixel|DELETE FROM|DROP (?:SCHEMA|TABLE)|CREATE ROLE/i);assert.match(sql,/AUTH_ROWS_CHANGED/);assert.match(sql,/PROTECTED_CATALOG_CHANGED/);assert.match(sql,/EFFECTIVE_PRIVILEGE_MISMATCH/);assert.match(sql,/REHEARSAL_NOT_CLEAN/);
 const apply=gameActivationPlan({reviewed:true,phase:'apply',startsAt,expectedCatalogSha256:pin,expectedShapeSha256:'b'.repeat(64)});assert.equal(apply.productionWrites,true);assert.match(apply.statements.join('\n'),/BASELINE_DRIFT/);assert.match(apply.statements.join('\n'),/INSTALLED_SHAPE_DRIFT/);assert.notEqual(apply.statementSha256,rehearsal.statementSha256);
});
