import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,fitViewport} from './game.js';

const advance=(game,seconds)=>{for(let elapsed=0;elapsed<seconds;elapsed+=.01)game.update(Math.min(.01,seconds-elapsed));};
function match(format='standard-2v2',extra={}){const game=new Game(null,{mode:'online',gameFormat:format,...extra});game.state.kickoff=null;return game;}

test('team formats create two independent outfield slots plus a keeper on each team',()=>{
 for(const format of ['standard-2v2','bot-2v2','bot-team']){
  const game=match(format);assert.deepEqual(game.state.players.map(p=>[p.id,p.team]),[[0,0],[1,1],[2,0],[3,1]]);
  assert.equal(game.state.keepers.length,2);assert.equal(game.width,1200);assert.equal(game.height,700);
  assert.deepEqual(game.state.players.filter(p=>p.isBot).map(p=>p.id),format==='bot-2v2'?[1,2,3]:format==='bot-team'?[1,3]:[]);
  for(const p of game.state.players){assert.equal(game.teammate(p).team,p.team);assert.notEqual(game.teammate(p).id,p.id);assert.notEqual(game.opponent(p).team,p.team);}
 }
 assert.equal(new Game(null,{mode:'bot'}).state.players.length,2,'legacy solo construction stays compatible');
});

test('a second teammate moves, charges, aims, and cancels without controlling their first teammate',()=>{
 const game=match('standard-2v2',{localPlayerId:2}),[first,,second]=game.state.players;
 Object.assign(first,{x:300,y:200});Object.assign(second,{x:400,y:450});game.setOwner(second);
 const start={x:first.x,y:first.y};game.localInput.keys={d:true};game.localInput.aim={x:1100,y:400};game.startShot();advance(game,.2);
 assert.deepEqual({x:first.x,y:first.y},start);assert.ok(second.x>400);assert.equal(second.charging,true);assert.equal(first.charging,false);assert.deepEqual(second.aim,{x:1100,y:400});
 game.suspendControls();assert.equal(second.charging,false);assert.equal(game.hasBall(second),true);assert.equal(game.pending[0].length,0);
 game.setInput(42,{keys:{w:true}});assert.equal(game.inputs[42],undefined,'unassigned identities cannot inject input');
});

test('team passes travel physically and an opposing player can intercept them',()=>{
 const game=match(),[from,enemy,to,other]=game.state.players;
 Object.assign(from,{x:300,y:350,aim:{x:700,y:350}});Object.assign(to,{x:700,y:350});Object.assign(enemy,{x:500,y:350});Object.assign(other,{x:900,y:550});game.setOwner(from);
 assert.equal(game.pass(from,to),true);assert.equal(game.state.ball.owner,null);assert.equal(game.state.ball.passTarget,to.id);assert.ok(game.state.ball.vx>0);assert.equal(from.shotsTaken,1);assert.equal(from.ultraCharge,1);
 advance(game,.3);assert.equal(game.state.ball.owner,enemy.id);assert.equal(enemy.lastReceivedFromId,from.id);assert.equal(game.state.ball.pass,null);
 const solo=match('standard-1v1');solo.setOwner(solo.localPlayer());assert.equal(solo.pass(solo.localPlayer()),false);
});

test('team bots make genuine passes and move into separate supporting lanes',()=>{
 const events=[],game=match('bot-team',{onEvent:event=>events.push(event)}),[human,bot,mate,botMate]=game.state.players;
 Object.assign(bot,{x:720,y:250});Object.assign(botMate,{x:500,y:450});Object.assign(human,{x:1000,y:120});Object.assign(mate,{x:1000,y:580});game.setOwner(bot);
 game.update(.01);assert.ok(events.some(e=>e.type==='pass'&&e.playerId===bot.id&&e.targetId===botMate.id));assert.equal(game.state.ball.owner,null);assert.equal(game.state.ball.passTarget,botMate.id);
 const start={x:bot.x,y:bot.y};advance(game,.12);assert.ok(Math.hypot(bot.x-start.x,bot.y-start.y)>0);assert.ok(Math.abs(bot.y-botMate.y)>80);
});

test('keepers recognize all opposing carriers and track their own aerial distribution through landing',()=>{
 const game=match(),keeper=game.state.keepers[0],secondRival=game.state.players[3];
 Object.assign(secondRival,{x:180,y:350});game.setOwner(secondRival);game.updateKeepers(.1);assert.ok(keeper.x>98,'the keeper closes the second opponent as well');
 game.state.players.forEach((p,i)=>Object.assign(p,{x:500+i*100,y:i%2?550:100}));game.keeperCatch(keeper);advance(game,2.02);
 const thrown=game.state.ball.distribution;assert.equal(thrown.team,0);assert.equal(thrown.keeperId,'k0');assert.ok(thrown.age<.05);assert.equal(thrown.landedAge,null);assert.equal(game.state.ball.hadAirtime,true);
 advance(game,1.3);assert.ok(thrown.age>1.3);assert.ok(thrown.landedAge!==null&&thrown.landedAge>=0);
});

test('team awakening draws cover all eligible players and never repeat the previous individual',()=>{
 const previous=Math.random;try{
  for(const [index,roll]of [.125,.375,.625,.875].entries()){
   Math.random=()=>roll;const game=match('standard-2v2',{players:[0,1,2,3].map(id=>({id,team:id%2,character:'powershooter'}))});
   game.state.players.forEach(p=>{p.awakeningCharge=99.99;p.recovery=1;});game.update(.02);assert.equal(game.state.awakeningOwner,index);
   game.state.players.forEach(p=>{p.awakeningCharge=99.99;p.recovery=1;});game.update(.02);assert.notEqual(game.state.awakeningOwner,index);
  }
 }finally{Math.random=previous;}
});

