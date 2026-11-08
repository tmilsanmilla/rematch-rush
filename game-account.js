import {normaliseProgress,settleProgress,buySpin,toggleVariant} from './progression.js?v=1';
/** Account data never enters the guest save. A failed/unknown write retains its
 * original idempotency key for an explicit retry, rather than charging twice. */
export function createGameAccount({fetchImpl=globalThis.fetch,storage=globalThis.localStorage,pendingStorage=globalThis.sessionStorage,onChange=()=>{}}={}){
 let account=null,available=false,pending=null;const key='rematch-rush-pending-operation-v1';try{const saved=JSON.parse(pendingStorage?.getItem(key)||'null');if(saved&&typeof saved.action==='string'&&saved.input?.operationId)pending=saved;}catch{}
 const persist=()=>{try{if(pending)pendingStorage?.setItem(key,JSON.stringify(pending));else pendingStorage?.removeItem(key);}catch{}};
 const notify=()=>onChange({available,account,pending:!!pending});
 async function request(action,input){const response=await fetchImpl(`/api/game/${action}`,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Game account is unavailable.'),{uncertain:data.uncertain,status:response.status});return data;}
 async function refresh(){try{const r=await request('status');available=r.available===true;account=r.authenticated?{...r,profile:normaliseProgress(r.profile)}:null;}catch{available=false;account=null;}notify();return account;}
 async function mutate(action,input){if(pending)throw Error('Retry the pending operation before starting another account action.');const operationId=globalThis.crypto.randomUUID();pending={action,input:{...JSON.parse(JSON.stringify(input)),operationId}};persist();notify();return retry();}
 async function retry(){if(!pending)return null;const item=pending;try{const result=await request(item.action,item.input);pending=null;persist();if(result.profile&&account)account={...account,profile:normaliseProgress(result.profile)};notify();return result;}catch(e){if(!e.uncertain&&e.status&&e.status<500&&e.status!==401)pending=null;persist();notify();throw e;}}
 return {refresh,mutate,retry,leaderboard:()=>request('leaderboard'),get current(){return account;},get available(){return available;},get pending(){return pending;}};
}
// Guest rewards use the same rules, without claiming an authoritative global rank.
export {normaliseProgress,settleProgress,buySpin,toggleVariant};
