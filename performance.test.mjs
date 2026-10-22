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
