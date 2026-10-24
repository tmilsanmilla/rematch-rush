import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ROSTER, getSkills } from './characters.js';
import { normalizeRoomConfig } from './online.js';

function appHarness() {
  const nodes = new Map(), listeners = new Map(), intervals = new Map();
  const sessions = [], games = [];
  let timerId = 0;
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', hidden: true, disabled: false, value: '', isConnected: true, style: {}, dataset: {}, attrs: {},
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute(name, value) { this.attrs[name] = value; }, addEventListener() {},
      focus() { this.focused = true; },
      querySelector: node, querySelectorAll: () => [],
    });
    return nodes.get(selector);
  };
  const document = {
    querySelector: node, querySelectorAll: () => [],
    addEventListener(type, listener) { listeners.set(type, listener); },
    body: { classList: { toggle() {} }, style: {} },
  };
  const context = {
    document, ROSTER, getSkills,
    OnlineSession: class {
      constructor(options) { this.options = options; this.role = 'host'; this.closed = false; this.starts = 0; sessions.push(this); }
      queue(...args) { this.queued = args; return new Promise((resolve, reject) => { this.resolveQueue = resolve; this.rejectQueue = reject; }); }
      async create(...args) { this.created = args; this.roomCode = 'AB12'; return this.roomCode; }
      async join(...args) { this.joined = args; this.roomCode = args[0]; return this.roomCode; }
      close() { this.closed = true; }
      startRound() { this.starts++; return true; }
      markRoundEnded() { this.ended = true; }
      requestRematch() { this.requested = true; return true; }
      sendState() {}
      sendInput() {}
    },
    Game: class {
      constructor(canvas, options) { this.options = options; this.localInput = {}; this.state = state(options.character); this.state.phase = 'play'; games.push(this); }
      start() { this.running = true; }
      stop() { this.running = false; }
      getState() { return this.state; }
      exportState() { return this.state; }
      setInput() {}
    },
    window: { addEventListener() {}, scrollTo() {}, dispatchEvent() { throw new Error('UI actions must use the game API.'); } },
    localStorage: { getItem: () => null, setItem() {} },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout: () => 0, clearTimeout() {},
    setInterval(callback) { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); }, performance: { now: () => 0 },
  };
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  runInNewContext(`${source}\nglobalThis.uiHarness = { updateHUD, renderPlaybook, spinRarity, SPIN_ODDS, GAME_FORMATS, newOnlineSession, matchEnded, updateRematchStatus, setGame(value) { game = value; currentScreen = 'game'; }, setLocalTeam(value) { localTeam = value; localPlayerId = value; }, setLocalPlayerId(value) { localPlayerId = value; }, resetHUD() { hudSignature = null; } };`, context);
  return {
    ...context.uiHarness, node, sessions, games,
    click(action, key, detail = 0, character, format, spin) {
      const button = { dataset: { action, key, character, format, spin } };
      listeners.get('click')({ target: { closest: () => button }, detail });
    },
    shotPointer(type, pointerId = 1, action = 'shoot') {
      const button = { dataset: { action }, setPointerCapture() {} };
      listeners.get(type)({ target: { closest: () => button }, button: 0, pointerId, preventDefault() {} });
    },
    change(id, value) {
      const target = node(`#${id}`); target.id = id; target.value = value;
      listeners.get('change')({ target });
    },
    finishSpin() {
      for (let tick = 0; tick < 20 && intervals.size; tick++) [...intervals.values()].forEach(callback => callback());
      assert.equal(intervals.size, 0, 'spin animation finishes');
    },
  };
}

function state(character = 'none') {
  return {
    score: [0, 0], time: 300, ball: { owner: null },
    players: [{ id: 0, team: 0, character, charge: 0, cooldowns: [0, 0, 0, 0] }],
  };
}

test('fresh and later Characterless matches render an honest HUD without stale character moves', () => {
  const app = appHarness();
  app.setGame({});
  app.updateHUD(state());
  assert.match(app.node('#ability-list').innerHTML, /No character abilities/);
  assert.match(app.node('#ability-list').innerHTML, /data-action="tackle"/);
  app.resetHUD();
  app.updateHUD(state('powershooter'));
  assert.match(app.node('#ability-list').innerHTML, /Power shot/);
  app.resetHUD();
  app.updateHUD(state());
  assert.doesNotMatch(app.node('#ability-list').innerHTML, /Power shot/);
  assert.match(app.node('#ability-list').innerHTML, /No character abilities/);
});

test('the local power HUD retains the released shot strength instead of immediately resetting to five', () => {
  const app = appHarness();
  app.setGame({shotMeter: () => ({power: 42, fill: .42, label: 'SHOT'})});
  const match = state();
  match.players[0].charge = 0;
  app.updateHUD(match);
  assert.equal(app.node('#charge-value').textContent, '42 / 100');
  assert.equal(app.node('#charge-fill').style.width, '42%');
});

