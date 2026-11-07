import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';

export const SCHEMAS=Object.freeze(['rematch_pixel','rematch_pixel_first','rematch_pixel_ongoing']);
export const SCHEMA_SQL=readFileSync(new URL('./sql/target-schema.sql',import.meta.url),'utf8');
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const SCHEMA_DEFINITION_SHA256=sha256(SCHEMA_SQL);
export const TABLE_PRIVILEGES=Object.freeze({
 'rematch_pixel.schema_meta':{table:['SELECT'],updateColumns:[]},
 'rematch_pixel.accounts':{table:['SELECT','INSERT'],updateColumns:['created_at']},
 'rematch_pixel.bindings':{table:['SELECT','INSERT'],updateColumns:['floor_epoch']},
 'rematch_pixel.attempts':{table:['SELECT','INSERT','DELETE'],updateColumns:['consumed_at','cancelled_at','completed_at']},
 'rematch_pixel.sessions':{table:['SELECT','INSERT','DELETE'],updateColumns:['revoked_at']},
 'rematch_pixel_first.schema_meta':{table:['SELECT'],updateColumns:[]},
 'rematch_pixel_first.attempts':{table:['SELECT','INSERT'],updateColumns:['created_at']},
 'rematch_pixel_first.receipts':{table:['SELECT','INSERT'],updateColumns:['created_at']},
 'rematch_pixel_ongoing.schema_meta':{table:['SELECT'],updateColumns:[]},
 'rematch_pixel_ongoing.policy':{table:['SELECT'],updateColumns:['lock_tag']},
 'rematch_pixel_ongoing.discoveries':{table:['SELECT','INSERT','DELETE'],updateColumns:['consumed_at']},
 'rematch_pixel_ongoing.flows':{table:['SELECT','INSERT'],updateColumns:['created_at']},
});
export const TABLE_OPERATIONS=Object.freeze(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']);
export const COLUMN_OPERATIONS=Object.freeze(['SELECT','INSERT','UPDATE','REFERENCES']);
export const reject=message=>{throw new Error('Rematch target preparation: '+message);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
export const hashPattern=/^[a-f0-9]{64}$/;
export const identifierPattern=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
export const canonical=value=>JSON.stringify(normalize(value));
function normalize(value){
 if(Array.isArray(value))return value.map(normalize);
 if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])]));
 return value;
}
export function validateTarget(t){
 const keys=['host','port','database','projectId','branchId','schemaOwner','migrationRole','runtimeRole','serverAddresses','serverPort'];
 const hasOperator=t&&Object.hasOwn(t,'operatorRole');
 const optional=['operatorRole','databaseOwner','bootstrapAdminGrantor','providerDatabaseRole'].filter(k=>t&&Object.hasOwn(t,k));
 if(!exactKeys(t,[...keys,...optional])||hasOperator&&(!identifierPattern.test(t.operatorRole||'')||[t.schemaOwner,t.migrationRole,t.runtimeRole].includes(t.operatorRole))||Object.hasOwn(t,'databaseOwner')&&(!hasOperator||![t.schemaOwner,t.operatorRole].includes(t.databaseOwner))||Object.hasOwn(t,'bootstrapAdminGrantor')&&(!hasOperator||!identifierPattern.test(t.bootstrapAdminGrantor||'')||[t.schemaOwner,t.migrationRole,t.runtimeRole,t.operatorRole].includes(t.bootstrapAdminGrantor))||Object.hasOwn(t,'providerDatabaseRole')&&(!hasOperator||t.databaseOwner!==t.operatorRole||!identifierPattern.test(t.providerDatabaseRole||'')||[t.schemaOwner,t.migrationRole,t.runtimeRole,t.operatorRole,t.bootstrapAdminGrantor].includes(t.providerDatabaseRole))||typeof t.host!=='string'||!t.host||t.host.length>253||!/^([a-z0-9.-]+|::1)$/.test(t.host)||t.host.includes('..')||
  !Number.isInteger(t.port)||t.port<1||t.port>65535||!Number.isInteger(t.serverPort)||t.serverPort<1||t.serverPort>65535||
  !['database','schemaOwner','migrationRole','runtimeRole'].every(k=>identifierPattern.test(t[k]||''))||new Set([t.schemaOwner,t.migrationRole,t.runtimeRole]).size!==3||
  !['projectId','branchId'].every(k=>typeof t[k]==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(t[k]))||
  !Array.isArray(t.serverAddresses)||!t.serverAddresses.length||t.serverAddresses.some(x=>{if(typeof x!=='string')return true;const [host,mask,...extra]=x.split('/');const family=isIP(host);return !family||extra.length>0||mask!==undefined&&mask!==(family===4?'32':'128');})||new Set(t.serverAddresses).size!==t.serverAddresses.length)reject('complete dedicated endpoint/database/project/branch/three-role target required');
 return Object.freeze({...t,serverAddresses:Object.freeze([...t.serverAddresses])});
}
export const targetDigest=t=>sha256(canonical(validateTarget(t)));
export function deriveHistories(target){
 const t=validateTarget(target);
 const base=sha256(canonical({kind:'rematch-bound-return-production-contract-v1',target:t,schemaDefinitionSha256:SCHEMA_DEFINITION_SHA256,privileges:TABLE_PRIVILEGES}));
 const first=sha256(canonical({kind:'rematch-standalone-first-production-contract-v1',target:t,baseHistory:base,schemaDefinitionSha256:SCHEMA_DEFINITION_SHA256,privileges:TABLE_PRIVILEGES}));
 return Object.freeze({base,first,ongoing:sha256(canonical({kind:'rematch-ongoing-discovery-contract-v1',target:t,baseHistory:base,firstHistory:first,schemaDefinitionSha256:SCHEMA_DEFINITION_SHA256,privileges:TABLE_PRIVILEGES}))});
}

export const expectedDatabaseOwner=t=>t.databaseOwner||t.schemaOwner;
export function trustedBootstrapAdminEdge(t,r){return Boolean(t.operatorRole&&t.bootstrapAdminGrantor&&r.member===t.operatorRole&&[t.schemaOwner,t.migrationRole,t.runtimeRole].includes(r.role)&&r.grantor===t.bootstrapAdminGrantor&&r.admin_option===true&&r.inherit_option===false&&r.set_option===false);}
