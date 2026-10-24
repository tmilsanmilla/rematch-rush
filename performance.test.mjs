import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, canvasResolution, fitViewport } from './game.js';

function context() {
  const calls = new Map();
  const ctx = new Proxy({
    measureText: text => ({ width: text.length * 12 }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => { calls.set(key, (calls.get(key) || 0) + 1); };
  } });
  return { ctx, calls };
}

test('canvas backing pixels and density stay bounded on Retina, 4K, and ultrawide screens', () => {
  for (const [width, height, dpr] of [[375, 667, 3], [1366, 768, 2], [3840, 2160, 3], [7680, 2160, 2], [1080, 7680, 3]]) {
    const result = canvasResolution(width, height, dpr);
    assert.ok(result.width * result.height <= 1600000);
    assert.ok(Math.max(result.width, result.height) <= 2560);
    assert.ok(result.scale <= 1.5);
    assert.ok(Math.abs(result.width - width * result.scale) < 1);
    assert.ok(Math.abs(result.height - height * result.scale) < 1);
  }
  assert.deepEqual(canvasResolution(0, 700, 2), { width: 0, height: 0, scale: 0 });
});

test('steady rendering measures layout once and draws the static pitch from one reusable bitmap', () => {
  const main = context(), layer = context();
  let measurements = 0, created = 0, pitchDraws = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => main.ctx,
    getBoundingClientRect: () => { measurements++; return { left: 20, top: 40, width: 1920, height: 1080 }; },
    ownerDocument: { createElement: () => { created++; return { getContext: () => layer.ctx }; } }
  };
  const game = new Game(canvas, { mode: 'online' });
  const pitch = game.drawPitch.bind(game);
  game.drawPitch = ctx => { pitchDraws++; pitch(ctx); };
  for (const p of game.state.players) { p.charging = true; p.charge = 40; }
  for (let frame = 0; frame < 120; frame++) game.render();
  assert.equal(measurements, 1, 'frame and player meters share the cached layout');
  assert.equal(created, 1);
  assert.equal(pitchDraws, 1, 'hundreds of static pitch operations run only when its dimensions change');
  assert.equal(main.calls.get('drawImage'), 120);
  assert.ok((layer.calls.get('fillRect') || 0) > 100);
  assert.ok(canvas.width * canvas.height <= 1600000);
  const view = fitViewport(canvas.width, canvas.height);
  assert.ok(Math.abs(game.pitchWidth - view.width) <= 1);
  assert.ok(Math.abs(game.pitchHeight - view.height) <= 1);
});

