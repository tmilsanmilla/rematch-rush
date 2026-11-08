import {giveBall} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, MOTION_PACE} from './game.js';

function match(team=0,options={}){
 const game=new Game(null,{mode:'online',localTeam:team,...options});game.state.kickoff=null;
 const player=game.state.players.find(p=>p.team===team),enemy=game.state.players.find(p=>p.team!==team);
 Object.assign(enemy,{x:600,y:580,stun:100});
 return {game,player,enemy,keeper:game.state.keepers[team]};
}
function advance(game,seconds){for(let t=0;t<seconds-1e-9;t+=.005)game.update(Math.min(.005,seconds-t));}
function random(value,callback){const previous=Math.random;try{Math.random=()=>value;return callback();}finally{Math.random=previous;}}

for(const team of [0,1]){
 test(`keeper throws reach a general receiving lane that a player can collect for team ${team}`,()=>{
  for(const x of [180,550,900]){
   const {game,player,keeper}=match(team,{keeperRandom:()=>.6});Object.assign(player,{x:team?1200-x:x,y:380});
   game.keeperCatch(keeper);keeper.holding=0;game.update(.005);
   assert.equal(game.state.ball.passTarget,player.id);assert.equal(game.state.ball.pass.fromId,keeper.id);
   assert.equal(game.state.ball.distribution.targetId,player.id);
   const target=game.state.ball.distribution.target;
   assert.ok(Math.hypot(target.x-player.x,target.y-player.y)>=18,'the throw is not a perfect pass');
   for(let i=0;i<500&&!game.hasBall(player);i++){game.setInput(player.id,{keys:{a:target.x<player.x-4,d:target.x>player.x+4,w:target.y<player.y-4,s:target.y>player.y+4}});game.update(.005);}
   assert.equal(game.state.ball.owner,player.id,`throw to ${x} must reach the intended player`);
   assert.equal(player.shotsTaken,0);assert.equal(player.ultraCharge,0);
   assert.equal(player.lastReceivedFromId,keeper.id);
  }
 });
 test(`a keeper leads a running player with an interceptable physical pass for team ${team}`,()=>{
  const {game,player,keeper}=match(team,{keeperRandom:()=>0});Object.assign(player,{x:team?750:450,y:350});
  game.setInput(player.id,{keys:{s:true}});game.keeperCatch(keeper);keeper.holding=0;game.update(.005);
  assert.ok(game.state.ball.distribution.target.y>player.y);
  assert.equal(game.state.ball.perfectPass,null);
  for(let i=0;i<500&&!game.hasBall(player);i++)game.update(.005);
  assert.equal(game.state.ball.owner,player.id);
 });
 test(`full normal and Ultra charges release promptly while the player can keep moving, team ${team}`,()=>{
  for(const ultra of [false,true]){
   const {game,player}=match(team);giveBall(game,player);player.ultraCharge=ultra?3:0;
   const x=player.x;game.setInput(player.id,{shootHeld:true,ultraShot:ultra,keys:{[team?'a':'d']:true}});
   game.update(.005);advance(game,.5);assert.ok(Math.abs(player.charge-23.18)<1e-8);assert.equal(player.shotsTaken,0);assert.ok(Math.abs(player.x-x)>50);
   game.setInput(player.id,{shootHeld:true,ultraShot:ultra,keys:{}});advance(game,2.135);assert.equal(player.charge,100);assert.equal(player.shotsTaken,0);
   advance(game,.26);assert.equal(player.shotsTaken,1);assert.equal(player.shotPower,100);assert.equal(player.charging,false);
  }
 });
 test(`actual central close shots beat the keeper more often than half-field and distant shots, team ${team}`,()=>{
  const rates={};
  for(const [label,distance] of [['close',180],['half',530],['far',900]]){
   let goals=0;
   for(let i=0;i<100;i++){
    const {game,player}=match(team),goalX=team?70:1130;
    Object.assign(player,{x:goalX+(team?distance:-distance),y:350,aim:{x:goalX,y:350}});giveBall(game,player);
    random((i+.5)/100,()=>game.kick(player,80,{angle:team?Math.PI:0}));
    for(let tick=0;tick<500&&game.state.phase==='play'&&typeof game.state.ball.owner!=='string';tick++)game.update(.005);
    goals+=Number(game.state.score[team]>0);
   }
   rates[label]=goals/100;
  }
  assert.ok(rates.close>.6,JSON.stringify(rates));assert.ok(rates.half<.25,JSON.stringify(rates));assert.ok(rates.far<.05,JSON.stringify(rates));
 });
}

test('keepers prefer actual human teammates and share successive throws between two humans',()=>{
 const game=new Game(null,{mode:'online',gameFormat:'bot-2v2',character:'none'});game.state.kickoff=null;
 const keeper=game.state.keepers[0],human=game.state.players[0],mate=game.state.players[2];
 Object.assign(human,{x:800,y:350});Object.assign(mate,{x:170,y:350});
 game.keeperCatch(keeper);game.distributeKeeper(keeper);assert.equal(game.state.ball.passTarget,human.id);
 mate.isBot=false;game.keeperCatch(keeper);game.distributeKeeper(keeper);assert.equal(game.state.ball.passTarget,mate.id);
 game.keeperCatch(keeper);game.distributeKeeper(keeper);assert.equal(game.state.ball.passTarget,human.id);
});

test('a distribution lands at the planned receiving point rather than rolling far beyond it',()=>{
 const {game,player,keeper}=match();Object.assign(player,{x:550,y:400,stun:100});
 game.keeperCatch(keeper);game.distributeKeeper(keeper);
 const {target,flight}=game.state.ball.distribution;advance(game,flight/MOTION_PACE);
 assert.ok(Math.hypot(game.state.ball.x-target.x,game.state.ball.y-target.y)<12);
 assert.ok(game.state.ball.z<2);assert.equal(game.state.ball.cannotScore,true);
});

test('the replay includes the three-second lead-in and final shot at real speed',()=>{
 const {game,player}=match(0,{gameFormat:'standard-2v2'});advance(game,12);
 const mate=game.state.players[2];Object.assign(mate,{x:500,y:350});Object.assign(player,{x:650,y:350});game.state.players.filter(p=>p.team===1).forEach(p=>Object.assign(p,{y:580,stun:100}));
 giveBall(game,mate);game.pass(mate,player);const earlierPass=game.state.elapsed;advance(game,.3);assert.equal(game.hasBall(player),true);advance(game,.16);
 Object.assign(player,{x:880,y:350,aim:{x:1130,y:280}});
 game.state.keepers[1].y=800;const release=game.state.elapsed;
 random(0,()=>game.kick(player,80,{angle:Math.atan2(-70,250)}));
 for(let i=0;i<400&&game.state.phase==='play';i++)game.update(.005);
 assert.equal(game.state.score[0],1);assert.ok(release>earlierPass);assert.ok(game.goalReplay[0].at<.11);assert.ok(game.goalReplay.some(frame=>Math.abs(frame.at-release)<.11));
 assert.ok(game.state.replayDuration<=12.5);assert.ok(game.state.replayDuration>=6);
 const guest=new Game(null,{mode:'guest'});guest.importState(game.exportState());assert.deepEqual(guest.goalReplay,game.goalReplay);assert.equal(guest.state.replayDuration,game.state.replayDuration);
});
