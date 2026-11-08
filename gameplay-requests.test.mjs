import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from './game.js';
const advance=(g,seconds)=>{for(let left=seconds;left>1e-9;left-=.005)g.update(Math.min(.005,left));};
const match=(options={})=>{const g=new Game(null,{mode:'online',...options});g.state.kickoff=null;g.state.players.forEach(p=>Object.assign(p,{x:p.team?950:400,y:p.team?580:350}));return g;};
const receive=(g,p=g.localPlayer())=>{g.setOwner(p);advance(g,.151);return p;};

for(const team of [0,1]){
 test(`a human cannot release a new possession before150ms, team${team}`,()=>{
  const g=match({localTeam:team,localPlayerId:team}),p=g.localPlayer();g.setOwner(p);
  g.startShot();g.update(.005);g.releaseShot();g.update(.005);
  assert.equal(p.shotsTaken,0);advance(g,.139);assert.equal(p.shotsTaken,0);
  advance(g,.002);assert.equal(p.shotsTaken,1);assert.equal(g.hasBall(p),false);
 });
 test(`the actual bot controller respects150ms before its first shot, team${team}`,()=>{
  const kicks=[],g=match({mode:'bot',gameFormat:'bot-standard',localTeam:1-team,character:'none',opponentCharacter:'none',botRandom:()=>.3,onEvent:e=>{if(e.type==='kick')kicks.push({...e,at:g.actionClock});}}),p=g.state.players.find(p=>p.team===team);
  Object.assign(p,{x:team?550:650,y:350});g.setOwner(p);
  advance(g,.149);assert.equal(kicks.length,0);assert.equal(p.charging,false);
  advance(g,2);assert.ok(kicks.length>=1);assert.ok(kicks[0].at>=.15);
 });
 test(`weak half-field shots require physical saves rather than a finishing roll, team${team}`,()=>{
  for(const roll of [0,.999]){
   const g=match({localTeam:team}),p=g.localPlayer(),keeper=g.state.keepers[1-team];Object.assign(p,{x:600,y:350,aim:{x:team?70:1130,y:350}});receive(g,p);Object.assign(g.opponent(p),{y:580,stun:100});
   g.kick(p,10,{angle:team?Math.PI:0});g.state.ball.finish.roll=roll;advance(g,1.6);
   assert.equal(g.state.ball.owner,keeper.id);assert.equal(g.state.score[team],0);assert.equal(p.ultraCharge,1);
   g.keeperCatch(keeper);assert.equal(p.ultraCharge,1);
  }
 });
 test(`close well-placed powerful shots can beat keeper reaction, team${team}`,()=>{
  const g=match({localTeam:team}),p=g.localPlayer();Object.assign(p,{x:team?250:950,y:350,aim:{x:team?70:1130,y:275}});receive(g,p);
  g.kick(p,90,{accuracy:1});advance(g,.4);assert.equal(g.state.score[team],1);assert.equal(p.ultraCharge,1);
 });
}

test('canceling an early release or losing and reacquiring possession never fires the old queued shot',()=>{
 for(const action of ['cancel','reacquire']){
  const g=match(),p=g.localPlayer(),other=g.opponent(p);g.setOwner(p);g.kick(p,40);assert.equal(p.shotsTaken,0);
  if(action==='cancel')g.suspendControls();else{g.setOwner(other);g.setOwner(p);}
  advance(g,.4);assert.equal(p.shotsTaken,0);assert.equal(g.hasBall(p),true);
 }
});

test('long named windups automatically dribble while quick moves below750ms remain stealable',()=>{
 for(const [character,slot,protectedShot] of [['powershooter',0,true],['emperor',0,false]]){
  const g=match({character}),p=receive(g),enemy=g.opponent(p);g.activateMeteredSkill(p,slot);
  assert.equal(g.autoDribbling(p),protectedShot);assert.equal(g.steal(enemy,p),!protectedShot);
  assert.equal(g.hasBall(p),protectedShot);
 }
 const g=match(),p=receive(g),enemy=g.opponent(p);p.shotWindup={duration:.75,left:.75};assert.equal(g.setOwner(enemy),false);
 p.shotWindup={duration:.749,left:.749};assert.equal(g.setOwner(enemy),true);
});

