import {createHash,randomInt,randomUUID} from 'node:crypto';
import {normaliseProgress,settleProgress,buySpin,toggleVariant,stageLeaderboard,parseAdminCommand,banUntil,banMinutes,STYLE_IDS} from '../progression.js';
import {selectedVariants} from '../progression.js';
import {ENGINE_VERSION} from '../match-audit.js';
import {replayMatch} from './game-replay.mjs';
import {rulesFor,MATCH_RULES} from '../match-rules.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const odds={normal:[['common',4400],['rare',3000],['epic',1500],['legendary',840],['world class',220],['master',40]],lucky:[['rare',3300],['epic',4500],['legendary',1300],['world class',700],['master',200]]};
const rarities={common:['manmarker','ice'],rare:['powershooter','ninja'],epic:['playmaker','falcon','serpent'],legendary:['streetdribbler','magician'], 'world class':['trapper','butterflydancer'],master:['supersonic','emperor']};
export function chooseSpin(type,random=randomInt){let roll=random(10000),rarity;for(const [r,n]of odds[type]){roll-=n;if(roll<0){rarity=r;break;}}const pool=rarities[rarity];return pool[random(pool.length)];}
const cleanStats=input=>{const r={};for(const key of ['goals','assists','steals','ankleBreaks','awakenings','passes','moves','interceptions','skillGoals','dribbleGoals','dribbles','fourthAwakeningUses']){const n=input?.[key]??0;if(!Number.isSafeInteger(n)||n<0||n>500)fail('Invalid match statistics.');r[key]=n;}const seconds=input?.movementSeconds??0;if(!Number.isFinite(seconds)||seconds<0||seconds>3600)fail('Invalid movement time.');r.movementSeconds=seconds;r.continuousMovement=input?.continuousMovement===true;return r;};
/** Repository transactions bind the actor to an existing, currently live opaque
 * session. No action accepts an account ID, role, wallet balance or unlock map. */
