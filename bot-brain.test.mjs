import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.js';
import { ROSTER, getSkills } from './characters.js?v=7';
import { BOT_CHARACTER_IDS, selectBotCharacter, botSkillChoices, chooseBotAim, updateBotPlayer } from './bot-brain.js';

function fixture(character, { own = true, team = true, awake = false, mode, x = 600, enemyX = 700, enemyY = 350, mateCharacter = 'ice', ability = {}, held = 12 } = {}) {
  const players = [{ id: 0, team: 0, character, name: 'CPU', isBot: true }, { id: 1, team: 1, character: 'manmarker', name: 'Human', isBot: false }];
  if (team) players.push({ id: 2, team: 0, character: mateCharacter, name: 'Mate', isBot: false }, { id: 3, team: 1, character: 'powershooter', name: 'Other', isBot: false });
  const game = new Game(null, { mode: 'bot', gameFormat: 'custom', players, localPlayerId: 1, botRandom: () => .4 });
  game.updateBot = () => {};
  game.state.kickoff = null; game.state.elapsed = 20;
  const p = game.state.players[0], enemy = game.state.players[1], mate = game.state.players.find(q => q.id === 2);
  Object.assign(p, { x, y: 350, awakened: awake, awakeningLeft: awake ? 50 : 0, ability: { ...ability }, cooldowns: [0, 0, 0, 0, 0] });
  Object.assign(enemy, { x: enemyX, y: enemyY });
  if (mate) Object.assign(mate, { x: x + 180, y: 430 });
  Object.assign(game.state.ball, { owner: own ? p.id : mode === 'mate' ? mate?.id : mode === 'enemy' ? enemy.id : null, x: x + 80, y: 350, z: mode === 'air' ? 18 : 0, lastKickTeam: mode === 'recent' ? 1 : null, lastKickAgo: mode === 'recent' ? .3 : 99, distribution: mode === 'distribution' ? { team: 0, age: 1, landedAge: .2 } : null });
  p.possessionAge = held; p.possessionStartedAt = game.state.elapsed - held;
  return { game, p, enemy, mate };
}

const cases = [
  ['manmarker', 0, { own: false, mode: 'enemy' }], ['manmarker', 1, { own: false, mode: 'enemy' }], ['manmarker', 2, { own: false, mode: 'enemy', awake: true }],
  ['ice', 0, {}], ['ice', 1, {}], ['ice', 2, { awake: true }],
  ['powershooter', 0, {}], ['powershooter', 1, { own: false, mode: 'enemy' }], ['powershooter', 0, { own: false, awake: true }], ['powershooter', 2, { awake: true }],
  ['ninja', 0, { own: false, mode: 'enemy' }], ['ninja', 1, {}], ['ninja', 2, { awake: true }],
  ['falcon', 0, { own: false, mode: 'air' }], ['falcon', 1, { own: false }], ['falcon', 2, {}], ['falcon', 0, { awake: true }], ['falcon', 2, { awake: true }],
  ['playmaker', 0, { own: false }], ['playmaker', 1, {}], ['playmaker', 2, {}], ['playmaker', 2, { own: false, mode: 'mate' }], ['playmaker', 0, { awake: true }], ['playmaker', 1, { awake: true }], ['playmaker', 2, { awake: true }],
  ['streetdribbler', 0, {}], ['streetdribbler', 1, {}], ['streetdribbler', 2, {}], ['streetdribbler', 0, { awake: true }], ['streetdribbler', 2, { awake: true }],
  ['magician', 0, {}], ['magician', 1, {}], ['magician', 2, {}], ['magician', 0, { awake: true, x: 400, enemyX: 500 }], ['magician', 1, { awake: true }], ['magician', 1, { awake: true, own: false }], ['magician', 2, { awake: true }],
  ['trapper', 0, {}], ['trapper', 1, {}], ['trapper', 2, { ability: { fakeVolleyStreak: 3 } }], ['trapper', 0, { own: false }], ['trapper', 0, { awake: true }], ['trapper', 0, { awake: true, own: false }], ['trapper', 1, { awake: true }], ['trapper', 1, { awake: true, own: false, mode: 'recent' }], ['trapper', 2, { awake: true, own: false, mode: 'recent' }],
  ['supersonic', 0, {}], ['supersonic', 1, { own: false, mode: 'enemy' }], ['supersonic', 2, { own: false }], ['supersonic', 0, { awake: true }], ['supersonic', 1, { awake: true, own: false, mode: 'enemy' }], ['supersonic', 2, { awake: true, own: false, mode: 'recent' }], ['supersonic', 3, { awake: true, ability: { onBallAwakening: true } }],
  ['serpent', 0, { own: false }], ['serpent', 1, { own: false, mode: 'enemy' }], ['serpent', 2, { own: false }], ['serpent', 0, { awake: true, own: false }], ['serpent', 1, { awake: true, own: false, mode: 'distribution' }],
  ['butterflydancer', 0, {}], ['butterflydancer', 1, {}], ['butterflydancer', 1, { own: false }], ['butterflydancer', 2, {}], ['butterflydancer', 0, { awake: true, own: false, mode: 'enemy' }], ['butterflydancer', 0, { awake: true, x: 400, ability: { ownHalfHeld: 6 } }], ['butterflydancer', 1, { awake: true }], ['butterflydancer', 2, { awake: true }],
  ['emperor', 0, {}], ['emperor', 1, {}], ['emperor', 2, { own: false, mode: 'air' }], ['emperor', 0, { awake: true }], ['emperor', 1, { awake: true, own: false, mode: 'enemy' }], ['emperor', 2, { awake: true, own: false, mode: 'air' }], ['emperor', 3, { awake: true }],
  ['emperor', 3, { own: false, mode: 'mate', mateCharacter: 'magician', ability: { chemicalPartnerId: 2 } }], ['emperor', 4, { awake: true, own: false, mode: 'mate', mateCharacter: 'magician', ability: { chemicalPartnerId: 2 } }], ['magician', 3, { mateCharacter: 'emperor', ability: { chemicalPartnerId: 2 } }],
];

