import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from './game.js';

const advance=(game,seconds)=>{for(let left=seconds;left>1e-9;left-=.01)game.update(Math.min(.01,left));};
function game(extra={}){const value=new Game(null,{mode:'online',...extra});value.state.kickoff=null;return value;}
function own(value,p=value.localPlayer()){value.setOwner(p);return p;}
function release(value,ultraShot=false){value.setInput(value.localPlayerId,{shootHeld:true,ultraShot});value.update(.01);value.setInput(value.localPlayerId,{shootHeld:false,shootRelease:true,ultraShot});value.update(.01);}
function event(type,fields={}){const result=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(fields))Object.defineProperty(result,key,{value});return result;}
function browser(extra={}){
 const before=globalThis.window,win=new EventTarget(),canvas=new EventTarget(),doc=new EventTarget();globalThis.window=win;
 Object.assign(canvas,{ownerDocument:doc,getContext:()=>null,getBoundingClientRect:()=>({left:0,top:0,width:1200,height:700}),requestPointerLock(){}});
 const value=new Game(canvas,{mode:'online',...extra});value.state.kickoff=null;value.bind();
 return {value,win,canvas,close(){value.stop();if(before===undefined)delete globalThis.window;else globalThis.window=before;}};
}

test('only real kicks advance Ultra; passes and ability kicks count once, empty attempts do not',()=>{
 const value=game({gameFormat:'standard-2v2'}),p=value.localPlayer(),mate=value.teammate(p);
 assert.equal(value.kick(p,20),false);assert.equal(value.pass(p,mate),false);assert.equal(p.ultraCharge,0);
 own(value,p);assert.equal(value.pass(p,mate),true);assert.equal(p.ultraCharge,1);assert.equal(p.shotsTaken,1);
 assert.equal(value.pass(p,mate),false);assert.equal(p.ultraCharge,1);
 own(value,p);assert.equal(value.kick(p,45,{accuracy:1}),true);assert.equal(p.ultraCharge,2);
 own(value,p);release(value);assert.equal(p.ultraCharge,3);assert.equal(p.shotsTaken,3);
 for(let n=0;n<3;n++){own(value,p);release(value);assert.equal(p.shotType,'normal');assert.equal(p.ultraCharge,3);}
 assert.equal(p.shotsTaken,6);assert.equal(mate.ultraCharge,0);
});

test('ICE instant chemistry and cinematic assist each count the actual pass exactly once',()=>{
 for(const awakened of [false,true]){
  const value=game({gameFormat:'standard-2v2',character:'ice'}),p=value.localPlayer(),mate=value.teammate(p);
  Object.assign(p,{x:300,y:350,aim:{x:500,y:350},awakened,awakeningLeft:awakened?45:0});Object.assign(mate,{x:500,y:350});own(value,p);value.localInput.aim={...p.aim};
  assert.equal(value.useSkill(awakened?3:1),true);value.update(.01);
  if(awakened){assert.equal(p.ultraCharge,0,'windup is not itself a kick');advance(value,1.81);assert.equal(value.state.ball.perfectPass?.fromId,p.id);}
  else assert.equal(value.state.ball.owner,mate.id);
  assert.equal(p.shotsTaken,1);assert.equal(p.ultraCharge,1);advance(value,.9);assert.equal(p.shotsTaken,1);assert.equal(p.ultraCharge,1);
 }
});

