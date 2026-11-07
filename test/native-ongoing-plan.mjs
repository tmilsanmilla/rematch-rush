// Filesystem-only preparation. No engine, driver, socket, secret or child import.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const ONGOING_SOURCE_FILES=Object.freeze([
 'package.json','package-lock.json','server/pixel-oidc.mjs','server/pixel-proof.mjs','server/pixel-handler.mjs',
 'server/pixel-runtime.mjs','server/pixel-target.mjs','server/pixel-store.mjs','server/pixel-profile-store.mjs',
 'server/pixel-enrollment.mjs','server/pixel-enrollment-store.mjs','server/pixel-accepted-identity.mjs',
 'ops/sql/target-schema.sql','ops/target-contract.mjs','test/support/pixel-profile-transport.mjs',
 'test/native-ongoing-plan.mjs','test/run-owned-ongoing-postgres.mjs','test/native-ongoing-socket.mjs',
]);
export const ONGOING_NATIVE_CASES=Object.freeze([
 'actual private socket identity, source DDL and runtime schema admission',
 'real JOSE discovery creates receipt only, no profile or session',
 'two native workers consume one browser discovery once',
 'callback race creates one immutable standalone profile',
 'runtime cannot mutate policy, actor ownership or truncate',
 'second synthetic verified actor has its own discovery and fresh proof',
 'closed enrollment preserves original known-bound ordinary return',
 'unknown ordinary return refuses without provisioning',
]);
export async function ongoingPreparationPlan(){
 return {action:'PREPARATION_ONLY_NO_CONNECTION',connectionAttempted:false,nativeExecuted:false,
  sourcePins:Object.fromEntries(await Promise.all(ONGOING_SOURCE_FILES.map(async f=>[f,createHash('sha256').update(await readFile(new URL('../'+f,import.meta.url))).digest('hex')]))),
  cases:ONGOING_NATIVE_CASES,requiredAuthority:'Separate explicit native-engine/temporary-empty-local-role/database execution approval; historical automatic review refusals must not be bypassed. Source preparation is not an execution receipt.',
  fixture:'New private 0700 socket-only PG17 cluster, no TCP, fictional roles and empty disposable DB; guard denies external/shared I/O; stop/remove only own successfully stopped cluster.',
  limitations:['Preparation is not SQL/concurrency/ACL execution.','Synthetic JOSE/password authorities are not real provider/current-password or hosted browser proof.','PG17 fixture does not certify selected future cloud PG18 target.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--plan')throw Error('Only --plan is supported; no execution transport.');
 console.log(JSON.stringify(await ongoingPreparationPlan(),null,2));
}
