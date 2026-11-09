import {normaliseProgress,settleProgress,buySpin,toggleVariant} from './progression.js?v=2';
/** Account data never enters the guest save. Unknown writes retain their exact
 * idempotency key, including across sign-in redirects in this browser tab. */
export function createGameAccount({fetchImpl=globalThis.fetch,storage=globalThis.localStorage,pendingStorage=globalThis.sessionStorage,onChange=()=>{},location=globalThis.location}={}){
 let account=null,available=false,pending=null,inFlight=null,refreshing=null,lastReward=null,lastError='';const key='rematch-rush-pending-operation-v1';try{const saved=JSON.parse(pendingStorage?.getItem(key)||'null');if(saved&&typeof saved.action==='string'&&saved.input?.operationId)pending=saved;}catch{}
 const persist=()=>{try{if(pending)pendingStorage?.setItem(key,JSON.stringify(pending));else pendingStorage?.removeItem(key);}catch{}};
 const notify=()=>onChange({available,account,pending:!!pending,pendingAction:pending?.action,lastReward,lastError});
 async function request(action,input){const response=await fetchImpl(`/api/game/${action}`,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Game account is unavailable.'),{uncertain:data.uncertain,status:response.status});return data;}
 async function refresh(){if(refreshing)return refreshing;refreshing=(async()=>{try{const r=await request('status');available=r.available===true;account=r.authenticated?{...r,profile:normaliseProgress(r.profile)}:null;}catch{available=false;account=null;}notify();
  // Only a previously requested match result resumes automatically. The server
  // revalidates its original owner and operation; never submit device progress.
  if(account&&pending?.action==='finish')try{await retry();}catch{}return account;})();try{return await refreshing;}finally{refreshing=null;}}
 async function mutate(action,input){if(pending)throw Error('Retry the pending operation before starting another account action.');const operationId=globalThis.crypto.randomUUID();pending={action,input:{...JSON.parse(JSON.stringify(input)),operationId}};lastReward=null;lastError='';persist();notify();return retry();}
 async function retry(){if(inFlight)return inFlight;if(!pending)return null;const item=pending;inFlight=(async()=>{try{const result=await request(item.action,item.input);pending=null;lastError='';if(item.action==='finish')lastReward={money:result.money,points:result.points};persist();if(result.profile&&account)account={...account,profile:normaliseProgress(result.profile)};notify();return result;}catch(e){lastError=e.message;if(!e.uncertain&&e.status&&e.status<500&&e.status!==401)pending=null;persist();notify();throw e;}})();try{return await inFlight;}finally{inFlight=null;}}
 async function leaderboard(){try{return await request('leaderboard');}catch(error){if(!['localhost','127.0.0.1','[::1]'].includes(location?.hostname))throw error;
  // A static local preview has no API. Only the public aggregate is read from
  // the real game, without cookies; private account requests stay same-origin.
  const response=await fetchImpl('https://rematch-rush.vercel.app/api/game/leaderboard',{credentials:'omit',cache:'no-store'});if(!response.ok)throw error;return response.json();}}
 return {refresh,mutate,retry,leaderboard,get current(){return account;},get available(){return available;},get pending(){return pending;}};
}
export {normaliseProgress,settleProgress,buySpin,toggleVariant};
