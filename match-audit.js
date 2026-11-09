// Shared deterministic match record. Contains game inputs, never cookies/account
// identifiers. It is replayed by the same engine before account rewards settle.
export const LEGACY_ENGINE_VERSION='dlsi-stage1-20261107';
export const PREVIOUS_ENGINE_VERSION='dlsi-stage1-charge36-20261108';
export const ENGINE_VERSION='flow-xp-20261109';
export function seededRandom(seed){let state=0;for(let i=0;i<32;i+=8)state^=parseInt(seed.slice(i,i+8),16);state>>>=0;state||=0x9e3779b9;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
export function cleanMatchInput(value){if(!value||typeof value!=='object')throw Error('Invalid recorded input.');const input={};if(value.keys){input.keys={};for(const k of ['w','a','s','d'])input.keys[k]=value.keys[k]===true;}
 if(value.aim){if(!Number.isFinite(value.aim.x)||!Number.isFinite(value.aim.y)||Math.abs(value.aim.x)>100000||Math.abs(value.aim.y)>100000)throw Error('Invalid recorded aim.');input.aim={x:value.aim.x,y:value.aim.y};}
 for(const k of ['shootHeld','shootRelease','cancelShot','ultraShot','action','pass','awaken','skipReplay','flow'])if(k in value)input[k]=value[k]===true;
 if(value.skill!=null){if(!Number.isInteger(value.skill)||value.skill<1||value.skill>6)throw Error('Invalid recorded move.');input.skill=value.skill;}
 if(value.qte!=null){if(!/^[a-z]$/.test(value.qte))throw Error('Invalid recorded letter.');input.qte=value.qte;}return input;
}
const edges=new Set(['action','pass','shootRelease','cancelShot','awaken','skipReplay','flow','skill','qte']);
const same=(key,a,b)=>key==='aim'?a?.x===b?.x&&a?.y===b?.y:key==='keys'?['w','a','s','d'].every(k=>!!a?.[k]===!!b?.[k]):a===b;
export function recordInput(game,id,input){if(!game.audit||game.replayingAudit)return;const p=game.state.players.find(p=>p.id===id);if(!p||p.isBot)return;const clean=cleanMatchInput(input),old=(game.auditInputs||={})[id]||{},delta={};let edge=false;for(const [key,value]of Object.entries(clean)){if(edges.has(key)){if(value){delta[key]=value;edge=true;}}else if(!same(key,value,old[key]))delta[key]=value;}game.auditInputs[id]={...old,...clean};if(!Object.keys(delta).length)return;
 // Coalesce only adjacent continuous packets for the same actor and simulation
 // step. An action/release/QTE is an ordering barrier and is never collapsed.
 const events=game.audit.events,last=events.at(-1),step=game.audit.steps.length;
 if(!edge&&last?.[0]===step&&last[1]===id&&!Object.keys(last[2]).some(k=>edges.has(k))){Object.assign(last[2],delta);return;}
 if(events.length>=30000){game.audit.overflow=true;return;}events.push([step,id,delta]);}

export function recordStep(game,dt){if(!game.audit||game.replayingAudit)return;if(game.audit.steps.length>=60000){game.audit.overflow=true;return;}game.audit.steps.push(dt);}