test('only the individual scorer may skip a team replay',()=>{
 const game=match();game.state.ball.lastTouch=2;game.goal(0);assert.equal(game.state.scorer,2);assert.equal(game.skipReplay(0),false);assert.equal(game.skipReplay(1),false);assert.equal(game.skipReplay(2),true);
});

test('Butterfly counter bonuses do not stack and Emperor power follows his current half',()=>{
 const game=match(),[dancer,enemy,emperor]=game.state.players;dancer.character='butterflydancer';emperor.character='emperor';
 game.setOwner(dancer);game.action(dancer);assert.equal(dancer.dribble,1);assert.equal(dancer.dribbleCd,1.5);
 game.steal(enemy,dancer);assert.equal(dancer.ability.ankleBoostLeft,5);assert.equal(game.powerBonus(dancer),10);game.steal(enemy,dancer);assert.equal(game.powerBonus(dancer),10);
 Object.assign(emperor,{x:400,ability:{emperorChemistry:true}});assert.equal(game.powerBonus(emperor),40);emperor.x=800;assert.equal(game.powerBonus(emperor),25);
 emperor.motion=null;dancer.character='magician';game.state.ball.lastTouch=dancer.id;game.setOwner(emperor);game.action(emperor);assert.equal(emperor.dribble,.85);
});

test('special chip flight keeps its pace, is serializable, and still permits a direct keeper save',()=>{
 const game=match('standard-1v1'),p=game.localPlayer();Object.assign(p,{x:700,y:350,aim:{x:1130,y:350}});game.setOwner(p);
 game.kick(p,10,{air:true,accuracy:1,unstoppableAir:true,noFrictionFor:Infinity,topspin:1.8,savePower:98});const speed=Math.hypot(game.state.ball.vx,game.state.ball.vy);
 assert.equal(game.state.ball.hadAirtime,true);assert.equal(game.state.ball.unstoppableAir,true);assert.equal(game.exportState().ball.noFrictionFor,3600);
 game.updateBall(.01);assert.equal(Math.hypot(game.state.ball.vx,game.state.ball.vy),speed);advance(game,.65);assert.equal(game.state.ball.owner,'k1');assert.deepEqual(game.state.score,[0,0]);
});

test('power bars retain their physical size when a large display scales up the original pitch',()=>{
 const bars=[],ctx=new Proxy({roundRect:(x,y,w,h)=>bars.push({x,y,w,h})},{get:(o,k)=>o[k]||(()=>{})});
 const game=new Game({getContext:()=>ctx,getBoundingClientRect:()=>({width:2400,height:1400})},{mode:'online'});game.drawShotPower(ctx,{...game.localPlayer(),charging:true,charge:30});const bar=bars[0],view=fitViewport(2400,1400);assert.equal(bar.w*view.scale,124);assert.equal(bar.h*view.scale,32);
});

test('airtime team passes land at their receiver and remain interceptable during flight',()=>{
 for(const intercept of [false,true]){
  const game=match(),[from,enemy,to,other]=game.state.players;Object.assign(from,{x:300,y:350});Object.assign(to,{x:600,y:350});Object.assign(enemy,{x:intercept?450:1000,y:intercept?350:550,leap:intercept?1:0});Object.assign(other,{x:1000,y:100});game.setOwner(from);
  assert.equal(game.pass(from,to,{power:55,air:true}),true);const ball=game.state.ball;assert.ok(ball.vz>0);advance(game,.7);
  assert.equal(ball.owner,intercept?enemy.id:to.id);assert.equal(ball.pass,null);
 }
});


test('Emperor receives Magician chemistry before an immediate release without waiting for a frame',()=>{
 const game=match(),[magician,,emperor]=game.state.players;magician.character='magician';emperor.character='emperor';emperor.x=800;game.setOwner(magician);game.pass(magician,emperor);game.setOwner(emperor);assert.equal(emperor.ability.emperorChemistry,true);assert.equal(game.powerBonus(emperor),30);game.kick(emperor,5,{accuracy:1});assert.equal(game.state.ball.power,35);assert.equal(emperor.ability.emperorChemistry,false);
});

test('Butterfly finish cinematic visibly weaves, draws out the keeper, nutmegs, and backheels',()=>{
 const game=match('standard-1v1'),p=game.localPlayer();p.character='butterflydancer';Object.assign(p,{x:250,y:350});game.setOwner(p);const origin=JSON.stringify(game.state.players);game.cutscene(3.8,['Dance'],'#ffe15b',null,{kind:'butterfly-finish',actorId:p.id,keeperId:'k1',destination:{x:984,y:350}});
 const run=game.cutsceneView(.3),up=game.cutsceneView(.65),nutmeg=game.cutsceneView(.78),heel=game.cutsceneView(.93);assert.ok(run.players[0].x>p.x+200);assert.ok(Math.abs(run.players[0].y-350)>10);assert.ok(up.keepers[1].x<1102);assert.ok(nutmeg.ball.x>nutmeg.keepers[1].x);assert.equal(heel.players[0].pose,'backheel');assert.equal(JSON.stringify(game.state.players),origin);
});