test('every character shows separate normal shooting and an F Ultrashot charged by three kicks', () => {
  const app = appHarness(); app.setGame({});
  for (const character of ROSTER) {
    const match = state(character.id);
    app.updateHUD(match);
    const controls = app.node('#ultra-shot-control').innerHTML;
    assert.match(controls, /data-action="shoot"/);
    assert.match(controls, /data-action="ultrashot"/);
    assert.match(controls, /<kbd>F<\/kbd>/);
    assert.match(controls, /<b>Ultrashot<\/b>/);
    assert.equal(app.node('#ultra-shot-status').textContent, '3 KICKS TO ULTRA');
    for (const [charge, expected] of [[1, '2 KICKS TO ULTRA'], [2, '1 KICKS TO ULTRA'], [3, 'ULTRA READY · F'], [4, 'ULTRA READY · F']]) {
      match.players[0].ultraCharge = charge; app.updateHUD(match);
      assert.equal(app.node('#ultra-shot-status').textContent, expected);
    }
    match.players[0].ultraCharge = 0; app.updateHUD(match);
    assert.equal(app.node('#ultra-shot-status').textContent, '3 KICKS TO ULTRA', 'only an actual explicit Ultra resets the meter');
  }
});

test('normal and Ultrashot pointer controls use separate APIs and release once after capture loss', () => {
  const app = appHarness(), calls = [];
  app.setGame({
    startShot() { calls.push('normal-start'); return true; }, releaseShot() { calls.push('normal-release'); },
    startUltrashot() { calls.push('ultra-start'); return true; }, releaseUltrashot() { calls.push('ultra-release'); },
  });
  app.shotPointer('pointerdown', 4);
  app.shotPointer('pointerup', 4);
  app.shotPointer('lostpointercapture', 4);
  app.click('shoot', undefined, 1);
  assert.deepEqual(calls, ['normal-start', 'normal-release'], 'pointer click must not fire a second tap');
  app.click('shoot');
  assert.deepEqual(calls.slice(-2), ['normal-start', 'normal-release']);
  app.shotPointer('pointerdown', 5, 'ultrashot');
  app.shotPointer('pointerup', 5, 'ultrashot');
  app.shotPointer('lostpointercapture', 5, 'ultrashot');
  app.click('ultrashot', undefined, 1);
  assert.deepEqual(calls.slice(-2), ['ultra-start', 'ultra-release']);
  app.click('ultrashot');
  assert.deepEqual(calls.slice(-2), ['ultra-start', 'ultra-release']);
  app.shotPointer('pointerdown', 6, 'shoot'); app.shotPointer('pointercancel', 6, 'shoot');
  assert.deepEqual(calls.slice(-2), ['normal-start', 'normal-release']);
});

test('ability, tackle, and awakening buttons call the game directly and return focus to the pitch', () => {
  const app = appHarness(), calls = [];
  app.setGame({
    useSkill(slot) { calls.push(['skill', slot]); },
    useAction() { calls.push(['action']); },
    useAwakening() { calls.push(['awaken']); },
  });
  app.click('use-skill', '2'); app.click('tackle'); app.click('awaken');
  assert.deepEqual(calls, [['skill', 2], ['action'], ['awaken']]);
  assert.equal(app.node('#game-canvas').focused, true);
});

test('move cards show possession requirements and unavailable team moves in 1v1', () => {
  const app = appHarness(); app.setGame({});
  app.updateHUD(state('powershooter'));
  assert.match(app.node('#ability-list').innerHTML, /Needs the ball/);
  app.updateHUD(state('ninja'));
  assert.match(app.node('#ability-list').innerHTML, /Without the ball/);
  app.updateHUD(state('playmaker'));
  assert.match(app.node('#ability-list').innerHTML, /Team mode only/);
});

test('a ready awakening explains possession requirements across the roster', () => {
  const app=appHarness();app.setGame({});
  for(const [character,requirement] of [['manmarker','WITHOUT BALL'],['playmaker','WITHOUT BALL'],['powershooter','WITH BALL'],['streetdribbler','WITH BALL'],['supersonic','ANY TIME'],['ninja','WITH BALL'],['magician','WITH BALL'],['trapper','WITH BALL']]) {
    const ready=state(character);ready.players[0].awakeningCharge=100;
    app.updateHUD(ready);
    assert.match(app.node('#awakening-label').textContent,new RegExp(`READY · ${requirement} · E`));
  }
});

