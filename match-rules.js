// Shared by the lobby, transport and authoritative simulation.
const standard=(size,online=true)=>({size,humans:online?size*2:1,variant:'standard',duration:300});
const raw=(size,online=true)=>({...standard(size,online),variant:'raw',duration:180});
export const MATCH_RULES=Object.freeze({
 'bot-standard':standard(1,false),'bot-2v2':standard(2,false),'bot-3v3':standard(3,false),
 'bot-raw-1v1':raw(1,false),'bot-raw-2v2':raw(2,false),'bot-raw-3v3':raw(3,false),
 'standard-1v1':standard(1),'standard-2v2':standard(2),'standard-3v3':standard(3),
 'raw-1v1':raw(1),'raw-2v2':raw(2),'raw-3v3':raw(3),
 'penalties-1v1':{size:1,humans:2,variant:'penalties',duration:300},
 'bot-penalty':{size:1,humans:1,variant:'penalty-practice',duration:300},
 'bot-team':{...standard(2),humans:2},custom:{size:3,humans:2,variant:'standard',duration:300},
});
export const ONLINE_FORMATS=Object.freeze(Object.keys(MATCH_RULES).filter(k=>!k.startsWith('bot-')&&k!=='custom'));
export const ROOM_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
export function validRoomCode(value){return typeof value==='string'&&value.length===4&&[...value].every(c=>ROOM_ALPHABET.includes(c))&&new Set(value).size===4;}
export function rulesFor(format,settings={}){const base=MATCH_RULES[format]||MATCH_RULES['standard-1v1'];return {...base,...(format==='custom'?{variant:settings.variant||'standard'}:{}),duration:base.variant==='raw'||settings.variant==='raw'?180:[120,180,300,600].includes(settings.duration)?settings.duration:base.duration};}
export function normalizeRoomConfig(value={}){
 const slots=value.slots===undefined?['human','human','bot','bot','empty','empty']:value.slots;
 if(!Array.isArray(slots)||![4,6].includes(slots.length)||slots[0]!=='human'||slots.some(k=>!['human','bot','empty'].includes(k))||!slots.some((kind,id)=>id%2===1&&kind!=='empty'))throw Error('Choose one to three players per team. The host stays on blue.');
 const variant=value.variant??'standard';if(!['standard','raw','penalties'].includes(variant))throw Error('Choose Standard, Raw Skill, or Penalties.');
 if(variant==='penalties'&&slots.some((k,id)=>id>=2&&k!=='empty'))throw Error('Penalties allows one player per team.');
 const duration=variant==='raw'?180:value.duration??300,scoreLimit=variant==='standard'?value.scoreLimit??0:0;
 if(![120,180,300,600].includes(duration)||![0,3,5,10].includes(scoreLimit))throw Error('Choose a supported match length and goal limit.');
 const botCharacters={};for(const [id,character]of Object.entries(value.botCharacters||{})){if(!/^\d$/.test(id)||slots[+id]!=='bot'||typeof character!=='string'||!/^[a-z0-9_-]{1,40}$/.test(character))throw Error('Choose a character for an active bot slot.');botCharacters[id]=character;}
 return {slots:[...slots],duration,scoreLimit,...(variant!=='standard'?{variant}:{}),...(Object.keys(botCharacters).length?{botCharacters}:{})};
}
export function humanSlots(format,config){if(format==='custom')return config.slots.flatMap((k,id)=>k==='human'?[id]:[]);if(format==='bot-team')return [0,2];return Array.from({length:MATCH_RULES[format]?.humans??2},(_,id)=>id);}
export function playerSlots(format,config){return format==='custom'?config.slots.flatMap((k,id)=>k!=='empty'?[id]:[]):Array.from({length:(MATCH_RULES[format]?.size??1)*2},(_,id)=>id);}
