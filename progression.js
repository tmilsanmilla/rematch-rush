import {FLOW_ROSTER,FLOW_IDS,MATCH_XP} from './flow.js?v=2';
// Currency is earned only when a match settles; never on an abandoned local run.
export const SPIN_PRICES=Object.freeze({normal:35,lucky:95});
export const FLOW_SPIN_PRICES=Object.freeze({normal:26.25,lucky:71.25});
export function levelProgress(xp=0){xp=Math.max(0,Number.isSafeInteger(xp)?xp:0);const level=Math.floor((Math.sqrt(9+.08*xp)-1)/2),start=50*(level-1)*(level+2),required=100*(level+1);return{level,xp,earned:xp-start,required,next:start+required};}
const moneyValue=n=>Number.isFinite(n)?Math.round(Math.max(0,Math.min(100000000,n))*100)/100:0;
export const LEAGUE_LENGTH_MS=14*24*60*60*1000;
export const QUESTS=Object.freeze({
 manmarker:[['steals',25,'Steal the ball 25 times'],['interceptions',25,'Intercept 25 shots'],['moves',50,'Use moves 50 times']],
 powershooter:[['goals',30,'Score 30 goals'],['steals',30,'Steal the ball 30 times'],['skillGoals',25,'Score with moves 25 times']],
 playmaker:[['passes',55,'Complete 55 passes'],['assists',30,'Make 30 assists'],['goals',25,'Score 25 goals']],
 streetdribbler:[['ankleBreaks',100,'Beat a tackler 100 times'],['dribbleGoals',50,'Beat a tackler then score 50 times'],['dribbles',200,'Dribble 200 times']],
 supersonic:[['movementSeconds',1800,'Move for 30 cumulative minutes'],['steals',100,'Steal the ball 100 times'],['fourthAwakeningUses',10,'Use awakening move 4 ten times']],
});
// One quest may unlock multiple moves. Existing saved counters and variant slots
// keep their original meaning; the removed nonstop quest is no longer required.
export function moveQuests(character){const quests=QUESTS[character]||[];return character==='supersonic'?[quests[0],quests[0],quests[1],quests[2]]:quests;}
export const STYLE_IDS=Object.freeze(['none','manmarker','ice','powershooter','ninja','playmaker','falcon','streetdribbler','magician','trapper','serpent','butterflydancer','supersonic','emperor','malicia','raven']);
const safeMap=value=>Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([key,data])=>STYLE_IDS.includes(key)&&data&&typeof data==='object'&&!Array.isArray(data)));
const integer=(n,max=100000000)=>Number.isSafeInteger(n)?Math.max(0,Math.min(max,n)):0;
const copy=x=>JSON.parse(JSON.stringify(x));
export const AVATAR_COLORS=Object.freeze(['#777777','#245b46','#2e5195','#783b86','#ad4930','#94691e']);
export const AVATAR_FONTS=Object.freeze(['pixel','sans','serif','mono']);
export function accountSettings(value={}){return {name:typeof value.name==='string'&&value.name.trim()?value.name.trim().replace(/[<>\x00-\x1f]/g,'').slice(0,18)||'Player':'Player',sound:value.sound!==false,reducedMotion:value.reducedMotion===true,avatarColor:AVATAR_COLORS.includes(value.avatarColor)?value.avatarColor:AVATAR_COLORS[0],avatarFont:AVATAR_FONTS.includes(value.avatarFont)?value.avatarFont:'pixel'};}
export function normaliseProgress(value={}){return {settings:accountSettings(value.settings),money:moneyValue(value.money),xp:integer(value.xp,1000000000),flow:FLOW_IDS.includes(value.flow)?value.flow:'none',flows:[...new Set(['none',...(Array.isArray(value.flows)?value.flows.filter(id=>FLOW_IDS.includes(id)):[])])],equipped:STYLE_IDS.includes(value.equipped)?value.equipped:'none',unlocked:[...new Set(['none',...(Array.isArray(value.unlocked)?value.unlocked.filter(x=>STYLE_IDS.includes(x)):[])])],characters:value.characters&&typeof value.characters==='object'&&!Array.isArray(value.characters)?copy(safeMap(value.characters)):{},dlsi:value.dlsi&&typeof value.dlsi==='object'?copy(safeMap(value.dlsi)):{},settled:Array.isArray(value.settled)?value.settled.filter(x=>typeof x==='string').slice(-256):[]};}
export function resultBonus(home,away){const diff=Math.abs(home-away);if(!diff)return 22;if(home>away)return diff>=6?42:25+3*diff;return diff>=6?2:19-3*diff;}
export function statMoney(stats={}){return integer(stats.ankleBreaks,500)+integer(stats.awakenings,100)+2*integer(stats.steals,500)+5*integer(stats.assists,100)+10*integer(stats.goals,100);}
export function matchReward({score=[0,0],team=0,stats={},abandoned=false,opponentAbandoned=false,practice=false}){if(abandoned)return 0;return statMoney(stats)+(opponentAbandoned||practice?0:resultBonus(integer(score[team],100),integer(score[1-team],100)));}
export function leagueScore(stats={},complete=true){return 10*integer(stats.goals,100)+5*integer(stats.assists,100)+3*integer(stats.steals,500)+integer(stats.ankleBreaks,500)+integer(stats.awakenings,100)+(complete?5:0);}
export function variantUnlocks(progress,character){const data=progress.characters?.[character]||{},quests=moveQuests(character);return {moves:quests.map(([key,target])=>(data[key]||0)>=target),awakening:(data.points||0)>=300};}
export function selectedVariants(progress,character){const unlocked=variantUnlocks(progress,character),selected=progress.dlsi?.[character]||{};return {moves:unlocked.moves.map((yes,i)=>yes&&selected.moves?.[i]===true),awakening:unlocked.awakening&&selected.awakening===true};}
export function toggleVariant(progress,character,slot,value){const next=normaliseProgress(progress),unlocks=variantUnlocks(next,character);next.dlsi[character]||={moves:[],awakening:false};if(slot==='awakening'){if(!unlocks.awakening)throw Error('Earn 300 league points first.');next.dlsi[character].awakening=!!value;}else{if(!Number.isInteger(slot)||!unlocks.moves[slot])throw Error('Complete this move’s quest first.');next.dlsi[character].moves[slot]=!!value;}return next;}
export function settleProgress(progress,{matchId,character,team=0,score,stats={},isBot=false,format='',abandoned=false,opponentAbandoned=false,leagueOpen=true}){
 const next=normaliseProgress(progress);if(typeof matchId!=='string'||!matchId||next.settled.includes(matchId)||abandoned)return {progress:next,money:0,points:0,xp:0,duplicate:next.settled.includes(matchId)};
 const practice=format==='bot-penalty',penalty=practice||format==='penalties-1v1';
 const xp=isBot?0:Math.floor(Math.max(0,Math.min(MATCH_XP.max,Number(stats.xp)||0))+1e-6);next.xp=Math.min(1000000000,next.xp+xp);
 const money=matchReward({team,score,stats,opponentAbandoned,practice}),points=isBot||penalty||character==='none'||!leagueOpen?0:leagueScore(stats,!opponentAbandoned);
 next.money=Math.min(100000000,next.money+money);next.settled.push(matchId);next.settled=next.settled.slice(-256);
 if(!isBot&&character!=='none'&&!penalty){
  const current=next.characters[character]||{points:0};current.points=(current.points||0)+points;
  for(const key of ['goals','assists','steals','ankleBreaks','awakenings','passes','moves','interceptions','skillGoals','dribbleGoals','dribbles','fourthAwakeningUses'])current[key]=(current[key]||0)+integer(stats[key],500);
  current.movementSeconds=(current.movementSeconds||0)+Math.max(0,Math.min(3600,Number(stats.movementSeconds)||0));
  if(stats.continuousMovement===true&&!opponentAbandoned)current.continuousGames=(current.continuousGames||0)+1;
  next.characters[character]=current;
 }
 return {progress:next,money,points,xp,duplicate:false};
}
export function buySpin(progress,type,choose){const next=normaliseProgress(progress),price=SPIN_PRICES[type];if(!price)throw Error('Choose a normal or lucky spin.');if(type==='lucky'&&levelProgress(next.xp).level<15)throw Error('Reach level 15 for Lucky Spins.');if(next.money<price)throw Error(`You need $${price} for this spin.`);const id=choose(type==='lucky');if(typeof id!=='string'||!STYLE_IDS.includes(id)||id==='none')throw Error('Spin could not complete.');next.money-=price;const duplicate=next.unlocked.includes(id);if(!duplicate)next.unlocked.push(id);return {progress:next,id,duplicate,cost:price};}
export function stageLeaderboard(styles,totals,startsAt,now=Date.now()){const start=Date.parse(startsAt);if(!Number.isFinite(start))throw Error('League start is unavailable.');const ended=now>=start+LEAGUE_LENGTH_MS;const rows=styles.filter(id=>id!=='none').map(id=>({id,points:integer(totals?.[id])})).sort((a,b)=>b.points-a.points||a.id.localeCompare(b.id));const eliminated=ended?new Set([...rows].sort((a,b)=>a.points-b.points||a.id.localeCompare(b.id)).slice(0,5).map(r=>r.id)):new Set();return {started:now>=start,startsAt:new Date(start).toISOString(),endsAt:new Date(start+LEAGUE_LENGTH_MS).toISOString(),ended,rows:rows.map((r,i)=>({...r,rank:i+1,eliminated:eliminated.has(r.id)}))};}
export function parseAdminCommand(text){if(typeof text!=='string'||text.length>500)throw Error('Enter a supported command.');const words=text.trim().split(/\s+/),command=words.shift()?.toLowerCase();if(['/ban','/unban','/query','/grant','/revoke','/check','/admin','/unadmin'].includes(command)===false)throw Error('Unknown admin command.');if(command==='/ban'){const minutes=Number(words.shift());if(!Number.isSafeInteger(minutes)||minutes<0||minutes>5256000)throw Error('Ban minutes must be 0 (infinite) or a positive integer.');const username=words.join(' ');if(!username)throw Error('Choose an account.');return {command:'ban',minutes,username};}if(['/grant','/revoke','/check'].includes(command)){if(words.length<2)throw Error('Use /command character account.');let character=words.shift().toLowerCase();if(character==='street'&&words[0]?.toLowerCase()==='dribbler'||character==='butterfly'&&words[0]?.toLowerCase()==='dancer')character+=words.shift().toLowerCase();if(!words.length)throw Error('Choose an account.');return {command:command.slice(1),character,username:words.join(' ')};}if(!words.length)throw Error('Choose an account.');return {command:command.slice(1),username:words.join(' ')};}
export function banUntil(existing,minutes,now=Date.now()){if(!Number.isSafeInteger(minutes)||minutes<0)throw Error('Invalid ban duration.');if(minutes===0||existing===null)return null;return new Date(Math.max(now,Date.parse(existing)||0)+minutes*60000).toISOString();}
export function banMinutes(until,now=Date.now()){if(until===null)return 0;const left=Date.parse(until)-now;return Number.isFinite(left)&&left>0?Math.ceil(left/60000):-1;}