for (const [character, slot, options] of cases) test(`bot contextual move ${character} slot${slot + 1} ${options.awake ? 'awakened' : 'base'} ${options.mode || 'on-ball'}`, () => {
  const { game, p } = fixture(character, options);
  const choice = botSkillChoices(game, p).find(candidate => candidate.slot === slot);
  assert.ok(choice, `Missing valid contextual move ${character} ${slot}`);
  p.aim = choice.aim || chooseBotAim(game, p, () => .4);
  assert.equal(game.activateMeteredSkill(p, slot), true, `actual engine accepted ${choice.name}`);
});

test('every roster character can be selected by a bounded uniform random slot', () => {
  assert.deepEqual(BOT_CHARACTER_IDS, ROSTER.map(p => p.id));
  assert.equal(BOT_CHARACTER_IDS.length, 14);
  for (let i = 0; i < 14; i++) assert.equal(selectBotCharacter(() => (i + .5) / 14), ROSTER[i].id);
  for (const value of [-1, 0, 1, Infinity, NaN]) assert.ok(BOT_CHARACTER_IDS.includes(selectBotCharacter(() => value)));
});

test('bots do not request team-only moves in a genuine 1v1', () => {
  for (const character of ['ice', 'magician', 'playmaker', 'serpent', 'emperor']) {
    const { game, p } = fixture(character, { team: false });
    const choices = botSkillChoices(game, p);
    for (const choice of choices) {
      assert.doesNotMatch(choice.name, /chemistry|Pass Cast|My Assist|Beautiful pass|Take The Bait|lackey/i);
      p.aim = choice.aim || chooseBotAim(game, p, () => .3);
    }
  }
});

test('cooldowns, once-only use and all control gates prevent invalid bot ability spam', () => {
  const { game, p } = fixture('emperor', { awake: true });
  p.ability = { emperorBicycleUsed: true, magnusUsed: true };
  p.cooldowns = [0, 0, 0, 0, 0];
  assert.equal(botSkillChoices(game, p).some(choice => [0, 3].includes(choice.slot)), false);
  for (const change of [() => { p.stun = 1; }, () => { p.recovery = 1; }, () => { p.motion = { left: 1 }; }, () => { p.charging = true; }, () => { game.state.phase = 'cutscene'; }, () => { game.state.kickoff = { team: 1 }; }]) {
    Object.assign(p, { stun: 0, recovery: 0, motion: null, charging: false }); game.state.phase = 'play'; game.state.kickoff = null;
    change(); assert.deepEqual(botSkillChoices(game, p), []);
  }
  Object.assign(p, { stun: 0, recovery: 0, motion: null, charging: false }); game.state.phase = 'play'; game.state.kickoff = null;
  p.awakened = false; p.cooldowns = [20, 20, 20, 20, 20]; p.ability = {};
  assert.deepEqual(botSkillChoices(game, p), []);
});