test('every spin result has Spin again and retains equip and roster controls, including duplicates', () => {
  const app = appHarness();
  app.click('spin');
  assert.equal(app.node('#modal .modal-close').disabled, true);
  assert.doesNotMatch(app.node('#modal-content').innerHTML, /data-action="spin-again"/);
  for (let spin = 0; spin < 5; spin++) {
    app.finishSpin();
    const result = app.node('#modal-content').innerHTML;
    assert.match(result, /data-action="spin-again"[^>]*>Spin again/);
    assert.match(result, /data-action="equip-reveal"/);
    assert.match(result, /Back to the roster/);
    assert.match(result, /Unlimited spins available/);
    assert.equal(app.node('#modal .modal-close').disabled, false);
    assert.equal(app.node('#spins-count').textContent, '∞');
    if (spin > 0) assert.match(result, /Duplicate character/);
    if (spin < 4) {
      app.click('spin-again');
      assert.equal(app.node('#modal .modal-close').disabled, true);
      assert.match(app.node('#modal-content').innerHTML, /id="spin-reel-name"/);
    }
  }
});

test('awakening owner zero is named, announced and remains visible with its active countdown', () => {
  const app = appHarness(); app.setGame({});
  const match = state('powershooter');
  Object.assign(match.players[0], { name: 'Striker', awakeningCharge: 100 });
  match.awakeningOwner = 0;
  match.awakeningNotice = { playerId: 0, name: 'Striker', team: 0, left: 4 };
  app.updateHUD(match);
  assert.equal(app.node('#awakening-status').hidden, false);
  assert.equal(app.node('#awakening-status').textContent, 'Striker · AWAKENING READY');
  assert.equal(app.node('#awakening-status').dataset.team, '0');
  assert.equal(app.node('#awakening-announcement').textContent, 'Striker gets awakening!');
  Object.assign(match.players[0], { awakeningCharge: 0, awakened: true, awakeningLeft: 34.2 });
  match.awakeningNotice.left = 0;
  app.updateHUD(match);
  assert.equal(app.node('#awakening-status').textContent, 'Striker · AWAKENING ACTIVE · 35s');
  assert.equal(app.node('#awakening-announcement').hidden, true);
  Object.assign(match.players[0], { awakened: false, awakeningLeft: 0 });
  match.awakeningOwner = null;
  app.updateHUD(match);
  assert.equal(app.node('#awakening-status').hidden, true);
  assert.equal(app.node('#awakening-status').textContent, '');
});

test('a rival awakening transfers the owner display and works with state from an online host', () => {
  const app = appHarness(); app.setGame({});
  const match = state();
  match.players.push({ id: 1, team: 1, name: 'Rival', character: 'manmarker', awakeningCharge: 100 });
  match.awakeningOwner = 1;
  match.awakeningNotice = { playerId: 1, name: 'Rival', team: 1, left: 3 };
  app.updateHUD(match);
  assert.equal(app.node('#awakening-status').textContent, 'Rival · AWAKENING READY');
  assert.equal(app.node('#awakening-status').dataset.team, '1');
  assert.equal(app.node('#awakening-announcement').textContent, 'Rival gets awakening!');
  delete match.awakeningOwner;
  app.updateHUD(match);
  assert.equal(app.node('#awakening-status').hidden, false);
  assert.equal(app.node('#awakening-status').textContent, 'Rival · AWAKENING READY');
});

test('online rematch keeps the same session and waits for both players before creating a fresh match', () => {
  for (const role of ['host', 'guest']) {
    const app = appHarness(), session = app.newOnlineSession();
    session.role = role;
    session.options.onConnected({role, localTeam: role === 'host' ? 0 : 1, remoteProfile: {username: 'Same rival', character: 'powershooter'}});
    const first = app.games[0]; first.state.phase = 'ended';
    app.matchEnded(first.state);
    assert.equal(session.ended, true);
    assert.match(app.node('#modal-content').innerHTML, /Same rival\. Same room\. No code needed/);
    app.click('rematch');
    assert.equal(session.requested, true);
    assert.equal(session.closed, false);
    assert.equal(app.games.length, 1, 'a vote alone must not restart the game');
    session.options.onRematchStatus({localReady: true, remoteReady: false});
    assert.equal(app.node('#rematch-button').disabled, true);
    assert.match(app.node('#rematch-status').textContent, /Waiting for your rival/);
    session.options.onRematchReady();
    assert.equal(app.sessions.length, 1, 'no new room or signaling connection is created');
    assert.equal(session.starts, 2);
    assert.equal(app.games.length, 2);
    assert.equal(app.games[1].options.opponentUsername, 'Same rival');
    assert.equal(app.games[1].options.mode, role === 'host' ? 'online' : 'guest');
    assert.equal(first.running, false);
    assert.equal(app.games[1].running, true);
    assert.equal(app.node('#modal').hidden, true);
  }
});