test('Magician flight and placement follow-up passes count once, with no charge for refused ability attempts',()=>{
 for(const followup of [false,true]){
  const value=game({gameFormat:'standard-2v2',character:'magician'}),p=value.localPlayer(),mate=value.teammate(p);
  Object.assign(p,{x:300,y:350,aim:{x:500,y:350},ability:followup?{placementFollowup:5}:{}});Object.assign(mate,{x:500,y:350});own(value,p);
  value.useSkill(followup?1:2);value.update(.01);assert.equal(value.state.ball.perfectPass?.fromId,p.id);assert.equal(p.shotsTaken,1);assert.equal(p.ultraCharge,1);
  advance(value,.9);assert.equal(p.shotsTaken,1);assert.equal(p.ultraCharge,1);
 }
 for(const character of ['ice','magician']){
  const solo=game({character}),p=own(solo);solo.useSkill(character==='ice'?1:2);solo.update(.01);assert.equal(p.ultraCharge,0);assert.equal(p.shotsTaken,0);assert.equal(solo.hasBall(p),true);
 }
 const tooFar=game({gameFormat:'standard-2v2',character:'ice'}),p=tooFar.localPlayer(),mate=tooFar.teammate(p);Object.assign(p,{x:200,y:350,aim:{x:900,y:350}});Object.assign(mate,{x:900,y:350});own(tooFar,p);tooFar.localInput.aim={...p.aim};tooFar.useSkill(1);tooFar.update(.01);assert.equal(p.ultraCharge,0);assert.equal(p.shotsTaken,0);
});

test('Q sends a genuine pass in team matches and leaves solo possession untouched',()=>{
 for(const gameFormat of ['standard-1v1','standard-2v2']){
  const f=browser({gameFormat});try{
   const p=own(f.value);f.win.dispatchEvent(event('keydown',{key:'q',code:'KeyQ'}));f.value.update(.01);
   assert.equal(p.ultraCharge,gameFormat==='standard-2v2'?1:0);assert.equal(f.value.hasBall(p),gameFormat==='standard-1v1');
   if(gameFormat==='standard-2v2')assert.equal(f.value.state.ball.passTarget,f.value.teammate(p).id);
  }finally{f.close();}
 }
});

test('unearned or off-ball F refuses without charging, kicking, or spending the meter',()=>{
 const value=game(),p=own(value);
 assert.equal(value.startUltrashot(),false);assert.equal(value.localInput.shootHeld,false);assert.equal(value.hasBall(p),true);assert.equal(p.ultraCharge,0);
 value.setInput(p.id,{shootHeld:true,ultraShot:true});value.update(.1);assert.equal(p.charging,false);
 value.setInput(p.id,{shootHeld:false,shootRelease:true,ultraShot:true});value.update(.01);
 assert.equal(value.hasBall(p),true);assert.equal(p.shotsTaken,0);assert.equal(p.ultraCharge,0);
 p.ultraCharge=3;value.setOwner(value.opponent(p));assert.equal(value.startUltrashot(),false);assert.equal(p.ultraCharge,3);
});

test('F starts and releases Ultra while ordinary mouse input can neither activate nor release it',()=>{
 const f=browser();try{
  const p=own(f.value);p.ultraCharge=3;
  f.canvas.dispatchEvent(event('pointerdown',{pointerType:'mouse',button:0,clientX:1100,clientY:320}));f.value.update(.01);
  f.win.dispatchEvent(event('keyup',{key:'f',code:'KeyF'}));assert.equal(f.value.localInput.shootHeld,true,'F release cannot release a mouse shot');
  f.win.dispatchEvent(event('pointerup',{pointerType:'mouse'}));f.value.update(.01);
  assert.equal(p.shotType,'normal');assert.equal(p.ultraCharge,3);
  own(f.value,p);f.win.dispatchEvent(event('keydown',{key:'f',code:'KeyF'}));f.value.update(.01);
  assert.equal(p.chargingUltra,true);assert.equal(f.value.shotMeter(p).label,'ULTRA POWER');
  f.win.dispatchEvent(event('pointerup',{pointerType:'mouse'}));assert.equal(f.value.localInput.shootHeld,true,'mouse release cannot release F Ultra');
  f.win.dispatchEvent(event('keyup',{key:'f',code:'KeyF'}));f.value.update(.01);
  assert.ok(['curve','quick'].includes(p.shotType));assert.equal(p.ultraCharge,0);assert.equal(p.shotsTaken,2);
 }finally{f.close();}
});

