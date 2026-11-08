// Shared deterministic match record. Contains game inputs, never cookies/account
// identifiers. It is replayed by the same engine before account rewards settle.
export const LEGACY_ENGINE_VERSION='dlsi-stage1-20261107';
export const ENGINE_VERSION='dlsi-stage1-charge36-20261108';
export function seededRandom(seed){let state=0;for(let i=0;i<32;i+=8)state^=parseInt(seed.slice(i,i+8),16);state>>>=0;state||=0x9e3779b9;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
export function cleanMatchInput(value){if(!value||typeof value!=='object')throw Error('Invalid recorded input.');const input={};if(value.keys){input.keys={};for(const k of ['w','a','s','d'])input.keys[k]=value.keys[k]===true;}
 if(value.aim){if(!Number.isFinite(value.aim.x)||!Number.isFinite(value.aim.y)||Math.abs(value.aim.x)>100000||Math.abs(value.aim.y)>100000)throw Error('Invalid recorded aim.');input.aim={x:value.aim.x,y:value.aim.y};}
 for(const k of ['shootHeld','shootRelease','cancelShot','ultraShot','action','pass','awaken','skipReplay'])if(k in value)input[k]=value[k]===true;
 if(value.skill!=null){if(!Number.isInteger(value.skill)||value.skill<1||value.skill>6)throw Error('Invalid recorded move.');input.skill=value.skill;}
 if(value.qte!=null){if(!/^[a-z]$/.test(value.qte))throw Error('Invalid recorded letter.');input.qte=value.qte;}return input;
}
export function recordInput(game,id,input){if(!game.audit||game.replayingAudit)return;const p=game.state.players.find(p=>p.id===id);if(!p||p.isBot)return;if(game.audit.events.length>=30000){game.audit.overflow=true;return;}const clean=cleanMatchInput(input),old=(game.auditInputs||={})[id]||{};const delta={};for(const [key,value]of Object.entries(clean)){if(['action','pass','shootRelease','cancelShot','awaken','skipReplay'].includes(key)){if(value)delta[key]=true;}else if(['skill','qte'].includes(key))delta[key]=value;else if(JSON.stringify(value)!==JSON.stringify(old[key]))delta[key]=value;}game.auditInputs[id]={...old,...clean};if(Object.keys(delta).length)game.audit.events.push([game.audit.steps.length,id,delta]);}

export function recordStep(game,dt){if(!game.audit||game.replayingAudit)return;if(game.audit.steps.length>=60000){game.audit.overflow=true;return;}game.audit.steps.push(dt);}
