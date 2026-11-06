import {giveBall} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,canvasResolution} from './game.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function snapshot(x=400){
  const host=new Game(null,{mode:'online'});host.state.kickoff=null;
  Object.assign(host.state.players[0],{x,y:350});giveBall(host,host.state.players[0]);
  host.updateBall(.001);return host.exportState();
}

test('a burst of guest snapshots performs one HUD import and acknowledges the newest consumed state',()=>{
  let imports=0,renders=0;const acknowledgements=[];
  const game=new Game(null,{mode:'guest',onState:()=>imports++});game.running=true;game.render=()=>renders++;
  for(let i=0;i<60;i++)game.receiveState(snapshot(400+i),()=>acknowledgements.push(i));
  assert.equal(imports,0);assert.equal(acknowledgements.length,0);
  game.frameStep(1000/60);
  assert.equal(imports,1);assert.equal(renders,1);assert.equal(game.state.players[0].x,459);
  assert.deepEqual(acknowledgements,[59]);assert.equal(game.pendingNetworkState,null);
});

test('coalescing retains a one-time replay and full time immediately supersedes pending play',()=>{
  const game=new Game(null,{mode:'guest'});game.running=true;game.render=()=>{};
  const state=snapshot(),replay=[{at:1},{at:2}];
  game.receiveState({...state,phase:'celebrate',replay},()=>{});
  game.receiveState({...state,phase:'replay',phaseTime:4},()=>{});game.frameStep(20);
  assert.deepEqual(game.goalReplay,replay);
  game.receiveState({...state,phase:'play'},()=>{});
  let acknowledged=0;game.receiveState({...state,phase:'ended'},()=>acknowledged++);
  assert.equal(game.state.phase,'ended');assert.equal(game.pendingNetworkState,null);assert.equal(acknowledged,1);
  game.frameStep(40);assert.equal(game.state.phase,'ended');
});

test('guest movement renders between 15Hz snapshots at 60Hz without changing authoritative positions or ball ownership',t=>{
  let now=0;t.mock.method(performance,'now',()=>now);
  const game=new Game(null,{mode:'guest'});game.importState(snapshot(400));
  now=1000/15;game.importState(snapshot(420));const immutable=JSON.stringify(game.state);
  const positions=[];
  for(let frame=0;frame<=4;frame++){
    const view=game.guestView(now+frame*1000/60);positions.push(view.players[0].x);
    near(view.ball.x-view.players[0].x,game.state.ball.x-game.state.players[0].x);
    assert.equal(view.ball.owner,game.state.ball.owner);
  }
  assert.deepEqual(positions.map(Math.round),[400,405,410,415,420]);
  assert.equal(JSON.stringify(game.state),immutable);
  assert.equal(game.guestView(now+10000).players[0].x,420,'a disconnected remote never extrapolates forever');
});

test('presentation never blends a kickoff reset, teleport, possession transfer or cinematic across the pitch',t=>{
  let now=0;t.mock.method(performance,'now',()=>now);
  const game=new Game(null,{mode:'guest'});game.importState(snapshot(400));
  now=70;game.importState(snapshot(900));assert.equal(game.guestView(now).players[0].x,900);
  const kickoff=snapshot(500);kickoff.kickoff={team:0,left:5};now=140;game.importState(kickoff);
  assert.equal(game.guestView(now).players[0].x,500);
  const released=snapshot(510);released.kickoff=kickoff.kickoff;released.ball={...released.ball,owner:null,x:700,y:300};now=210;game.importState(released);
  assert.equal(game.guestView(now).ball.x,700);
  now=280;game.importState({...released,phase:'cutscene',phaseTime:2});
  near(game.guestView(now+500).phaseTime,1.5);assert.equal(game.state.phaseTime,2);
});

test('guest replay animation advances every display frame between network updates',t=>{
  let now=1000;t.mock.method(performance,'now',()=>now);
  const state=snapshot();state.phase='replay';state.replayDuration=4;state.phaseTime=4;
  state.replay=[{...state,at:0,players:[{...state.players[0],x:100}]},{...state,at:1,players:[{...state.players[0],x:500}]}];
  const game=new Game(null,{mode:'guest'});game.importState(state);
  const xs=[0,16,32,48].map(offset=>game.replayView(game.guestView(now+offset)).players[0].x);
  assert.ok(xs.every((x,i)=>i===0||x>xs[i-1]));assert.equal(game.state.phaseTime,4);
});

test('sustained slow rendering reduces only local pixels, with a stable floor and unchanged game clock',t=>{
  let now=0;t.mock.method(performance,'now',()=>now);
  const game=new Game({getContext:()=>null},{mode:'online'});game.state.kickoff=null;
  game.render=()=>{now+=30;};
  for(let frame=1;frame<=24;frame++){now=frame*1000/60;game.frameStep(now);}
  assert.equal(game.renderQuality,.5);near(game.state.elapsed,.4);near(game.state.time,299.6);
  const full=canvasResolution(1920,1080,2),light=canvasResolution(1920,1080,2,game.renderQuality);
  assert.ok(light.width*light.height<full.width*full.height*.26);
  for(let i=0;i<100;i++)game.trackRenderCost(30);assert.equal(game.renderQuality,.5);
  const healthy=new Game({getContext:()=>null},{mode:'guest'});
  for(let i=0;i<100;i++)healthy.trackRenderCost(2);assert.equal(healthy.renderQuality,1);
});

test('slow display delivery also lowers pixels, while hidden-tab throttling never downgrades quality',()=>{
  const document={hidden:true},game=new Game({getContext:()=>null,ownerDocument:document},{mode:'guest'});
  for(let i=0;i<40;i++)game.trackRenderCost(1,.5);
  assert.equal(game.renderQuality,undefined);
  document.hidden=false;for(let i=0;i<16;i++)game.trackRenderCost(1,.5);
  assert.equal(game.renderQuality,.5);
});

test('replay lead-in adds preceding gameplay without slowing the shot',()=>{
  for(const duration of [.2,1,5]){
    const game=new Game(null,{mode:'online'});game.state.kickoff=null;game.state.elapsed=20;
    const frame=game.captureFrame();game.shotStartedAt=20;game.shotReplay=[frame];game.history=[{...frame,at:0},{...frame,at:17},{...frame,at:18},{...frame,at:19}];
    game.state.elapsed+=duration;game.goal(0);
    near(game.state.replayDuration,duration+3);
    assert.equal(game.goalReplay[0].at,17);assert.equal(game.goalReplay.at(-1).at,20+duration);
  }
});
