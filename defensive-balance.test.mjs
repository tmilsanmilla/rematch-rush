import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from './game.js';
import {updateBotPlayer} from './bot-brain.js';
import {giveBall} from './test-fixtures.mjs';

function gameFor(team=1, random=()=>.4){
 const game=new Game(null,{mode:'bot',localPlayerId:1-team,gameFormat:'bot-standard',character:'none',opponentCharacter:'none',botRandom:random});
 game.state.kickoff=null; game.state.elapsed=10;
 const bot=game.state.players[team],human=game.state.players[1-team]; bot.isBot=true; human.isBot=false;
 return {game,bot,human};
}
for(const team of [0,1]) {
 test(`a defender protects the route to goal rather than diving into an active dribble, team ${team}`,()=>{
  const {game,bot,human}=gameFor(team),mirror=x=>team?x:1200-x;
  Object.assign(bot,{x:mirror(760),y:350,angle:team?Math.PI:0}); Object.assign(human,{x:mirror(700),y:350,dribble:.5}); giveBall(game,human);
  updateBotPlayer(game,bot,.01);
  assert.equal(game.inputs[bot.id].keys[team?'d':'a'],true,'retreat and contain the protected carrier');
  assert.equal(game.pending[bot.id].some(([action])=>action==='action'),false);
 });
 test(`a defender waits for an opening then uses the ordinary tackle pipeline, team ${team}`,()=>{
  const {game,bot,human}=gameFor(team),mirror=x=>team?x:1200-x;
  Object.assign(bot,{x:mirror(760),y:350,angle:team?Math.PI:0}); Object.assign(human,{x:mirror(700),y:350}); giveBall(game,human); game.updateBall(0);
  updateBotPlayer(game,bot,.01); assert.equal(game.pending[bot.id].some(([a])=>a==='action'),false);
  game.state.elapsed+=.5; game.botBrains[bot.id].think=0; updateBotPlayer(game,bot,.01);
  assert.equal(game.pending[bot.id].some(([a])=>a==='action'),true);
  game.update(.1); assert.ok(bot.motion?.steal||game.hasBall(bot),'a real slide, not a direct possession assignment');
 });
}

test('visible tackles produce different dribble escape lanes without granting cooldown exceptions',()=>{
 const lanes=[],travel=[];
 for(const roll of [.1,.9]) {
  const {game,bot,human}=gameFor(0,()=>roll);
  Object.assign(bot,{x:650,y:350,angle:0}); Object.assign(human,{x:530,y:350,motion:{steal:true,left:.2,dx:1,dy:0,speed:350}}); giveBall(game,bot);
  updateBotPlayer(game,bot,.01); lanes.push(game.inputs[bot.id].keys);
  assert.equal(game.inputs[bot.id].shootHeld,false); assert.equal(game.pending[bot.id].some(([a])=>a==='action'),false,'turn before dashing');
  game.update(.01); game.update(.01); assert.ok(bot.dribble>0); assert.ok(bot.dribbleCd>1.6);
  for(let i=0;i<30;i++)game.update(.01); travel.push(bot.y-350);
 }
 assert.equal(lanes[0].w,true); assert.equal(lanes[1].s,true); assert.ok(travel[0]<-10); assert.ok(travel[1]>10,'the actual dribbles escape on opposite sides');
});

test('both kickoff directions produce a defensive contest before a straight run reaches the box',()=>{
 for(const humanTeam of [0,1]) {
  const {game,bot,human}=gameFor(1-humanTeam,()=>.45); game.resetKickoff(humanTeam);
  let contested=false,boxRun=false;
  for(let i=0;i<300;i++) {
   game.setInput(human.id,{keys:{[humanTeam?'a':'d']:true},action:game.hasBall(human)&&human.dribbleCd<=0}); game.update(1/60);
   if(Math.hypot(bot.x-human.x,bot.y-human.y)<115||game.hasBall(bot)) contested=true;
   if(game.hasBall(human)&&(humanTeam?human.x<260:human.x>940)){boxRun=true;break;}
  }
  assert.equal(contested,true); assert.equal(boxRun,false,'a single straight kickoff run and repeated dribble is contained');
 }
});

function flight(team,{distance,targetY,power=80}) {
 const game=new Game(null,{mode:'online',localTeam:1-team}); game.state.kickoff=null;
 const p=game.state.players[team],enemy=game.state.players[1-team],goal=team?70:1130;
 Object.assign(enemy,{x:600,y:600,stun:100}); Object.assign(p,{x:goal+(team?distance:-distance),y:350,aim:{x:goal,y:targetY}});
 giveBall(game,p); game.kick(p,power,{angle:Math.atan2(targetY-350,goal-p.x)});
 for(let i=0;i<600&&game.state.phase==='play'&&typeof game.state.ball.owner!=='string';i++)game.update(1/120);
 return {saved:game.state.ball.owner===`k${1-team}`,scored:game.state.score[team],game};
}

test('mirrored keepers save half-field attempts but cannot instantly cover point-blank corners',()=>{
 for(const targetY of [280,310,350,390,420]) {
  const half=[0,1].map(team=>flight(team,{distance:530,targetY}));
  assert.equal(half[0].saved,half[1].saved); assert.equal(half[0].saved,true,`half-field target ${targetY}`);
  const close=[0,1].map(team=>flight(team,{distance:75,targetY}));
  assert.equal(close[0].scored,close[1].scored); assert.equal(close[0].scored,1,`close target ${targetY}`);
 }
});

test('keeper throws vary around a fixed general lane and remain physically interceptable',()=>{
 for(const team of [0,1]) {
  const targets=[];
  for(const angle of [0,.25,.5,.75]) {
   const values=[angle,.8]; const game=new Game(null,{mode:'online',localTeam:team,keeperRandom:()=>values.shift()??.5});game.state.kickoff=null;
   const p=game.state.players[team],k=game.state.keepers[team]; Object.assign(p,{x:600,y:350}); game.keeperCatch(k);game.distributeKeeper(k);
   const b=game.state.ball,target=b.distribution.target;targets.push(target);
   assert.ok(Math.hypot(target.x-p.x,target.y-p.y)>=18); assert.ok(Math.hypot(target.x-p.x,target.y-p.y)<=43);
   assert.equal(b.perfectPass,null); assert.equal(b.cannotScore,true);
   const frozen={...target}; game.setInput(p.id,{keys:{w:true}});game.update(.1);assert.deepEqual(b.distribution.target,frozen,'no homing after release');
  }
  assert.equal(new Set(targets.map(t=>`${t.x}:${t.y}`)).size,4);
 }
});