test('an incoming rematch request is visible before the local player consents', () => {
  const app = appHarness(); app.setGame({getState: () => ({phase: 'ended'})});
  app.updateRematchStatus({localReady: false, remoteReady: true});
  assert.equal(app.node('#rematch-button').disabled, false);
  assert.match(app.node('#rematch-status').textContent, /Your rival wants a rematch/);
});

test('only the credited scorer sees the skip button and its click uses the validated game API', () => {
  const app = appHarness(), calls = [];
  app.setGame({skipReplay(team) {calls.push(team);}});
  const match = state();
  for (const phase of ['celebrate', 'replay']) {
    Object.assign(match, {phase, scorerTeam: 0}); app.updateHUD(match);
    assert.equal(app.node('#skip-replay').hidden, false);
    match.scorerTeam = 1; app.updateHUD(match);
    assert.equal(app.node('#skip-replay').hidden, true);
  }
  app.setLocalTeam(1); match.players[0].team = 1; match.players[0].id = 1; app.updateHUD(match);
  assert.equal(app.node('#skip-replay').hidden, false);
  app.click('skip-replay'); assert.deepEqual(calls, [1]);
  match.phase = 'play'; app.updateHUD(match);
  assert.equal(app.node('#skip-replay').hidden, true);
});

test('new character previews show their own passive and awakening instead of borrowing Supersonic copy', () => {
  const app = appHarness();
  for (const id of ['ice', 'ninja', 'falcon', 'magician', 'trapper']) {
    const character = ROSTER.find(item => item.id === id);
    assert.ok(character, `${id} is selectable`);
    const preview = app.renderPlaybook(character);
    assert.match(preview, /Ultrashot/);
    assert.ok(preview.includes(character.awakening.name));
    if (character.passive) {
      assert.ok(preview.includes(character.passive.name));
      assert.doesNotMatch(preview, /50% faster, always/);
    }
  }
  const trapper = app.renderPlaybook(ROSTER.find(item => item.id === 'trapper'));
  assert.match(trapper, /DEATH TRAP/);
  assert.match(trapper, /Two-Stage Fake Volley/);
  assert.match(trapper, /Mid-Air Trap/);
});

test('clicking any locked character opens its moves without unlocking or equipping it', () => {
  const app = appHarness();
  const unlockedBefore = app.node('#roster-unlocked').textContent;
  for (const character of ROSTER.filter(item => item.id !== 'none')) {
    app.click('select-character', undefined, 0, character.id);
    assert.equal(app.node('#modal').hidden, false);
    const html = app.node('#modal-content').innerHTML;
    assert.ok(html.includes(`>${escapeMarkup(character.name)}</h2>`), `${character.name} has its own guide`);
    assert.match(html, /explore every move before unlocking/);
    assert.doesNotMatch(html, /data-action="equip-reveal"/);
    assert.equal(app.node('#equip-button').disabled, true);
    assert.equal(app.node('#roster-unlocked').textContent, unlockedBefore);
    app.click('close-modal');
    assert.equal(app.node('#modal').hidden, true);
  }
  app.click('play-bot');
  assert.equal(app.games[0].options.character, 'none', 'viewing the guide must preserve the equipped character');
});

const escapeMarkup = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function assertVisibleGuideMove(html, skill, label) {
  const heading = `<h4>${escapeMarkup(skill.name)}</h4>`;
  const cards = [...html.matchAll(/<article class="guide-move">([\s\S]*?)<\/article>/g)].map(match => match[1]).filter(card => card.includes(heading));
  assert.ok(cards.length, `${label}: ${skill.name} has a visible heading`);
  const explained = cards.find(card => card.includes(`<p>${escapeMarkup(skill.description)}</p>`));
  assert.ok(explained, `${label}: ${skill.name} explains its effect without hovering`);
  assert.ok(explained.includes(skill.once ? 'Once per awakening' : `${skill.cooldown}s cooldown`), `${label}: ${skill.name} shows its usage limit`);
}

