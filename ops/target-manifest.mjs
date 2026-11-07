import {readFileSync} from 'node:fs';
import {canonical,deriveHistories,exactKeys,hashPattern,reject,sha256,validateTarget,SCHEMA_DEFINITION_SHA256} from './target-contract.mjs';
export const UNSELECTED_MANIFEST=Object.freeze({manifestVersion:1,site:'rematch-rush',approved:false,target:null,endpointBindingEvidenceSha256:null,histories:null,schemaDefinitionSha256:SCHEMA_DEFINITION_SHA256,expectedEmptyCatalogDigest:null,expectedInstalledCatalogDigest:null,renderedDdlSha256:null});
export function readManifest(path){return JSON.parse(readFileSync(path,'utf8'));}
export function validateManifest(value,{requireDdlDigest=true,requireCatalogDigest=true,phase='empty'}={}){
 if(!exactKeys(value,Object.keys(UNSELECTED_MANIFEST))||value.manifestVersion!==1||value.site!=='rematch-rush'||value.approved!==true)reject('target remains unselected/unapproved');
 const target=validateTarget(value.target),histories=deriveHistories(target);
 if(!exactKeys(value.histories,['base','first','ongoing'])||value.histories.base!==histories.base||value.histories.first!==histories.first||value.histories.ongoing!==histories.ongoing||value.schemaDefinitionSha256!==SCHEMA_DEFINITION_SHA256||
  !hashPattern.test(value.endpointBindingEvidenceSha256||'')||(requireCatalogDigest&&!hashPattern.test(value.expectedEmptyCatalogDigest||''))||
  (requireCatalogDigest&&phase==='installed'&&!hashPattern.test(value.expectedInstalledCatalogDigest||''))||
  (requireDdlDigest&&!hashPattern.test(value.renderedDdlSha256||'')))reject('missing exact history, endpoint receipt, catalog or DDL pin');
 return Object.freeze({...value,target,histories});
}
export const manifestDigest=value=>sha256(canonical(validateManifest(value)));
