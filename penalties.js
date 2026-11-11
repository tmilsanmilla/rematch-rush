import {SHOT_CHARGE} from './match-rules.js?v=2';
import {MATCH_XP,addExperience} from './flow.js?v=2';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const random=g=>g.options.botRandom||Math.random;
export function initPenalties(g){
 if(!['penalties','penalty-practice'].includes(g.rules.variant))return false;
 const s=g.state;s.penalty={practice:g.rules.variant==='penalty-practice',attempts:[0,0],scores:[0,0],turnTeam:g.rules.variant==='penalty-practice'?g.localTeam:0,phase:'setup',left:.8,max:g.rules.variant==='penalty-practice'?10:5};
 s.kickoff=null;s.keepers=[];s.players.forEach(p=>{p.character='none';p.dlsi=null;p.awakened=false;p.awakeningCharge=0;});prepareAttempt(g);return true;
}
function prepareAttempt(g){
 const s=g.state,p=s.penalty,shooter=s.players.find(q=>q.team===p.turnTeam),defender=s.players.find(q=>q.team!==p.turnTeam);if(!shooter||!defender)return;
 p.phase='setup';p.left=.8;p.shotAge=0;p.shooterId=shooter.id;p.defenderId=defender.id;p.pendingPower=null;
 for(const q of s.players){q.hidden=q.id!==shooter.id;q.charging=false;q.charge=0;q.stun=0;q.recovery=0;q.motion=null;g.pending[q.id]=[];g.inputs[q.id].shootHeld=false;}
 Object.assign(shooter,{x:p.turnTeam?250:950,y:350,angle:p.turnTeam?Math.PI:0,aim:{x:p.turnTeam?70:1130,y:350}});
 const keeper={id:`pk${defender.team}`,team:defender.team,x:defender.team?1102:98,y:350,holding:0,dive:0,diveCd:0,saveStreak:0,controlledBy:defender.isBot?null:defender.id};s.keepers=[keeper];p.keeperId=keeper.id;
 Object.assign(s.ball,{owner:null,x:shooter.x,y:shooter.y,z:0,vx:0,vy:0,vz:0,finish:null,perfectPass:null,scriptedGoal:null,scriptedReturn:false,distribution:null,cannotScore:false,curve:0,knuckle:false,pass:null,lastKickAgo:99});g.setOwner(shooter);shooter.shotReadyAt=g.actionClock+.15;p.botAim=null;
 s.message=`${p.practice?'Practice':`Team ${p.turnTeam?'Red':'Blue'}`} penalty ${p.attempts[p.turnTeam]+1}/${p.max} · aim and shoot`;
}
export function resolvePenalty(g,scored){
 const s=g.state,p=s.penalty;if(!p||p.phase!=='shot')return false;
 p.phase='result';p.left=1.25;p.attempts[p.turnTeam]++;if(scored){g.creditOnTarget(1-p.turnTeam,true);p.scores[p.turnTeam]++;const shooter=s.players.find(q=>q.id===p.shooterId);shooter.stats.goals++;addExperience(shooter,MATCH_XP.goal);g.options.onEvent?.({type:'goal',team:p.turnTeam,playerId:shooter.id,penalty:true});}
 s.score=[...p.scores];s.message=scored?'PENALTY SCORED':'PENALTY SAVED / MISSED';Object.assign(s.ball,{vx:0,vy:0,vz:0,z:0,owner:null,finish:null});return true;
}
function nextAttempt(g){const p=g.state.penalty;if(p.practice){if(p.attempts[p.turnTeam]>=p.max){g.state.practiceResult=true;g.endMatch();return;}}else{if(p.attempts[0]>=p.max&&p.attempts[1]>=p.max){if(p.scores[0]===p.scores[1]){startTiebreak(g);return;}g.state.winnerTeam=p.scores[0]>p.scores[1]?0:1;g.endMatch();return;}if(p.attempts[p.turnTeam]>=p.max)p.turnTeam=1-p.turnTeam;}prepareAttempt(g);}
function charge(g,p,dt,held){if(held){if(!p.charging){p.charging=true;p.charge=5;p.maxHold=0;}p.charge=Math.min(100,p.charge+(g.shotChargePerSecond??SHOT_CHARGE.perSecond)*dt);if(p.charge>=100)p.maxHold=(p.maxHold||0)+dt;}return p.charge||5;}
export function updatePenalties(g,dt){
 const s=g.state,p=s.penalty;if(!p||s.phase==='ended')return false;s.elapsed+=dt;
 if(p.phase==='tiebreak'){updateTiebreak(g,dt);return true;}
 const shooter=s.players.find(q=>q.id===p.shooterId),defender=s.players.find(q=>q.id===p.defenderId),keeper=s.keepers[0];
 if(p.phase==='setup'){p.left-=dt;if(p.left<=0)p.phase='ready';}
 if(p.phase==='result'){p.left-=dt;if(p.left<=0)nextAttempt(g);return true;}
 if(keeper){
  if(keeper.controlledBy!=null){const keys=g.inputs[keeper.controlledBy]?.keys||{};keeper.x=keeper.team?1102:98;keeper.y=clamp(keeper.y+((keys.s?1:0)-(keys.w?1:0))*194*g.motionSeconds(dt),260,440);keeper.dive=0;}
  else g.updateKeepers(dt);
 }
 const input=g.inputs[shooter.id]||{},held=input.shootHeld;
 shooter.aim=input.aim||shooter.aim;
 if(shooter.isBot&&p.phase==='ready'){
  p.botAim??={x:shooter.team?70:1130,y:280+random(g)()*140};shooter.aim=p.botAim;charge(g,shooter,dt,true);
  if(shooter.charge>=18+(p.turnTeam*3))p.pendingPower=shooter.charge;
 }else if(p.phase==='ready')charge(g,shooter,dt,held);
 if(shooter.maxHold>=.25&&p.phase==='ready')p.pendingPower=100;
 for(const [action]of g.pending[shooter.id]||[])if(action==='shoot'&&p.phase==='ready')p.pendingPower=shooter.charge||5;
 for(const q of s.players)g.pending[q.id]=[];
 if(p.phase==='ready'&&p.pendingPower!=null&&g.shotReady(shooter)){
  const power=p.pendingPower;p.pendingPower=null;p.botAim=null;p.phase='shot';p.shotAge=0;g.kick(shooter,power,{manual:true,accuracy:1,air:power>=100,ultraShot:!!input.ultraShot});
 }
 if(p.phase==='shot'){
  p.shotAge+=dt;s.ball.lastKickAgo+=dt;g.updateBall(dt);
  if(p.phase==='shot'&&(s.ball.owner===p.keeperId||p.shotAge>3||s.ball.vx*(p.turnTeam?-1:1)<0))resolvePenalty(g,false);
 }
 g.recordHistory();return true;
}
function startTiebreak(g){
 const s=g.state,p=s.penalty;p.phase='tiebreak';p.balls=[[600,350],[500,260],[700,260],[500,440],[700,440]].map(([x,y],i)=>({id:i,x,y,vx:0,vy:0,z:0,owner:null,delay:0}));
 s.keepers=[];s.players.forEach(q=>{q.hidden=false;q.x=q.team?800:400;q.y=350;q.charge=0;q.charging=false;g.inputs[q.id].shootHeld=false;});s.message='SUDDEN DEATH · moving balls eliminate · hold to charge, release a stopped ball';
}
function updateTiebreak(g,dt){
 const s=g.state,p=s.penalty,step=g.motionSeconds(dt);
 for(const q of s.players){const input=g.inputs[q.id]||{},keys=input.keys||{},own=p.balls.find(b=>b.owner===q.id);if(q.isBot){const rival=s.players.find(r=>r.team!==q.team),danger=p.balls.filter(b=>b.owner==null&&Math.hypot(b.vx,b.vy)>.1).sort((a,b)=>Math.hypot(a.x-q.x,a.y-q.y)-Math.hypot(b.x-q.x,b.y-q.y))[0],target=p.balls.filter(b=>b.owner==null&&Math.hypot(b.vx,b.vy)<=.1).sort((a,b)=>Math.hypot(a.x-q.x,a.y-q.y)-Math.hypot(b.x-q.x,b.y-q.y))[0];let dx=0,dy=0;if(danger&&Math.hypot(danger.x-q.x,danger.y-q.y)<150){dx=q.x-danger.x;dy=q.y-danger.y;}else if(target){dx=target.x-q.x;dy=target.y-q.y;}Object.assign(keys,{a:dx<-8,d:dx>8,w:dy<-8,s:dy>8});input.aim=rival?{x:rival.x,y:rival.y}:q.aim;input.shootHeld=!!own;if(own&&q.charge>28){g.pending[q.id].push(['shoot']);input.shootHeld=false;}}q.aim=input.aim||q.aim;charge(g,q,dt,input.shootHeld);
  const requested=(g.pending[q.id]||[]).some(([a])=>a==='shoot')||q.maxHold>=.25;if(requested&&own&&g.actionClock<(q.shotReadyAt||0))q.tiebreakRelease=q.charge||5;const release=requested||q.tiebreakRelease!=null&&g.actionClock>=q.shotReadyAt;g.pending[q.id]=[];
  if(!own){const dx=(keys.d?1:0)-(keys.a?1:0),dy=(keys.s?1:0)-(keys.w?1:0),n=Math.hypot(dx,dy)||1;q.x=clamp(q.x+dx/n*194*step,316,884);q.y=clamp(q.y+dy/n*194*step,196,504);q.angle=Math.atan2(dy,dx);}
  if(own){own.x=q.x;own.y=q.y;if(release&&g.actionClock>=(q.shotReadyAt||0)){const a=Math.atan2(q.aim.y-q.y,q.aim.x-q.x),speed=540+(q.tiebreakRelease??q.charge??5)*15.3;Object.assign(own,{owner:null,x:q.x+Math.cos(a)*27,y:q.y+Math.sin(a)*27,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,delay:0});q.tiebreakRelease=null;q.charge=0;q.charging=false;q.maxHold=0;g.inputs[q.id].shootHeld=false;}}
 }
 for(const b of p.balls){if(b.owner!=null)continue;b.delay=Math.max(0,b.delay-dt);const parts=Math.max(1,Math.ceil(Math.hypot(b.vx,b.vy)*step/10));for(let i=0;i<parts;i++){b.x+=b.vx*step/parts;b.y+=b.vy*step/parts;if(b.x<308||b.x>892){b.x=clamp(b.x,308,892);b.vx*=-.85;}if(b.y<188||b.y>512){b.y=clamp(b.y,188,512);b.vy*=-.85;}if(b.delay<=0)for(const q of s.players){if(Math.hypot(q.x-b.x,q.y-b.y)>=23)continue;if(Math.hypot(b.vx,b.vy)>.1){s.winnerTeam=1-q.team;s.message=`${q.name} was hit · team ${s.winnerTeam?'Red':'Blue'} wins`;g.endMatch();return;}b.owner=q.id;b.vx=b.vy=0;q.shotReadyAt=g.actionClock+.15;break;}}
  const friction=Math.exp(-.65*step);b.vx*=friction;b.vy*=friction;if(Math.hypot(b.vx,b.vy)<7)b.vx=b.vy=0;
 }
 s.ball=p.balls.find(b=>b.owner===g.localPlayerId)||p.balls[0];
}
export function drawTiebreakPitch(g,c){c.save();c.fillStyle='#19372d';c.fillRect(0,0,1200,700);c.fillStyle='#83b984';c.fillRect(300,180,600,340);c.strokeStyle='#f8fbec';c.lineWidth=3;c.strokeRect(300,180,600,340);c.font='700 18px Arial';c.textAlign='center';c.fillStyle='#f8fbec';c.fillText('FIVE-BALL SUDDEN DEATH',600,155);c.restore();}