test('every character guide visibly explains regular moves, possession variants, passives, and awakening moves', () => {
  const app = appHarness();
  for (const character of ROSTER.filter(item => item.id !== 'none')) {
    app.click('select-character', undefined, 0, character.id);
    const html = app.node('#modal-content').innerHTML;
    for (const awakened of [false, true]) {
      for (const hasBall of [false, true]) {
        for (const skill of getSkills(character.id, awakened, hasBall)) {
          assertVisibleGuideMove(html, skill, character.name);
        }
      }
    }
    assert.ok(html.includes(`Awakening · ${escapeMarkup(character.awakening.name)}`), `${character.name}: awakening is named`);
    assert.ok(html.includes(`<p>${escapeMarkup(character.awakening.description)}</p>`), `${character.name}: awakening effect is visible`);
    assert.ok(html.includes(`Lasts ${character.awakening.duration} seconds.`), `${character.name}: awakening duration is visible`);
    assert.match(html, /Press E when ready/);
    assert.match(html, /Moves that need a teammate are unavailable in 1v1/);
    if (character.passive) {
      assert.ok(html.includes(`Passive · ${escapeMarkup(character.passive.name)}`));
      assert.ok(html.includes(`<p>${escapeMarkup(character.passive.description)}</p>`));
    }
    assert.match(html, /Ultrashot · every character/);
    assert.match(html, /[Ee]very kick/);
    assert.match(html, /(?:hold|press) F/i);
    assert.doesNotMatch(html, /Every third shot becomes/);
  }
  for (const id of ['playmaker', 'magician', 'trapper', 'supersonic']) {
    app.click('select-character', undefined, 0, id);
    assert.match(app.node('#modal-content').innerHTML, /class="guide-condition">With the ball/);
    assert.match(app.node('#modal-content').innerHTML, /class="guide-condition">Without the ball/);
  }
});

test('character guides include follow-ups unlocked during play and explain reusing the move key', () => {
  const app = appHarness();
  const cases = [
    ['ninja', {precisionFollowup: 1}, ['Precision burst']],
    ['magician', {placementFollowup: 1}, ['Placement Over Power']],
    ['trapper', {heelFollowup: 1, fakeVolleyStreak: 3}, ['Direct Heel Drive', 'Juggling Destroyer Shot']],
    ['streetdribbler', {rouletteFollowup: 1}, ['Meta no prazo']],
    ['supersonic', {pinpointFollowup: 1}, ['PINPOINT 1-2']],
  ];
  for (const [id, ability, names] of cases) {
    app.click('select-character', undefined, 0, id);
    const html = app.node('#modal-content').innerHTML;
    assert.match(html, /Unlocked follow-ups/);
    assert.match(html, /Use the same move key again when its follow-up appears/);
    const variants = getSkills({character: id, ability}, false, true);
    for (const name of names) {
      const skill = variants.find(item => item.name === name);
      assert.ok(skill, `${name} is a real move`);
      assertVisibleGuideMove(html, skill, id);
    }
  }
});

test('Characterless guide explains the basic controls and never invents special moves or an awakening', () => {
  const app = appHarness();
  app.click('select-character', undefined, 0, 'none');
  const html = app.node('#modal-content').innerHTML;
  assert.match(html, /Characterless has no special moves/);
  assert.match(html, /movement, tackle \/ dribble, and Ultrashot/);
  assert.match(html, /This character has no awakening/);
  assert.doesNotMatch(html, /<article class="guide-move">|Unlocked follow-ups|Awakening ·/);
  app.click('close-modal');
  app.click('character-guide');
  assert.equal(app.node('#modal').hidden, false, 'the explicit guide button also works for the selected character');
  assert.match(app.node('#modal-content').innerHTML, /Characterless has no special moves/);
});

test('full-time results stay available until the player rematches or leaves', () => {
  const app = appHarness(), session = app.newOnlineSession();
  session.options.onConnected({role: 'host', localTeam: 0, remoteProfile: {username: 'Rival', character: 'none'}});
  const match = app.games[0]; match.state.phase = 'ended';
  app.matchEnded(match.state);
  assert.equal(app.node('#modal .modal-close').hidden, true);
  app.click('close-modal');
  assert.equal(app.node('#modal').hidden, false, 'closing must not strand a player without a rematch control');
  app.click('leave');
  assert.equal(app.node('#modal').hidden, true);
  assert.equal(session.closed, true);
});

test('the cursor-lock button uses the real lock API and reports confirmed browser state', () => {
  const app=appHarness(),calls=[];let locked=false;
  app.setGame({stop(){},isCursorLocked:()=>locked,requestCursorLock(){calls.push('lock');locked=true;},suspendControls(){calls.push('unlock');locked=false;}});
  app.click('cursor-lock');app.click('cursor-lock');assert.deepEqual(calls,['lock','unlock']);
  const session=app.newOnlineSession();session.options.onConnected({role:'host',localTeam:0,remoteProfile:{username:'Rival',character:'none'}});
  assert.equal(app.node('#cursor-lock-button').textContent,'Lock cursor');
  app.games[0].options.onCursorLockChange(true);assert.equal(app.node('#cursor-lock-button').textContent,'Unlock cursor');
  app.games[0].options.onCursorLockChange(false);assert.equal(app.node('#cursor-lock-button').textContent,'Lock cursor');
});