export function createGameService(store,{choose=chooseSpin}={}){
 async function run(tokenHash,action,input={}){return store.transaction(tokenHash,async tx=>{
  const actor=tx.actor,now=await tx.now();if(!actor)fail('Sign in to your Rematch account.',401);
  const ban=await tx.ban(actor),banned=ban?.active&&banMinutes(ban.until,now)!==-1;
  const admin=await tx.isAdmin(actor);
  if(banned&&!['status','appeal'].includes(action))fail('This account is banned.',403);
  let profile=normaliseProgress(await tx.profile(actor));
  if(action==='status')return {authenticated:true,profile,admin,banned:banned?{reason:ban.reason,minutes:banMinutes(ban.until,now),until:ban.until}:null};
  if(action==='leaderboard')return tx.leaderboard();
  if(!uuid(input.operationId))fail('Use a new operation ID.');
  const hash=digest({action,input}),previous=await tx.operation(input.operationId);
  if(previous){if(previous.actor!==actor||previous.digest!==hash)fail('Operation conflict.',409);return previous.result;}
  let result;
  if(action==='equip'){if(!profile.unlocked.includes(input.character))fail('Unlock this character first.');profile.equipped=input.character;await tx.saveProfile(actor,profile);result={profile};}
  else if(action==='variant'){if(typeof input.enabled!=='boolean')fail('Choose an enabled or disabled variant.');profile=toggleVariant(profile,input.character,input.slot,input.enabled);await tx.saveProfile(actor,profile);result={profile};}
  else if(action==='spin'){if(!['normal','lucky'].includes(input.type))fail('Choose a spin.');const purchase=buySpin(profile,input.type,()=>choose(input.type));await tx.saveProfile(actor,purchase.progress);result={profile:purchase.progress,id:purchase.id,duplicate:purchase.duplicate,cost:purchase.cost};}
  else if(action==='start'){
   if(input.engine!==ENGINE_VERSION)fail('Refresh Rematch Rush before starting another account match.',409);
   if(!uuid(input.matchId)||!Object.hasOwn(MATCH_RULES,input.format)||!profile.unlocked.includes(input.character))fail('Invalid match selection.');
   const rule=rulesFor(input.format,input.settings||{});if(!/^[a-f0-9]{32}$/.test(input.seed||'')||!Number.isInteger(input.localPlayerId)||!Array.isArray(input.players)||input.players.length<2||input.players.length>6)fail('A fixed match roster and seed are required.');
   const players=input.players.map(p=>{if(!p||typeof p!=='object'||!Number.isInteger(p.id)||p.id<0||p.id>5||p.team!==p.id%2||!STYLE_IDS.includes(p.character)||typeof p.isBot!=='boolean')fail('Invalid match roster.');return {id:p.id,team:p.team,character:p.character,isBot:p.isBot,name:String(p.name||'Player').slice(0,24),dlsi:{moves:Array.from({length:4},(_,i)=>p.dlsi?.moves?.[i]===true),awakening:p.dlsi?.awakening===true}};});const local=players.find(p=>p.id===input.localPlayerId),variants=selectedVariants(profile,input.character);if(new Set(players.map(p=>p.id)).size!==players.length||[0,1].some(t=>players.filter(p=>p.team===t).length<1||players.filter(p=>p.team===t).length>3)||!local||local.isBot||local.character!==(['raw','penalties','penalty-practice'].includes(rule.variant)?'none':input.character)||JSON.stringify(local.dlsi)!==JSON.stringify({moves:Array.from({length:4},(_,i)=>variants.moves[i]===true),awakening:variants.awakening}))fail('Your match character or variants do not match your account.');
   const auditPlan={engine:ENGINE_VERSION,format:input.format,seed:input.seed,players,localPlayerId:input.localPlayerId,settings:{duration:rule.duration,variant:rule.variant,scoreLimit:[3,5,10].includes(input.settings?.scoreLimit)?input.settings.scoreLimit:0}};await tx.saveProfile(actor,profile);await tx.abandonActive(actor);
   await tx.startMatch({id:input.matchId,actor,format:input.format,character:['raw','penalties','penalty-practice'].includes(rule.variant)?'none':input.character,settings:{duration:rule.duration,variant:rule.variant,auditPlan},startedAt:now,state:'active'});result={matchId:input.matchId};
  }else if(action==='finish'){
   const match=await tx.match(input.matchId);if(!match||match.actor!==actor)fail('This match does not belong to your account.',404);
   if(match.state!=='active')fail('This match has already ended.',409);
   const outcome=['finished','abandoned','opponent-left'].includes(input.outcome)?input.outcome:fail('Invalid outcome.');
   const replay=outcome==='abandoned'?{score:[0,0],stats:{},team:0}:replayMatch(match.settings.auditPlan,input.audit,{wallSeconds:Math.max(0,(now-match.startedAt)/1000),outcome});
   const {team,stats,score}=replay;
   const league=await tx.leaderboard(),settled=settleProgress(profile,{matchId:match.id,character:match.character,team,score,stats,format:match.format,abandoned:outcome==='abandoned',opponentAbandoned:outcome==='opponent-left',leagueOpen:league.started===true&&!league.ended});
   await tx.finishMatch(match.id,outcome,hash,{score,team,stats});await tx.saveProfile(actor,settled.progress);
   if(settled.points)await tx.points(actor,match.character,settled.points);result={profile:settled.progress,money:settled.money,points:settled.points};
  }else if(action==='appeal'){
   if(!banned)fail('There is no active ban to appeal.');const message=String(input.message||'').trim();if(!message||message.length>1000)fail('Enter an appeal of 1–1000 characters.');await tx.appeal({actor,banVersion:ban.version,message});result={ok:true};
  }else if(action==='admin'){
   if(!admin)fail('Administrator access required.',403);const command=parseAdminCommand(input.command),target=await tx.resolveAccount(command.username);if(!target)fail('Account not found or name is ambiguous.',404);
   const targetId=target.id,targetProfile=normaliseProgress(await tx.profile(targetId));
   if(['grant','revoke','check'].includes(command.command)){
    if(!STYLE_IDS.includes(command.character)||command.character==='none')fail('Choose a valid character ID.');const owns=targetProfile.unlocked.includes(command.character);
    if(command.command==='check')result={value:owns?1:0};else{if(command.command==='grant'&&!owns)targetProfile.unlocked.push(command.character);if(command.command==='revoke'){targetProfile.unlocked=targetProfile.unlocked.filter(x=>x!==command.character);if(targetProfile.equipped===command.character)targetProfile.equipped='none';}await tx.saveProfile(targetId,targetProfile);result={ok:true};}
   }else if(command.command==='query'){const b=await tx.ban(targetId);result={value:b?.active?banMinutes(b.until,now):-1};}
   else if(command.command==='ban'){if(targetId===actor)fail('Another administrator must handle a ban of your own account.');const reason=String(input.reason||'').trim();if(!reason||reason.length>400)fail('A ban reason is required (1–400 characters).');const b=await tx.ban(targetId),until=banUntil(b?.active&&banMinutes(b.until,now)!==-1?b.until:undefined,command.minutes,now);await tx.setBan({actor:targetId,version:randomUUID(),until,reason,createdBy:actor});result={ok:true};}
   else if(command.command==='unban'){await tx.unban(targetId);result={ok:true};}
   else if(command.command==='admin'){await tx.addAdmin(targetId,actor);result={ok:true};}
   else if(command.command==='unadmin'){if(await tx.isAdmin(targetId)&&await tx.adminCount()<=1)fail('Keep at least one administrator.');await tx.removeAdmin(targetId);result={ok:true};}
   await tx.audit({actor,target:targetId,action:command.command,details:command});
  }else if(action==='appeals'){
   if(!admin)fail('Administrator access required.',403);result={appeals:await tx.appeals()};
  }else if(action==='dismiss'){
   if(!admin)fail('Administrator access required.',403);if(!uuid(input.appealId))fail('Choose an appeal.');await tx.dismiss(input.appealId);await tx.audit({actor,action:'dismiss',details:{appealId:input.appealId}});result={ok:true};
  }else fail('Unknown game operation.',404);
  await tx.saveOperation({id:input.operationId,actor,kind:action,digest:hash,result});return result;
 });}
 return {run,leaderboard:()=>store.leaderboard()};
}
export {stageLeaderboard,STYLE_IDS};