test('valid follow-up moves remain eligible during their original shared cooldown', () => {
  for (const [character, slot, ability] of [['ninja', 1, { precisionFollowup: 3 }], ['streetdribbler', 1, { rouletteFollowup: 3 }], ['trapper', 1, { heelFollowup: 3 }], ['emperor', 1, { emperorFollowup: 3 }], ['magician', 0, { placementFollowup: 3 }], ['supersonic', 1, { pinpointFollowup: 3 }], ['butterflydancer', 1, { butterflyFollowup: 3 }]]) {
    const { game, p } = fixture(character, { ability }); p.cooldowns[slot] = 20;
    assert.ok(botSkillChoices(game, p).some(choice => choice.slot === slot && choice.followup), `${character} follow-up remains usable`);
  }
});

test('bot aim chooses the open goal side instead of driving straight at the keeper', () => {
  const { game, p } = fixture('none');
  const keeper = game.state.keepers[1]; keeper.y = 410;
  assert.ok(chooseBotAim(game, p, () => .5).y < 320);
  keeper.y = 280;
  assert.ok(chooseBotAim(game, p, () => .5).y > 380);
});

test('every eligible awakening is requested through the normal host input path', () => {
  for (const character of ROSTER.filter(q => q.awakening)) {
    const own = character.awakening.requires !== 'off-ball';
    const { game, p } = fixture(character.id, { own, mode: own ? undefined : 'enemy' });
    p.awakeningCharge = 100; game.state.awakeningOwner = p.id;
    updateBotPlayer(game, p, .01);
    assert.ok(game.pending[p.id].some(([action]) => action === 'awaken'), character.id);
    game.update(.01);
    assert.equal(p.awakened, true, character.id);
    assert.equal(game.state.phase, 'cutscene');
  }
});

test('on-ball and off-ball awakening requirements are never bypassed', () => {
  for (const [character, own] of [['ninja', false], ['powershooter', false], ['manmarker', true], ['playmaker', true], ['serpent', true]]) {
    const { game, p } = fixture(character, { own, mode: own ? undefined : 'enemy' });
    p.awakeningCharge = 100; game.state.awakeningOwner = p.id;
    updateBotPlayer(game, p, .01);
    assert.equal(game.pending[p.id].some(([action]) => action === 'awaken'), false, character);
  }
});

test('normal shots and earned explicit Ultras retain moving charge and release decisions', () => {
  for (const ultraCharge of [0, 2, 3]) {
    const { game, p } = fixture('none', { team: false, x: 650, enemyX: 950 });
    p.ultraCharge = ultraCharge;
    updateBotPlayer(game, p, .01);
    assert.equal(game.inputs[p.id].shootHeld, true);
    assert.equal(game.inputs[p.id].ultraShot, ultraCharge === 3);
    assert.ok(Object.values(game.inputs[p.id].keys).some(Boolean), 'the bot keeps moving while charging');
    Object.assign(p, { charging: true, charge: 30 });
    updateBotPlayer(game, p, .01);
    assert.deepEqual(game.pending[p.id].at(-1), ['shoot', ultraCharge === 3]);
    assert.equal(game.inputs[p.id].shootHeld, false);
  }
});

test('bot skill choice is throttled and still executes actual validated ability mechanics', () => {
  const { game, p } = fixture('playmaker', { own: false, mode: 'enemy', team: false });
  updateBotPlayer(game, p, .01);
  assert.equal(game.pending[p.id].filter(([kind]) => kind === 'skill').length, 1);
  for (let i = 0; i < 10; i++) updateBotPlayer(game, p, .01);
  assert.equal(game.pending[p.id].filter(([kind]) => kind === 'skill').length, 1);
  game.update(.01);
  assert.ok(p.cooldowns[0] > 39);
  assert.ok(p.ability.observationLeft > 9);
});

test('a protected scripted ball never triggers a fake interception ability', () => {
  const { game, p } = fixture('trapper', { own: false, awake: true, mode: 'recent' });
  for (const flag of ['magnusFlight', 'scriptedGoal', 'perfectPass', 'unstoppableAir']) {
    game.state.ball[flag] = true;
    assert.deepEqual(botSkillChoices(game, p), []);
    game.state.ball[flag] = false;
  }
});

