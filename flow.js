const F=(id,name,rarity,description,aura,color)=>({id,name,rarity,description,aura,color});
export const FLOW_ROSTER=Object.freeze([
 F('defensive-awareness','Defensive Awareness','common','Near an opposing carrier: +20% speed and 15% shorter tackle cooldown. Manmarker: 20% shorter ankle-break stuns.','target','#ffe45e'),
 F('freezing-over','Freezing Over','common','Blue passes travel 40% faster. Ice: they curve toward the moving receiver and remain interceptable.','snow','#8ceaff'),
 F('prayer-to-sky','Prayer to Sky','common','Cannot dribble; stuns last 75% less. Malicia: 20% chance to ignore a stun.','halo','#fff1a1'),
 F('leftleg-power','Leftleg Power','rare','+20 shot power, or +35 with Powershooter.','lightning','#ff923d'),
 F('shuriken-bombardment','Shuriken Bombardment','rare','50% transparent, or 80% with Ninja. No revealing aura.','none','#75ff98'),
 F('take-flight','Take Flight','rare','+15% speed, or +25% with Raven.','crow','#a57aff'),
 F('pre-coded','Pre-Coded','epic','Auto-aim passes and +20% speed. Playmaker: gyro shots are 30% harder to save.','binary','#5eabff'),
 F('the-leap','The Leap','epic','Trap a nearby ball at low airtime. Falcon: the trap gives +30% speed for 5s.','falcon','#d3dde7'),
 F('clearance-play','Clearance Play','epic','30% shorter tackle cooldown and 50% shorter ankle-break stuns. Serpent: 50% and 75%.','snake','#75ff98'),
 F('street-breakdown','Street Breakdown','legendary','One extra dribble. Street Dribbler: dribbles also last 0.25s longer.','fire','#ed86ff'),
 F('magic-cast','Magic Cast','legendary','Auto-aim pink passes travel 75% faster. Magician: ordinary contact cannot intercept them; moves still can.','hat','#ff84cf'),
 F('first-touch','First Touch','world class','Trapper’s receipt passive: +100% speed and +20 power for 2.5s. Stacks with Trapper.','skill','#5eabff'),
 F('weavethrough','Weavethrough','world class','Butterfly rhythm and one extra dribble. Stacks with Butterfly Dancer.','butterfly','#ffe45e'),
 F('fastest-ever','Fastest Ever','master','+100% speed. Supersonic: one extra dribble.','crimson','#ff4165'),
 F('bow-down','Bow Down','master','+50 shot power. Emperor: press Q off-ball to command a teammate’s pass.','crown','#ffe45e'),
 F('elitist-manmark','Elitist Manmark','undisputed','Cannot be stunned near an opposing carrier. DLSI Manmarker: +30 shot power.','royal-target','#ffe45e'),
 F('elitist-shot','Elitist Shot','undisputed','+65 shot power. DLSI Powershooter: moves recharge 30% faster.','great-lightning','#ff923d'),
 F('elitist-awareness','Elitist Awareness','undisputed','Auto-aim blue passes travel 150% faster; +50% speed, 25% shorter stuns. DLSI Playmaker: passes cannot be intercepted, even by moves.','great-binary','#5eabff'),
 F('elitist-dribbling','Elitist Dribbling','undisputed','Three extra dribbles. DLSI Street Dribbler: four extra.','great-fire','#d891ff'),
 F('elitist-speed','Elitist Speed','undisputed','+150% speed. DLSI Supersonic: velocity stays full while active.','great-crimson','#ff4165'),
]);
export const FLOW_IDS=Object.freeze(['none',...FLOW_ROSTER.map(f=>f.id)]);
export const flowOf=id=>FLOW_ROSTER.find(f=>f.id===id);
export const activeFlow=p=>p?.flowLeft>0?p.flow:'none';
const dlsi=p=>!!(p.dlsi?.awakening||p.dlsi?.moves?.some(Boolean));
export function addFlow(p,amount){if(!p)return;p.flowMeter=Math.max(0,Math.min(100,(p.flowMeter||0)+amount));}
const NEUTRAL=Object.freeze({speed:1,power:0,tackle:1,stun:1,ankle:1,extra:0,dribbleTime:0,passSpeed:1,opacity:1,moveCooldown:1});
export function flowModifiers(g,p){const id=activeFlow(p);if(id==='none')return NEUTRAL;const near=(id==='defensive-awareness'||id==='elitist-manmark')&&g.state.players.some(q=>q.team!==p.team&&g.hasBall(q)&&g.distance(p,q)<=g.width/8),dl=dlsi(p),m={...NEUTRAL};
 switch(id){
 case'defensive-awareness':if(near){m.speed=1.2;m.tackle=.85;}if(p.character==='manmarker')m.ankle=.8;break;
 case'freezing-over':m.passSpeed=1.4;m.passColor='#8ceaff';m.curvedPass=p.character==='ice';break;
 case'prayer-to-sky':m.noDribble=true;m.stun=.25;m.ignoreStun=p.character==='malicia';break;
 case'leftleg-power':m.power=p.character==='powershooter'?35:20;break;
 case'shuriken-bombardment':m.opacity=p.character==='ninja'?.2:.5;break;
 case'take-flight':m.speed=p.character==='raven'?1.25:1.15;break;
 case'pre-coded':m.speed=1.2;m.autoPass=true;m.gyroShot=p.character==='playmaker';break;
 case'the-leap':m.trap=true;if(p.flowTrapBoost>0)m.speed=1.3;break;
 case'clearance-play':m.tackle=p.character==='serpent'?.5:.7;m.ankle=p.character==='serpent'?.25:.5;break;
 case'street-breakdown':m.extra=1;if(p.character==='streetdribbler')m.dribbleTime=.25;break;
 case'magic-cast':m.autoPass=true;m.passSpeed=1.75;m.passColor='#ff84cf';m.contactProtected=p.character==='magician';break;
 case'first-touch':if(g.state.elapsed-(p.receivedAt??-99)<2.5){m.speed=2;m.power=20;}break;
 case'weavethrough':m.extra=1;m.dribbleTime=.5;m.dribbleCooldownBonus=.5;if(p.flowAnkleBoost>0){m.speed=1.2;m.power=10;}break;
 case'fastest-ever':m.speed=2;if(p.character==='supersonic')m.extra=1;break;
 case'bow-down':m.power=50;m.commandPass=p.character==='emperor';break;
 case'elitist-manmark':m.noStun=near;if(p.character==='manmarker'&&dl)m.power=30;break;
 case'elitist-shot':m.power=65;if(p.character==='powershooter'&&dl)m.moveCooldown=.7;break;
 case'elitist-awareness':m.speed=1.5;m.stun=.75;m.autoPass=true;m.passSpeed=2.5;m.passColor='#5eabff';m.absoluteProtected=p.character==='playmaker'&&dl;break;
 case'elitist-dribbling':m.extra=p.character==='streetdribbler'&&dl?4:3;break;
 case'elitist-speed':m.speed=2.5;m.fullVelocity=p.character==='supersonic'&&dl;break;
 }return m;
}
export function activateFlow(g,p){if(!flowOf(p.flow))return g.notify?.('Equip a Flow in the Flows tab first.'),false;if(p.flowLeft>0)return false;if((p.flowMeter||0)<20)return g.notify?.('Flow needs at least 20%.'),false;if(g.state.phase!=='play'||p.stun>0)return false;p.flowLeft=p.flowMeter/2;p.flowDuration=p.flowLeft;p.flowMeter=0;p.flowDribbles=flowModifiers(g,p).extra;if(p.character==='streetdribbler'&&dlsi(p)&&Number.isFinite(p.ability?.dlDribbles))p.ability.dlDribbles+=p.flowDribbles;g.notify?.(`${p.name} · ${flowOf(p.flow).name.toUpperCase()}!`);tickFlow(g,p,0);return true;}
export function tickFlow(g,p,dt){p.flowLeft=Math.max(0,(p.flowLeft||0)-dt);p.flowTrapBoost=Math.max(0,(p.flowTrapBoost||0)-dt);p.flowAnkleBoost=Math.max(0,(p.flowAnkleBoost||0)-dt);p.flowMods=flowModifiers(g,p);if(!p.flowLeft)p.flowDribbles=0;else if(p.flowComboCooling&&p.dribbleCd<=0){p.flowDribbles=p.flowMods.extra;p.flowComboCooling=false;}const b=g.state.ball;if(p.flowMods.trap&&b.owner==null&&b.z>0&&b.z<=45&&g.distance(p,b)<45&&!b.scriptedGoal&&!b.magnusFlight&&!b.unstoppableAir){if(g.setOwner(p)!==false&&p.character==='falcon')p.flowTrapBoost=5;}if(p.flowMods.fullVelocity){p.ability||={};p.ability.velocity=100;}}
export function flowStunScale(p){const m=p.flowMods||{};if(m.noStun||m.ignoreStun&&p.flowRandom?.()<.2)return 0;return m.stun??1;}
export function flowPass(g,p){return flowModifiers(g,p);}
// Match records are bounded to 1,800s and 500 of each scored statistic.
export const MATCH_XP=Object.freeze({perSecond:1,goal:100,assist:50,max:1800+500*100+500*50});
export function addExperience(p,amount){if(!p?.stats||!Number.isFinite(amount)||amount<=0)return;p.stats.xp=Math.min(MATCH_XP.max,Math.max(0,Number.isFinite(p.stats.xp)?p.stats.xp:0)+amount);}
export function tickExperience(g,dt){if(g.state.phase!=='play'||!Number.isFinite(dt)||dt<=0||['setup','result'].includes(g.state.penalty?.phase))return;for(const p of g.state.players)addExperience(p,MATCH_XP.perSecond*dt);}
export function drawFlow(g,c,p){if(!(p.flowLeft>0))return;const f=flowOf(activeFlow(p));if(!f||f.aura==='none')return;c.save();c.translate(p.x,p.y);c.strokeStyle=f.color;c.fillStyle=f.color;c.lineWidth=f.rarity==='undisputed'?3:2;const t=g.state.elapsed||0,r=f.rarity==='undisputed'?40:29;
 if(f.aura.includes('target')){for(const radius of[r,r*.6]){c.beginPath();c.arc(0,0,radius,0,Math.PI*2);c.stroke();}c.beginPath();c.moveTo(-r-8,0);c.lineTo(r+8,0);c.moveTo(0,-r-8);c.lineTo(0,r+8);c.stroke();if(f.aura==='royal-target'){for(let i=0;i<8;i++){const t=i*Math.PI/4;c.save();c.rotate(t);c.fillRect(r+4,-3,7,7);c.restore();}}}
 else if(f.aura.includes('lightning')||f.aura.includes('crimson')||f.aura.includes('fire')){for(let i=0;i<5;i++){const x=-r+i*r/2;if(f.aura.includes('fire'))c.strokeStyle=i%2?'#ff923d':'#c17aff';c.beginPath();c.moveTo(x,25);c.lineTo(x+Math.sin(t*12+i)*12,-8);c.lineTo(x-5,-15);c.lineTo(x+9,-r-15);c.stroke();}}
 else if(f.aura.includes('binary')){c.font=f.rarity==='undisputed'?'bold 14px monospace':'11px monospace';for(let i=0;i<6;i++)c.fillText(i%2?'010':'101',Math.cos(t+i)*r-12,Math.sin(t+i)*r);}
 else if(f.aura==='halo'){c.beginPath();c.ellipse(0,-37,20,6,0,0,Math.PI*2);c.stroke();}
 else if(f.aura==='crown'){c.beginPath();c.moveTo(-22,-27);c.lineTo(-26,-45);c.lineTo(-11,-37);c.lineTo(0,-54);c.lineTo(11,-37);c.lineTo(26,-45);c.lineTo(22,-27);c.closePath();c.stroke();}
 else if(f.aura==='snow'){for(let i=0;i<6;i++){c.rotate(Math.PI/3);c.beginPath();c.moveTo(0,0);c.lineTo(0,-r);c.moveTo(0,-r*.55);c.lineTo(-8,-r*.8);c.moveTo(0,-r*.55);c.lineTo(8,-r*.8);c.stroke();}}
 else if(f.aura==='butterfly'){c.globalAlpha=.4;for(const side of[-1,1]){c.beginPath();c.ellipse(side*28,-12,22,30,side*.5,0,Math.PI*2);c.fill();c.beginPath();c.ellipse(side*25,18,17,22,-side*.5,0,Math.PI*2);c.fill();}}
 else if(['crow','falcon'].includes(f.aura)){for(const sign of[-1,1]){c.save();c.scale(sign,1);c.beginPath();c.moveTo(6,-7);c.quadraticCurveTo(40,-55,55,-22);c.lineTo(27,10);c.lineTo(8,15);c.globalAlpha=.45;c.fill();c.restore();}}
 else if(f.aura==='hat'){c.beginPath();c.moveTo(-22,-29);c.lineTo(0,-65);c.lineTo(17,-29);c.closePath();c.fill();c.fillRect(-29,-31,57,5);}
 else if(f.aura==='snake'){c.beginPath();for(let i=0;i<24;i++){const a=i/23*Math.PI*2;const x=Math.cos(a)*r,y=Math.sin(a)*r*.45;i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();c.fillRect(r-4,-5,11,8);}
 else{c.font='bold 21px Arial';c.fillText('✦',-10,-32);}c.restore();}

export function remainingMoveSeconds(p,raw){const rate=p.flowMods?.moveCooldown||1;if(rate===1||!p.flowLeft)return raw;const boosted=Math.min(raw,p.flowLeft/rate);return boosted*rate+Math.max(0,raw-boosted);}