test('normal and lucky spin tiers use the exact Arrival of the Best odds', () => {
  const app = appHarness();
  assert.equal(JSON.stringify(app.SPIN_ODDS.normal), JSON.stringify([['common',44],['rare',30],['epic',15],['legendary',8.4],['world class',2.2],['master',.4]]));
  assert.equal(JSON.stringify(app.SPIN_ODDS.lucky), JSON.stringify([['rare',33],['epic',45],['legendary',13],['world class',7],['master',2]]));
  for (const type of ['normal','lucky']) {
    let start=0;
    for (const [rarity,chance] of app.SPIN_ODDS[type]) {
      assert.equal(app.spinRarity(type==='lucky',start+.00001),rarity);
      assert.equal(app.spinRarity(type==='lucky',start+chance-.00001),rarity);
      start+=chance;
    }
    assert.ok(Math.abs(start-100)<1e-10);
  }
  app.click('lucky-spin'); app.finishSpin();
  const html=app.node('#modal-content').innerHTML;
  assert.match(html,/Unlimited lucky spins available/);
  assert.match(html,/data-action="spin-again" data-spin="lucky"/);
  assert.doesNotMatch(html,/>COMMON</);
  app.click('spin-again',undefined,0,undefined,undefined,'lucky');app.finishSpin();
  assert.match(app.node('#modal-content').innerHTML,/Unlimited lucky spins available/);
});

test('match selection separates offline bot matches from queued online matches and code rooms', async () => {
  const app = appHarness(); app.click('match');
  const html = app.node('#modal-content').innerHTML;
  assert.match(html, />Offline /);
  assert.match(html, />Online /);
  for (const format of ['bot-standard', 'bot-2v2']) assert.match(html, new RegExp(`data-action="play-bot"[^>]*data-format="${format}"`));
  for (const format of ['standard-1v1', 'standard-2v2']) assert.match(html, new RegExp(`data-action="queue-online"[^>]*data-format="${format}"`));
  assert.match(html, /Create a room/);
  app.click('queue-online', undefined, 0, undefined, 'standard-2v2');
  assert.equal(app.sessions.length, 1);
  assert.equal(app.sessions[0].queued[2], 'standard-2v2', '2v2 enters actual matchmaking without opening a room-code form');
  assert.equal(app.sessions[0].created, undefined);
  assert.equal(app.sessions[0].joined, undefined);
  assert.match(app.node('#modal-content').innerHTML, /[Ss]earch|[Qq]ueue|[Mm]atchmaking/);
  assert.doesNotMatch(app.node('#modal-content').innerHTML, /id="created-room-code"|id="room-code-input"/);
  app.click('cancel-queue');
  assert.equal(app.sessions[0].closed, true);
  app.click('join-online');
  assert.match(app.node('#modal-content').innerHTML, /maxlength="4" minlength="4" pattern="\[A-Za-z0-9\]\{4\}"/);
});

test('both offline bot formats start immediately and an offline rematch retains the selected format', () => {
  for (const format of ['bot-standard', 'bot-2v2']) {
    const app = appHarness(); app.click('play-bot', undefined, 0, undefined, format);
    assert.equal(app.games[0].options.gameFormat, format);
    assert.equal(app.games[0].options.mode, 'bot');
    assert.equal(app.sessions.length, 0, 'offline modes need no room or signaling service');
    app.games[0].state.phase = 'ended'; app.matchEnded(app.games[0].state);
    app.click('rematch');
    assert.equal(app.games[1].options.gameFormat, format);
  }
});

test('a team guest HUD follows its own player rather than the first same-team player', () => {
  const app=appHarness();app.setGame({});app.setLocalTeam(0);app.setLocalPlayerId(2);
  const match=state('none');match.players[0].charge=12;
  match.players.push({id:2,team:0,character:'powershooter',charge:67,cooldowns:[],shotsTaken:2,ultraCharge:3,ability:{reactionReady:0,reactionPromptLeft:8,reactionPrompt:'Press 4 to confirm the chemical reaction.'}});
  app.updateHUD(match);
  assert.equal(app.node('#charge-value').textContent,'67 / 100');
  assert.match(app.node('#ability-list').innerHTML,/Power shot/);
  assert.equal(app.node('#ultra-shot-status').textContent,'ULTRA READY · F');
  assert.equal(app.node('#chemical-notice').hidden,false);
  assert.match(app.node('#chemical-notice').textContent,/Press 4/);
  Object.assign(match,{phase:'replay',scorer:0,scorerTeam:0});app.updateHUD(match);
  assert.equal(app.node('#skip-replay').hidden,true,'a teammate cannot skip someone else’s goal');
  match.scorer=2;app.updateHUD(match);assert.equal(app.node('#skip-replay').hidden,false);
});