test('a queued release retains its original shot channel even when the following packet changes it',()=>{
 const value=game(),p=own(value);p.ultraCharge=3;
 value.setInput(p.id,{shootHeld:true,ultraShot:true});value.update(.01);
 value.setInput(p.id,{shootHeld:false,shootRelease:true,ultraShot:false});value.update(.01);
 assert.ok(['curve','quick'].includes(p.shotType));assert.equal(p.ultraCharge,0);
 own(value,p);p.ultraCharge=3;
 value.setInput(p.id,{shootHeld:true,ultraShot:false});value.update(.01);
 value.setInput(p.id,{shootHeld:false,shootRelease:true,ultraShot:true});value.update(.01);
 assert.equal(p.shotType,'normal');assert.equal(p.ultraCharge,3);
});

test('normal maximum hold never upgrades itself and a cancelled F charge retains earned Ultra',()=>{
 const value=game(),p=own(value);Object.assign(p,{ultraCharge:3,charging:true,charge:100,maxHold:3.99});
 value.setInput(p.id,{shootHeld:true,ultraShot:false});value.update(.02);assert.equal(p.shotType,'normal');assert.equal(p.ultraCharge,3);
 own(value,p);assert.equal(value.startUltrashot(),true);value.update(.01);assert.equal(p.chargingUltra,true);
 value.suspendControls();value.update(.01);assert.equal(value.hasBall(p),true);assert.equal(p.ultraCharge,3);assert.equal(p.shotsTaken,1);assert.equal(p.chargingUltra,false);
});

test('explicit guest Ultra uses the ordinary input channel and the host decides earned charge',()=>{
 const host=game(),p=host.state.players[1],inputs=[];host.setOwner(p);p.ultraCharge=3;
 const guest=game({mode:'guest',localPlayerId:1,localTeam:1,onInput:input=>{inputs.push(input);host.setInput(1,input);}});guest.importState(host.exportState());
 assert.equal(guest.startUltrashot(),true);host.update(.01);assert.equal(guest.releaseUltrashot(),true);host.update(.01);
 assert.equal(inputs.length,2);assert.equal(inputs[0].ultraShot,true);assert.equal(inputs[1].ultraShot,true);assert.equal(p.ultraCharge,0);assert.ok(['curve','quick'].includes(p.shotType));
 guest.importState(host.exportState());assert.equal(guest.localPlayer().ultraCharge,0);assert.equal(guest.startUltrashot(),false);
});

test('offline standard is one player versus one bot, while offline 2v2 adds a bot teammate',()=>{
 for(const localTeam of [0,1]){
  const solo=game({mode:'bot',gameFormat:'bot-standard',localTeam});assert.equal(solo.state.players.length,2);assert.equal(solo.state.keepers.length,2);
  assert.deepEqual(solo.state.players.filter(p=>p.isBot).map(p=>p.id),[1-localTeam]);assert.equal(solo.teammate(solo.localPlayer()),null);
  const teams=game({mode:'bot',gameFormat:'bot-2v2',localTeam});assert.equal(teams.state.players.length,4);assert.equal(teams.state.keepers.length,2);
  assert.equal(teams.state.players.filter(p=>p.isBot).length,3);assert.equal(teams.teammate(teams.localPlayer()).isBot,true);
 }
});

test('custom settings clamp to supported choices and a winning replay or skip ends the match once',()=>{
 assert.equal(game({settings:{duration:120,scoreLimit:3}}).state.time,120);
 assert.equal(game({settings:{duration:600,scoreLimit:10}}).state.time,600);
 assert.equal(game({settings:{duration:12345,scoreLimit:99}}).state.time,300);assert.equal(game({settings:{scoreLimit:99}}).state.scoreLimit,0);
 for(const skip of [false,true]){
  let ended=0;const value=game({settings:{duration:120,scoreLimit:3},onEnd:()=>ended++});value.state.score=[2,0];value.state.ball.lastTouch=0;value.goal(0);
  assert.equal(value.state.phase,'celebrate');assert.equal(ended,0);
  if(skip)assert.equal(value.skipReplay(0),true);else advance(value,7);
  assert.equal(value.state.phase,'ended');assert.equal(ended,1);advance(value,1);assert.equal(ended,1);
 }
 let ended=0;const timed=game({settings:{duration:120},onEnd:()=>ended++});timed.state.time=.005;timed.update(.01);assert.equal(timed.state.phase,'ended');assert.equal(ended,1);
});
