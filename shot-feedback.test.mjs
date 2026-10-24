import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,fitViewport} from './game.js';

function withRandom(random,callback){const previous=Math.random;try{Math.random=random;return callback();}finally{Math.random=previous;}}
function match(team=0){const game=new Game(null,{mode:'online',localTeam:team});game.state.kickoff=null;return game;}
function release(game,distance,roll,{team=0,type='normal',...options}={}){
 const p=game.state.players[team],goalX=team?70:1130;
 Object.assign(p,{x:goalX+(team?distance:-distance),y:350,aim:{x:goalX,y:350},ultraCharge:type==='normal'?0:3});game.setOwner(p);
 let draws=0;withRandom(()=>type==='normal'?roll:draws++===0?(type==='curve'?.25:.75):roll,()=>game.kick(p,80,{fromF:true,ultraShot:type!=='normal',...options}));
 return {p,ball:game.state.ball,placement:{...game.state.ball.finish.placement}};
}
function placementFlight(distance,roll,team,type){
 const game=match(team),shot=release(game,distance,roll,{team,type});
 // Remove saves to measure actual placement rather than the keeper's outcome roll.
 game.state.keepers.forEach(keeper=>{keeper.y=-10000;keeper.holding=1;});shot.ball.finish.chances=[1,1];
 for(let i=0;i<700&&game.state.phase==='play'&&shot.ball.vx*(team?-1:1)>0;i++){game.state.elapsed+=.005;game.updateBall(.005);}
 return {onTarget:game.state.score[team]===1,placement:shot.placement};
}

test('real shot flights increasingly miss the posts with distance for either team, even without a keeper',()=>{
 let seed=251773;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(const team of [0,1])for(const type of ['normal','curve','quick']){
  const rates={};for(const [name,distance] of [['near',200],['middle',600],['far',1000]]){
   let onTarget=0;for(let i=0;i<200;i++)onTarget+=Number(placementFlight(distance,random(),team,type).onTarget);rates[name]=onTarget/200;
  }
  assert.ok(rates.near>.9,`${team} ${type}: ${JSON.stringify(rates)}`);
  assert.ok(rates.far<rates.near-.2,`${team} ${type}: ${JSON.stringify(rates)}`);
  assert.ok(rates.far<rates.middle-.15,`${team} ${type}: ${JSON.stringify(rates)}`);
 }
});

test('ordinary shot placement is sampled once at release and stays deterministic throughout flight',()=>{
 const game=match(),p=game.state.players[0];Object.assign(p,{x:150,y:350,aim:{x:1130,y:350}});game.setOwner(p);
 let calls=0;withRandom(()=>{calls++;return .6;},()=>{
  game.kick(p,50,{fromF:true});const finish=game.state.ball.finish,placement={...finish.placement};
  assert.ok(Math.abs(placement.error)>.1);for(let i=0;i<20;i++)game.updateBall(.01);
  assert.deepEqual(finish.placement,placement);assert.equal(finish.roll,.6);
 });assert.equal(calls,1);
 const again=release(match(),980,.6);assert.equal(again.placement.error,game.state.ball.finish.placement.error);
});

test('Ultra placement is tighter while perfect accuracy and explicit choreography remain exact',()=>{
 const normal=release(match(),950,.8),quick=release(match(),950,.8,{type:'quick'});
 assert.ok(Math.abs(quick.placement.error)<Math.abs(normal.placement.error));
 for(const options of [{accuracy:1},{angle:0}]){
  const {ball,placement}=release(match(),950,.99,options);assert.equal(placement.error,0);assert.equal(placement.spread,0);assert.equal(ball.vy,0);
 }
 const game=match(),p=game.state.players[0];Object.assign(p,{x:100,y:350});game.setOwner(p);
 assert.equal(withRandom(()=>.99,()=>game.guaranteedGoal(p)),true);assert.ok(game.state.ball.scriptedGoal);
 const travelSeconds=game.motionDuration(.55);
 for(let i=0;i<Math.ceil(travelSeconds/.01)+1&&game.state.phase==='play';i++)game.updateBall(.01);assert.equal(game.state.score[0],1);
});

test('both power bars follow beside the player, fall back to the left, and stay readable in every viewport',()=>{
 for(const [width,height] of [[1200,700],[375,475],[667,180]]){
  const bars=[],labels=[],ctx=new Proxy({roundRect:(x,y,w,h)=>bars.push({x,y,w,h}),fillText:(text,x,y)=>labels.push({text,x,y})},{get:(o,k)=>o[k]||(()=>{})});
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width,height})},game=new Game(canvas,{mode:'online'}),view=fitViewport(width,height);
  for(const team of [0,1])for(const [x,y] of [[350,350],[1190,350],[0,0],[1200,700]]){
   const p={...game.state.players[team],x,y,charging:true,charge:42};game.drawShotPower(ctx,p);const b=bars.at(-1);
   assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=1200&&b.y+b.h<=700);
   assert.ok(Math.abs(b.w*view.scale-124)<.001);assert.ok(Math.abs(b.h*view.scale-32)<.001);
   if(x===350){assert.ok(b.x>x);assert.ok(b.y<y&&b.y+b.h>y,'the bar is vertically centered beside its player');}
   if(x===1190)assert.ok(b.x+b.w<x,'near the right edge the bar moves to the player’s left');
  }
  assert.ok(labels.every(label=>label.text==='POWER 42'));
 }
});