test('team lobbies show the roster and host input uses the authenticated player slot', () => {
  const app=appHarness(),session=app.newOnlineSession();
  session.options.onLobby({gameFormat:'standard-2v2',connectedHumans:2,requiredHumans:4,players:[{id:0,team:0,name:'<Captain>',character:'none'},{id:1,team:1,name:'Opponent',character:'ice'}]});
  assert.match(app.node('#room-lobby').innerHTML,/2 \/ 4 players/);
  assert.match(app.node('#room-lobby').innerHTML,/&lt;Captain&gt;/);
  const inputs=[];app.setGame({setInput(...args){inputs.push(args);}});
  session.options.onInput({skill:4},3);
  assert.equal(inputs[0][0],3);assert.equal(inputs[0][1].skill,4);
});


test('leaving matchmaking closes the old session and ignores a late matched callback', () => {
  const app = appHarness();
  app.click('queue-online', undefined, 0, undefined, 'standard-1v1');
  const old = app.sessions[0];
  app.click('cancel-queue');
  old.options.onConnected({role:'host', localTeam:0, gameFormat:'standard-1v1', players:[{id:0,team:0,name:'Player'},{id:1,team:1,name:'Rival'}]});
  assert.equal(old.closed, true);
  assert.equal(app.games.length, 0, 'late queue delivery cannot pull a canceled player into a game');
  app.click('queue-online', undefined, 0, undefined, 'standard-2v2');
  assert.equal(app.sessions.length, 2);
  assert.equal(app.sessions[1].queued[2], 'standard-2v2');
});

test('a queue failure preserves the menu and exposes retry instead of room-code creation', async () => {
  const app = appHarness();
  app.click('queue-online', undefined, 0, undefined, 'standard-1v1');
  const session = app.sessions[0];
  session.rejectQueue(new Error('The matchmaking service could not be reached.'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.games.length, 0);
  assert.match(app.node('#room-status').innerHTML, /The matchmaking service could not be reached/);
  assert.match(app.node('#modal-content').innerHTML + app.node('#online-panel').innerHTML, /[Tt]ry again|[Rr]etry|queue-online/);
});

test('pass buttons stay visible, explain 1v1 unavailability, and enable for a same-team partner', () => {
  const app = appHarness(); let passes = 0; app.setGame({usePass(){passes++;}});
  const match = state(); app.updateHUD(match);
  for (const id of ['#pass-button', '#touch-pass-button']) {
    assert.equal(app.node(id).hidden, false);
    assert.equal(app.node(id).disabled, true);
    assert.match(app.node(id).title || '', /[Tt]eammate|[Tt]eam/);
  }
  match.players.push({id:2,team:0,character:'none',charge:0,cooldowns:[]}); app.updateHUD(match);
  assert.equal(app.node('#pass-button').disabled, false);
  assert.equal(app.node('#touch-pass-button').disabled, false);
  app.click('pass'); assert.equal(passes, 1);
});

test('the UI and simulation import the same character revision and team pass calls the engine', () => {
  const appSource=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const gameSource=readFileSync(new URL('./game.js',import.meta.url),'utf8');
  assert.equal(appSource.match(/characters\.js\?v=(\d+)/)[1],gameSource.match(/characters\.js\?v=(\d+)/)[1]);
  const app=appHarness();let passes=0;app.setGame({usePass(){passes++;}});app.click('pass');assert.equal(passes,1);
});


test('custom-room controls send the chosen human and bot roster and game settings without entering a queue', async () => {
  const app = appHarness(); app.click('online');
  const html = app.node('#modal-content').innerHTML;
  for (const id of ['room-slot-1', 'room-slot-2', 'room-slot-3', 'room-duration', 'room-score-limit']) assert.ok(html.includes(`id="${id}"`));
  app.change('room-slot-2', 'bot'); app.change('room-slot-1', 'human'); app.change('room-slot-3', 'bot');
  app.change('room-duration', '600'); app.change('room-score-limit', '5');
  assert.match(app.node('#custom-room-summary').textContent, /You \+ Bot vs Friend \+ Bot.*10 minutes.*First to 5/);
  app.click('create-room');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.sessions.length, 1);
  const session = app.sessions[0];
  assert.equal(session.created[2], 'custom');
  assert.equal(JSON.stringify(session.created[3]), JSON.stringify({slots:['human','human','bot','bot'],duration:600,scoreLimit:5}));
  assert.equal(session.queued, undefined);
  assert.match(app.node('#online-panel').innerHTML, /AB12/);
});