test('all fourteen bot styles run credential-free real engine updates without invalid states or unlimited ability requests', () => {
  for (const character of BOT_CHARACTER_IDS) {
    const { game, p } = fixture(character, { team: false, own: true, enemyX: 800 });
    game.updateBot = dt => updateBotPlayer(game, p, dt);
    for (let i = 0; i < 600; i++) {
      game.update(1 / 30);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), character);
      assert.ok(p.cooldowns.every(value => Number.isFinite(value) && value >= 0), character);
      assert.ok(game.tasks.length < 30, character);
      assert.ok(game.pending[p.id].length < 4, character);
    }
  }
});

test('integrated bot-2v2 constructor independently picks all three CPU styles and preserves an explicit opponent style', () => {
  const expected = ['magician', 'emperor', 'ice'];
  let calls = 0;
  const game = new Game(null, { mode: 'bot', gameFormat: 'bot-2v2', character: 'ninja', botRandom: () => (BOT_CHARACTER_IDS.indexOf(expected[calls++]) + .5) / BOT_CHARACTER_IDS.length });
  assert.equal(calls, 3);
  assert.equal(game.state.players[0].character, 'ninja');
  assert.deepEqual(game.state.players.filter(p => p.isBot).map(p => p.character), expected);
  const explicit = new Game(null, { mode: 'bot', gameFormat: 'bot-2v2', opponentCharacter: 'falcon', botRandom: () => { throw new Error('Explicit characters do not require a random selection'); } });
  assert.deepEqual(explicit.state.players.filter(p => p.isBot).map(p => p.character), ['falcon', 'falcon', 'falcon']);
});

test('integrated Game bot awakens then queues, validates and completes its real awakened cinematic kick', () => {
  const { game, p } = fixture('ninja', { own: true, team: false, x: 650, enemyX: 1050 });
  delete game.updateBot;
  p.awakeningCharge = 100; game.state.awakeningOwner = p.id;
  game.update(.01);
  assert.equal(p.awakened, true);
  assert.equal(game.state.phase, 'cutscene');
  assert.equal(game.state.cutscene.lines[0], ROSTER.find(character => character.id === 'ninja').awakening.quotes[0]);
  for (let frame = 0; game.state.phase === 'cutscene' && frame < 120; frame++) game.update(1 / 30);
  assert.equal(game.state.phase, 'play');
  p.cooldowns = [999, 999, 0, 999, 999];
  game.botBrains[p.id].skillThink = 0;
  game.update(.01);
  assert.equal(p.ability.knuckleUsed, true, 'the actual normal input pipeline spends the once-only awakened move');
  assert.equal(game.state.phase, 'cutscene');
  assert.equal(game.state.cutscene.lines[0], 'Oops, you guessed wrong');
  assert.equal(p.shotsTaken, 0, 'the kick waits for its cinematic instead of skipping the windup');
  for (let frame = 0; game.state.phase === 'cutscene' && frame < 90; frame++) game.update(1 / 30);
  assert.equal(p.shotsTaken, 1);
  assert.equal(game.state.ball.lastTouch, p.id);
  assert.equal(game.state.ball.owner, null);
  assert.equal(game.state.ball.knuckle, true);
  assert.equal(game.state.ball.power, 65);
  assert.equal(p.ultraCharge, 1);
});

test('integrated Game bots move and release normal shots or explicitly earned Ultras through the host simulation', () => {
  for (const ultraCharge of [0, 3]) {
    const { game, p } = fixture('none', { own: true, team: false, x: 650, enemyX: 1050 });
    delete game.updateBot;
    const kicks = [];
    game.options.onEvent = event => { if (event.type === 'kick') kicks.push(event); };
    p.ultraCharge = ultraCharge;
    const start = { x: p.x, y: p.y };
    for (let frame = 0; kicks.length === 0 && frame < 150; frame++) game.update(1 / 30);
    assert.equal(kicks.length, 1);
    assert.ok(Math.hypot(p.x - start.x, p.y - start.y) > 20, 'charging has real paced player movement');
    assert.equal(kicks[0].fromF, ultraCharge === 3);
    assert.equal(p.ultraCharge, ultraCharge === 3 ? 0 : 1);
    assert.equal(p.shotsTaken, 1);
    assert.equal(game.state.ball.owner, null);
  }
});