export function chooseFlow(type,random=Math.random){const odds=type==='lucky'?[['rare',3290],['epic',4500],['legendary',1300],['world class',700],['master',200],['undisputed',10]]:[['common',4399],['rare',3000],['epic',1500],['legendary',840],['world class',220],['master',40],['undisputed',1]];let roll=Math.min(.999999999,Math.max(0,random()))*10000,rarity='common';for(const[r,w]of odds){if((roll-=w)<0){rarity=r;break;}}const pool=FLOW_ROSTER.filter(f=>f.rarity===rarity);return pool[Math.min(pool.length-1,Math.floor(Math.max(0,random())*pool.length))].id;}
export function buyFlowSpin(progress,type,choose){const next=normaliseProgress(progress),price=FLOW_SPIN_PRICES[type];if(!price)throw Error('Choose a normal or lucky Flow spin.');if(type==='lucky'&&levelProgress(next.xp).level<15)throw Error('Reach level 15 for Lucky Spins.');if(next.money<price)throw Error(`You need $${price} for this Flow spin.`);const id=choose(type);if(!FLOW_IDS.includes(id)||id==='none')throw Error('Flow spin could not complete.');next.money=moneyValue(next.money-price);const duplicate=next.flows.includes(id);if(!duplicate)next.flows.push(id);return{progress:next,id,duplicate,cost:price};}
export function equipFlow(progress,id){const next=normaliseProgress(progress);if(!FLOW_IDS.includes(id)||!next.flows.includes(id))throw Error('Unlock this Flow first.');next.flow=id;return next;}

// Store whole dollars in the existing bigint wallet; keep exact cents in its
// existing JSON progress. No schema, role or account migration is needed.
export function splitGameMoney(value){const cents=Math.round(moneyValue(value)*100);return{whole:Math.floor(cents/100),cents:cents%100};}
export function joinGameMoney(whole,cents){return moneyValue(Number(whole)+(Number.isInteger(cents)&&cents>=0&&cents<100?cents:0)/100);}