test('canvas resize invalidates its bounds and bitmap without adding another observer or canvas', () => {
  const previousWindow = globalThis.window, previousObserver = globalThis.ResizeObserver;
  const events = new EventTarget();
  let callback, observed = 0, disconnected = 0, width = 1200, measurements = 0, created = 0;
  globalThis.window = events;
  globalThis.ResizeObserver = class {
    constructor(fn) { callback = fn; }
    observe() { observed++; }
    disconnect() { disconnected++; }
  };
  try {
    const main = context(), layer = context();
    const canvas = { width: 0, height: 0, getContext: () => main.ctx,
      getBoundingClientRect: () => { measurements++; return { left: 0, top: 0, width, height: 700 }; },
      ownerDocument: { createElement: () => { created++; return { getContext: () => layer.ctx }; } }
    };
    const game = new Game(canvas, { mode: 'online' });
    game.observeCanvas();game.render();game.render();
    assert.equal(measurements, 1);
    width = 800;callback();game.render();game.render();
    assert.equal(measurements, 2);
    assert.equal(game.canvasMetrics().width, 800);
    assert.equal(created, 1);
    assert.equal(observed, 1);
    game.stop();assert.equal(disconnected, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;else globalThis.window = previousWindow;
    if (previousObserver === undefined) delete globalThis.ResizeObserver;else globalThis.ResizeObserver = previousObserver;
  }
});

test('slow frames advance the full elapsed time with bounded physics steps and one render', () => {
  const game = new Game(null, { mode: 'online' }), steps = [], states = [];
  game.state.kickoff = null;game.last = 0;
  const original = game.update.bind(game);let renders = 0, flushed = 0;
  game.update = dt => { steps.push(dt);original(dt); };
  game.render = () => { renders++; };
  game.flushAimInput = () => { flushed++; };
  game.options.onState = state => { states.push(state); };
  game.frameStep(500);
  assert.ok(Math.abs(game.state.time - 299.5) < .000001);
  assert.ok(Math.abs(steps.reduce((sum, dt) => sum + dt, 0) - .5) < .000001);
  assert.ok(steps.every(dt => dt > 0 && dt <= 1 / 30));
  assert.ok(steps.length <= 15);
  assert.equal(renders, 1);assert.equal(flushed, 1);assert.equal(states.length, 1);
  steps.length = 0;game.frameStep(60000);
  assert.ok(steps.length <= 15, 'returning after a background pause cannot trigger unbounded catch-up work');
});

test('guest animation frames render without duplicating authoritative HUD and simulation updates', () => {
  let states = 0, updates = 0, renders = 0;
  const game = new Game(null, { mode: 'guest', onState: () => { states++; } });
  game.update = () => { updates++; };game.render = () => { renders++; };game.last = 0;
  game.importState(game.exportState());
  game.frameStep(100);game.frameStep(200);game.frameStep(300);
  assert.equal(states, 1);assert.equal(updates, 0);assert.equal(renders, 3);
});

test('rapid airborne and duplicate bounce effects coalesce and bursts have a fixed drawing budget', () => {
  const game = new Game(null, { mode: 'online' });game.effects = [];
  for (let i = 0; i < 1000; i++) game.effect('air', 500, 700, '#fff', .18);
  assert.equal(game.effects.length, 1);
  game.effects = [];
  for (let i = 0; i < 1000; i++) game.effect('bounce', 500, 700, '#fff', .25);
  assert.equal(game.effects.length, 1);
  for (let i = 0; i < 1000; i++) game.effect('kick', i, 700);
  assert.equal(game.effects.length, 48);
  game.effect('goal', 2260, 700, '#fff', 3);
  assert.equal(game.effects.length, 48);
  assert.equal(game.effects.at(-1).type, 'goal');
});

const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} should match ${expected}`);
const advance=(game,seconds)=>{for(let left=seconds;left>1e-9;left-=.005)game.update(Math.min(.005,left));};
function match(extra={}){const game=new Game(null,{mode:'online',...extra});game.state.kickoff=null;for(const [index,p]of game.state.players.entries())Object.assign(p,{x:index%2?950:250,y:index%2?550:150});return game;}

test('player walking and carrying use exactly one 85 percent motion multiplier',()=>{
 for(const carrying of [false,true]){
  const game=match(),p=game.localPlayer();if(carrying)game.setOwner(p);const x=p.x;game.setInput(p.id,{keys:{d:true}});advance(game,.5);
  near(p.x-x,194*(carrying?.8:1)*.5*.85);near(game.state.elapsed,.5);near(game.state.time,299.5);
 }
});

test('dash travel retains its complete range at 85 percent speed with movement windows derived from travel duration',()=>{
 const game=match(),p=game.localPlayer(),x=p.x;game.dash(p,1,0,240,.6,{dribble:true,invincible:true});
 near(game.motionSeconds(1),.85);near(game.motionDuration(.6),.6/.85);near(p.dribble,.6/.85);near(p.invincible,.6/.85);
 advance(game,.3);near(p.x-x,240*.3/.6*.85);assert.ok(p.motion);
 advance(game,.6/.85-.3+.001);near(p.x-x,240);assert.equal(p.motion,null);assert.equal(p.dribble,0);assert.equal(p.invincible,0);
});

test('ground, curved and airborne balls follow the original physical path at exactly 85 percent travel time',()=>{
 for(const properties of [{z:0,vz:0,curve:0},{z:12,vz:235,curve:0},{z:12,vz:235,curve:.3}]){
  const paced=match(),reference=match();reference.motionSeconds=seconds=>seconds;
  const state={x:300,y:150,vx:340,vy:35,owner:null,lastKickTeam:0,power:40,pickupDelay:0,...properties};
  Object.assign(paced.state.ball,state);Object.assign(reference.state.ball,state);
  paced.state.keepers.forEach(k=>k.holding=999);reference.state.keepers.forEach(k=>k.holding=999);
  for(let i=0;i<50;i++){paced.updateBall(.01);reference.updateBall(.01*.85);}
  for(const key of ['x','y','z','vx','vy','vz'])near(paced.state.ball[key],reference.state.ball[key]);
  assert.ok(paced.state.ball.x<300+340*.5,'travel is slower without weakening the ball’s authored launch power');
 }
});

test('ball launch and gravity apply pace once, including throws and airborne team passes',()=>{
 const game=match({gameFormat:'standard-2v2'}),[p,,mate]=game.state.players;Object.assign(p,{x:300,y:350});Object.assign(mate,{x:600,y:350});game.setOwner(p);
 assert.equal(game.pass(p,mate,{air:true,power:55}),true);const b=game.state.ball,start={x:b.x,y:b.y,z:b.z,vx:b.vx,vy:b.vy,vz:b.vz};
 game.state.keepers.forEach(k=>k.holding=999);game.updateBall(.01);near(b.x-start.x,start.vx*.01*.85);near(b.vz,start.vz-440*.01*.85);assert.ok(b.z>start.z);
 const thrown=match(),keeper=thrown.state.keepers[0];thrown.keeperCatch(keeper);advance(thrown,1.99);assert.equal(thrown.state.ball.owner,keeper.id);
 advance(thrown,.02);assert.equal(thrown.state.ball.finish.source,'distribution');const launch={x:thrown.state.ball.x,vx:thrown.state.ball.vx};thrown.updateBall(.01);near(thrown.state.ball.x-launch.x,launch.vx*.01*.85);
});

test('scripted scoring flight is paced while clock, charge, cooldown and windup remain real-time',()=>{
 const scripted=match(),p=scripted.localPlayer();scripted.setOwner(p);scripted.guaranteedGoal(p);const shot=scripted.state.ball.scriptedGoal,from={...shot.from},to={...shot.to};
 scripted.updateBall(.2);near(scripted.state.ball.x,from.x+(to.x-from.x)*(.2*.85/.55));assert.equal(scripted.state.phase,'play');
 scripted.updateBall(.55/.85-.2+.001);assert.equal(scripted.state.phase,'celebrate');
 const game=match({character:'powershooter'}),striker=game.localPlayer();game.setOwner(striker);striker.cooldowns[1]=10;striker.dribbleCd=2;striker.ability={auraLeft:10};game.startShot();game.update(.001);advance(game,.25);
 near(striker.charge,5+12.5*.25);near(striker.cooldowns[1],10-.251);near(striker.dribbleCd,2-.251);near(striker.ability.auraLeft,10-.251);near(game.state.time,300-.251);
 game.suspendControls();game.useSkill(1);game.update(.001);assert.equal(game.shotMeter(striker).power,45);advance(game,.5);near(striker.shotWindup.left,.5);assert.equal(game.state.ball.owner,striker.id);advance(game,.501);assert.equal(game.state.ball.power,45);assert.equal(striker.ultraCharge,1);
});

test('free aiming draws neither a crosshair nor an aim ray over the pitch',()=>{
 const arcs=[],lines=[],ctx=new Proxy({arc:(...args)=>arcs.push(args),lineTo:(...args)=>lines.push(args)},{get:(object,key)=>object[key]||(()=>{})});
 const game=new Game({width:1200,height:700,getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:1200,height:700})},{mode:'online'});game.state.kickoff=null;game.setOwner(game.localPlayer());game.effects=[];game.localInput.aim={x:743,y:417};game.inputs[game.localPlayerId].aim={x:743,y:417};
 for(const method of ['drawCachedPitch','drawPlayer','drawBall','drawShotPower'])game[method]=()=>{};
 game.render();assert.equal(arcs.length,0);assert.equal(lines.length,0);
});