test('normal skill protection ends at release and cannot leak into the next possession',()=>{
 const g=match({character:'powershooter'}),p=receive(g);g.activateMeteredSkill(p,0);assert.equal(g.autoDribbling(p),true);
 advance(g,1.01);assert.equal(g.autoDribbling(p),false);assert.equal(p.shotWindup,null);assert.equal(p.shotsTaken,1);
 g.setOwner(p);assert.equal(g.autoDribbling(p),false);
});

test('passes, off-target shots, own goals, keeper throws and scripted goals never farm Ultra',()=>{
 const pass=match({gameFormat:'standard-2v2'}),p=receive(pass),mate=pass.teammate(p);pass.pass(p,mate);pass.keeperCatch(pass.state.keepers[1]);assert.equal(p.ultraCharge,0);
 const abilityPass=match({gameFormat:'standard-2v2',character:'playmaker'}),a=receive(abilityPass);assert.equal(abilityPass.activateMeteredSkill(a,2),true);assert.equal(abilityPass.state.ball.finish,null);abilityPass.keeperCatch(abilityPass.state.keepers[1]);assert.equal(a.ultraCharge,0);
 const miss=match(),m=receive(miss);m.aim={x:1130,y:100};miss.kick(m,40,{accuracy:1});miss.keeperCatch(miss.state.keepers[1]);assert.equal(m.ultraCharge,0);
 const own=match(),o=receive(own);o.aim={x:70,y:350};own.kick(o,40,{accuracy:1});own.goal(1);assert.equal(o.ultraCharge,0);
 const instant=match(),i=receive(instant);instant.guaranteedGoal(i);advance(instant,.8);assert.equal(instant.state.score[0],1);assert.equal(i.ultraCharge,0);
 const thrown=match(),t=thrown.localPlayer();thrown.keeperCatch(thrown.state.keepers[0]);thrown.distributeKeeper(thrown.state.keepers[0]);thrown.keeperCatch(thrown.state.keepers[1]);assert.equal(t.ultraCharge,0);
});

test('a received rebound cannot become a free instantaneous follow-up kick',()=>{
 const g=match(),p=receive(g);g.kick(p,40);g.setOwner(p);g.kick(p,40);assert.equal(p.shotsTaken,1);
 advance(g,.149);assert.equal(p.shotsTaken,1);advance(g,.002);assert.equal(p.shotsTaken,2);
});

test('bots vary their support lanes when either keeper holds the ball',()=>{
 let seed=77;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 const g=match({mode:'bot',gameFormat:'bot-standard',character:'none',opponentCharacter:'none',botRandom:random}),p=g.state.players.find(p=>p.isBot);
 for(const team of [0,1]){
  const keeper=g.state.keepers[team];g.keeperCatch(keeper);keeper.holding=100;
  const targets=[];for(let i=0;i<30;i++){g.update(.15);const lane=g.botBrains[p.id].keeperLane;targets.push(Math.round(lane.y));}
  assert.ok(new Set(targets).size>2);assert.equal(g.state.ball.owner,keeper.id);
 }
});


test('last25 seconds are selected by the replay clock even when active match time differs',()=>{
 const g=match(),p=receive(g);g.state.elapsed=20;g.replayClock=40;const frame=g.captureFrame();g.history=[{...frame,at:10},{...frame,at:16},{...frame,at:30},{...frame,at:39}];g.goal(0);
 assert.equal(g.goalReplay[0].at,16);assert.equal(g.goalReplay.at(-1).at,40);assert.equal(g.state.replayDuration,12);assert.equal(g.state.elapsed,20);
});