test('custom-room selection supports 1v1 and guards an empty opposing team', () => {
  const app = appHarness(); app.click('online');
  app.change('room-slot-2', 'empty'); app.change('room-slot-3', 'empty');
  assert.match(app.node('#custom-room-summary').textContent, /You vs Friend/);
  assert.equal(app.node('#create-room-button').disabled, false);
  app.change('room-slot-1', 'empty');
  assert.equal(app.node('#create-room-button').disabled, true);
  assert.match(app.node('#custom-room-summary').textContent, /Add a friend or bot to the red team/);
  app.change('room-slot-3', 'bot');
  assert.equal(app.node('#create-room-button').disabled, false);
  assert.match(app.node('#custom-room-summary').textContent, /You vs Bot/);
});

test('custom online settings and exact slot identities survive both initial start and same-room rematch', () => {
  for (const role of ['host', 'guest']) {
    const app = appHarness(), session = app.newOnlineSession(); session.role = role;
    const settings = {slots:['human','human','bot','bot'],duration:120,scoreLimit:3};
    const players = [
      {id:0,team:0,name:'You',character:'none',isBot:false},
      {id:1,team:1,name:'Friend',character:'ice',isBot:false},
      {id:2,team:0,name:'Blue bot',character:'powershooter',isBot:true},
      {id:3,team:1,name:'Red bot',character:'ninja',isBot:true},
    ];
    const localPlayerId = role === 'host' ? 0 : 1;
    session.options.onConnected({role, localTeam:localPlayerId, localPlayerId, gameFormat:'custom', settings, players,remoteProfile:{username:'Friend',character:'ice'}});
    assert.equal(app.games[0].options.gameFormat, 'custom');
    assert.equal(app.games[0].options.localPlayerId, localPlayerId);
    assert.equal(JSON.stringify(app.games[0].options.settings), JSON.stringify(settings));
    assert.equal(JSON.stringify(app.games[0].options.players), JSON.stringify(players));
    app.games[0].state.phase = 'ended'; app.matchEnded(app.games[0].state); app.click('rematch'); session.options.onRematchReady();
    assert.equal(app.games.length, 2);
    assert.equal(JSON.stringify(app.games[1].options.settings), JSON.stringify(settings));
    assert.equal(JSON.stringify(app.games[1].options.players), JSON.stringify(players));
    assert.equal(session.closed, false);
  }
});


test('every custom-game setting exposed by the UI is accepted by the actual online contract', () => {
  const app = appHarness(); app.click('online');
  const html = app.node('#modal-content').innerHTML;
  const options = id => [...html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))[1].matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  for (const duration of options('room-duration')) for (const scoreLimit of options('room-score-limit')) {
    assert.doesNotThrow(() => normalizeRoomConfig({slots:['human','human','bot','bot'],duration,scoreLimit}), `${duration}s / ${scoreLimit} goals is visible in the menu`);
  }
});

test('reopening an invalid custom roster keeps Create disabled until an opponent is selected', () => {
  const app = appHarness(); app.click('online');
  app.change('room-slot-1', 'empty'); app.change('room-slot-3', 'empty');
  app.click('close-modal'); app.click('online');
  const html = app.node('#modal-content').innerHTML;
  assert.match(html, /id="create-room-button"[^>]*\sdisabled(?:\s|>)/);
  assert.match(html, /id="custom-room-summary">Add a friend or bot to the red team\./);
  app.change('room-slot-1', 'human');
  assert.equal(app.node('#create-room-button').disabled, false);
  assert.match(app.node('#custom-room-summary').textContent, /Friend/);
});

test('matchmaking suppresses provisional room-code instructions while preserving real progress and errors', () => {
  const app = appHarness(); app.click('queue-online', undefined, 0, undefined, 'standard-2v2');
  const session = app.sessions[0];
  for (const type of ['connecting', 'waiting']) {
    session.options.onStatus({type,message:'Room AB12: 1/4 players. Share the code with your friends.'});
    assert.doesNotMatch(app.node('#room-status').innerHTML, /AB12|Share the code|Room/);
  }
  session.options.onStatus({type:'queue',message:'Searching for 2v2 players… 3/4 ready.'});
  assert.match(app.node('#room-status').innerHTML, /Searching for 2v2 players.*3\/4 ready/);
  session.options.onStatus({type:'waiting',message:'Room AB12: 3/4 players. Share the code with your friends.'});
  assert.match(app.node('#room-status').innerHTML, /Searching for 2v2 players.*3\/4 ready/);
  assert.doesNotMatch(app.node('#room-status').innerHTML, /AB12|Share the code/);
  session.options.onStatus({type:'error',message:'Matchmaking could not reach the service.'});
  assert.match(app.node('#room-status').innerHTML, /Matchmaking could not reach the service/);
});
