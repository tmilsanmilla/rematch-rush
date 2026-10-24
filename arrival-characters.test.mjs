import test from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER, getSkills, activateSkill, activateAwakening, tickAbilities } from './characters.js';

function fixture(character, team = 0, partner = 'none') {
  const players = Array.from({ length: 4 }, (_, id) => ({ id, name: `Player ${id}`, character: 'none', team: id % 2, x: id % 2 ? 900 : 300, y: 220 + Math.floor(id / 2) * 180, angle: id % 2 ? Math.PI : 0, aim: { x: id % 2 ? 0 : 1200, y: 350 }, ability: {}, cooldowns: [0, 0, 0, 0, 0], awakeningCharge: 100, recovery: 0, stun: 0, invincible: 0, dribble: 0 }));
  const p = players[team], enemy = players[1 - team], mate = players[team + 2];
  p.character = character; mate.character = partner;
  const tasks = [], shots = [], dashes = [], effects = [], goals = [], notices = [];
  const g = {
    width: 1200, height: 700, options: { mode: 'test' }, state: { players, ball: { owner: null, x: p.x + (team ? -30 : 30), y: p.y, z: 0 }, elapsed: 0, phase: 'playing', keepers: [{ y: 350 }, { y: 350 }] },
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y), hasBall: player => g.state.ball.owner === player.id,
    teammate: player => g.state.players.find(other => other.team === player.team && other.id !== player.id),
    setOwner(player) { player.lastReceivedFromId = g.state.ball.pass?.fromId ?? g.state.ball.lastTouch; Object.assign(g.state.ball, { owner: player.id, lastTouch: player.id, z: 0, pass: null }); },
    kick(player, power, options = {}) { assert(g.hasBall(player)); shots.push({ playerId: player.id, power, options }); Object.assign(g.state.ball, { owner: null, power, lastTouch: player.id, lastKickTeam: player.team, lastKickAgo: 0, z: options.air ? 20 : 0, vx: player.team ? -500 : 500, vy: 0, ...options }); },
    pass(from, to, options = {}) { const prior = from.aim; from.aim = { x: to.x, y: to.y }; g.kick(from, options.power || 55, options); from.aim = prior; Object.assign(g.state.ball, { passTarget: to.id, pass: { fromId: from.id, targetId: to.id, team: from.team } }); return true; },
    dash(player, dx, dy, distance, duration, options) { const data = { player, dx, dy, distance, duration, options }; dashes.push(data); player.motion = data; },
    effect(...args) { effects.push(args); }, notify(message) { notices.push(message); }, schedule(seconds, fn) { tasks.push({ at: g.state.elapsed + seconds, fn }); },
    cutscene(seconds, lines, color, fn) { tasks.push({ at: g.state.elapsed + seconds, fn }); },
    guaranteedGoal(player, options) { goals.push({ team: player.team, options }); g.state.ball.scriptedGoal = true; return true; },
  };
  function advance(seconds) {
    const until = g.state.elapsed + seconds;
    while (true) {
      tasks.sort((a, b) => a.at - b.at); const next = tasks[0];
      if (!next || next.at > until + 1e-9) break;
      tasks.shift(); g.state.elapsed = next.at; next.fn();
    }
    g.state.elapsed = until;
  }
  function awaken() { p.awakened = true; p.awakeningLeft = 75; p.ability.awakeningActive = true; }
  players.forEach(player => tickAbilities(g, player, 0));
  return { g, p, enemy, mate, players, shots, dashes, effects, goals, notices, advance, awaken };
}

test('Arrival roster and move guides expose the new rarities, variants and fifth reaction slot', () => {
  assert.equal(ROSTER.find(p => p.id === 'supersonic').rarity, 'master');
  for (const [id, rarity, duration] of [['serpent', 'epic', 50], ['butterflydancer', 'world class', 60], ['emperor', 'master', 75]]) {
    const definition = ROSTER.find(p => p.id === id); assert.equal(definition.rarity, rarity); assert.equal(definition.awakening.duration, duration);
  }
  assert.equal(getSkills('falcon')[1].cooldown, 20);
  assert.equal(getSkills('emperor', true, true)[4].name, 'Emperor’s lackey');
  assert.equal(getSkills('emperor', true, true)[4].key, '5');
  const { p } = fixture('emperor'); assert.equal(getSkills(p).length, 3);
});

for (const team of [0, 1]) {
  test(`Serpent header uses actual airtime power and preserves cooldown on invalid use, team ${team}`, () => {
    const f = fixture('serpent', team); f.g.setOwner(f.p);
    assert.equal(activateSkill(f.g, f.p, 0), false); assert.equal(f.p.cooldowns[0], 0);
    f.g.state.ball.owner = null; assert.equal(activateSkill(f.g, f.p, 0), true); assert.equal(f.shots.at(-1).power, 30);
    f.p.cooldowns[0] = 0; f.g.state.ball.z = 25;
    assert.equal(activateSkill(f.g, f.p, 0), true); assert.equal(f.shots.at(-1).power, 50);
  });
  test(`Charge Press beats a dribble after windup but is punished when the carrier releases, team ${team}`, () => {
    const f = fixture('serpent', team); f.g.setOwner(f.enemy); f.enemy.dribble = 2; f.enemy.invincible = 2;
    assert.equal(activateSkill(f.g, f.p, 1), true); assert.equal(f.g.state.ball.owner, f.enemy.id); assert.equal(f.p.recovery, 2);
    f.advance(2); assert.equal(f.g.state.ball.owner, f.p.id); assert.equal(f.enemy.stun, .75); assert.equal(f.p.cooldowns[1], 25);
    const miss = fixture('serpent', team); miss.g.setOwner(miss.enemy); activateSkill(miss.g, miss.p, 1); miss.g.state.ball.owner = null;
    miss.advance(2); assert.equal(miss.p.stun, 1); assert.equal(miss.g.state.ball.owner, null);
  });
  test(`Take The Bait marks the farthest opposing player and physically passes an interception, team ${team}`, () => {
    const f = fixture('serpent', team); const target = f.players[3 - team]; target.x = team ? 60 : 1140;
    assert.equal(activateSkill(f.g, f.p, 2), true); assert.equal(f.p.ability.baitTarget, target.id);
    Object.assign(f.g.state.ball, { owner: null, lastKickTeam: target.team, lastTouch: f.enemy.id, passTarget: target.id, vx: team ? -250 : 250, vy: 0 });
    tickAbilities(f.g, f.p, .02); assert.equal(f.p.ability.baitLeft, 0); assert.equal(f.g.state.ball.passTarget, f.mate.id); assert.equal(f.g.state.ball.lastTouch, f.p.id);
    f.g.state.players = [f.p, f.enemy]; f.p.cooldowns[2] = 0;
    assert.equal(activateSkill(f.g, f.p, 2), false); assert.equal(f.p.cooldowns[2], 0);
  });
  test(`Serpent awakening validates own goalkeeper landing and once-only finish, team ${team}`, () => {
    const f = fixture('serpent', team); f.awaken();
    assert.equal(activateSkill(f.g, f.p, 1), false); assert.equal(f.p.ability.serpentStrikerUsed, undefined);
    f.g.state.ball.distribution = { team: 1 - team, age: 2, landedAge: .1 }; assert.equal(activateSkill(f.g, f.p, 1), false);
    f.g.state.ball.distribution.team = team; assert.equal(activateSkill(f.g, f.p, 1), true); f.advance(2.6);
    assert.equal(f.shots.at(-1).power, 70); assert.equal(activateSkill(f.g, f.p, 1), false);
  });
  test(`Butterfly moves have real staged distances, follow-up and vulnerable chip, team ${team}`, () => {
    const f = fixture('butterflydancer', team); f.g.setOwner(f.p);
    assert.equal(activateSkill(f.g, f.p, 0), true); f.advance(1);
    assert.deepEqual(f.dashes.map(d => Math.round(d.distance)), [600, -400, 300]); assert.equal(f.p.butterflyWings, true);
    assert.equal(activateSkill(f.g, f.p, 1), true); assert.equal(getSkills(f.p, false, true)[1].name, 'Corte mariposa');
    assert.equal(activateSkill(f.g, f.p, 1), true); assert.equal(f.p.cooldowns[1], 30);
    f.p.motion = null; assert.equal(activateSkill(f.g, f.p, 2), true); assert.equal(f.p.invincible, 0); assert.equal(f.p.recovery, 1.5);
    f.g.state.ball.owner = f.enemy.id; f.advance(1.5); assert.equal(f.shots.length, 0);
    f.p.recovery = 0; f.p.cooldowns[2] = 0; f.g.setOwner(f.p); activateSkill(f.g, f.p, 2); f.advance(1.5);
    const shot = f.shots.at(-1); assert.equal(shot.power, 10); assert.equal(shot.options.unstoppableAir, true); assert.equal(f.g.state.ball.noFrictionFor, 5);
  });
  test(`Butterfly perfected destruction requires five seconds in own half and is once per awakening, team ${team}`, () => {
    const f = fixture('butterflydancer', team); f.awaken(); f.g.setOwner(f.p); f.p.possessionAge = 5;
    assert.equal(activateSkill(f.g, f.p, 0), false); assert.equal(f.p.ability.butterflyGoalUsed, undefined);
    tickAbilities(f.g, f.p, 5); assert.equal(activateSkill(f.g, f.p, 0), true); f.advance(4.2); assert.equal(f.goals.length, 1); assert.equal(f.goals[0].team, team);
    f.p.cooldowns[0] = 0; assert.equal(activateSkill(f.g, f.p, 0), false);
  });
  test(`Butterfly dancing grants exactly fifteen seconds then ten seconds cooldown, team ${team}`, () => {
    const f = fixture('butterflydancer', team); f.awaken(); f.g.setOwner(f.p);
    assert.equal(activateSkill(f.g, f.p, 2), true); assert.equal(f.p.ability.infiniteDribble, undefined); f.advance(1.6);
    assert.equal(f.p.ability.infiniteDribble, 15); tickAbilities(f.g, f.p, 14); assert.equal(f.p.dribbleCooldown, 0); assert.equal(f.p.cooldowns[2], 11);
    tickAbilities(f.g, f.p, 1); assert.equal(f.p.ability.infiniteDribble, 0); assert.equal(f.p.cooldowns[2], 10);
  });
  test(`Emperor impact is exposed and route follow-ups share cooldown, team ${team}`, () => {
    const f = fixture('emperor', team); f.g.setOwner(f.p);
    assert.equal(activateSkill(f.g, f.p, 0), true); assert.equal(f.p.recovery, .5); assert.equal(f.p.invincible, 0);
    f.advance(.5); assert.equal(f.shots.at(-1).power, 80); assert.equal(f.shots.at(-1).options.accuracy, 1);
    f.p.recovery = 0; assert.equal(activateSkill(f.g, f.p, 1), true); f.advance(.55); assert.equal(f.dashes.at(-1).distance, 300);
    f.g.setOwner(f.enemy); assert.equal(activateSkill(f.g, f.p, 1), true); assert.equal(f.enemy.stun, 1); assert.equal(f.p.cooldowns[1], 30); assert.equal(f.g.state.ball.passTarget, f.p.id); assert.equal(f.g.state.ball.owner, null);
  });
  test(`Chemical reaction needs both consents and interception never schedules a goal, team ${team}`, () => {
    const f = fixture('emperor', team, 'magician'); f.g.setOwner(f.mate);
    assert.equal(activateSkill(f.g, f.p, 3), true); assert.equal(f.shots.length, 0); assert.equal(f.p.cooldowns[3], 0);
    assert.match(f.mate.ability.reactionPrompt, /press 4/i);
    assert.equal(activateSkill(f.g, f.mate, 3), true); f.advance(.56); assert.equal(f.p.x, 600); assert.equal(f.g.state.ball.passTarget, f.p.id); assert.equal(f.shots.at(-1).options.air, true);
    f.g.setOwner(f.enemy); tickAbilities(f.g, f.p, .01); assert.equal(f.p.cooldowns[3], 45); assert.equal(f.mate.cooldowns[3], 45); assert.equal(f.goals.length, 0);
  });
  test(`Chemical reaction only scores after Emperor receives the physical pass, team ${team}`, () => {
    const f = fixture('emperor', team, 'magician'); f.awaken(); f.g.setOwner(f.mate);
    assert.equal(activateSkill(f.g, f.p, 4), true); assert.equal(activateSkill(f.g, f.mate, 3), true); f.advance(.56); assert.equal(f.goals.length, 0);
    f.g.setOwner(f.p); tickAbilities(f.g, f.p, .01); assert.equal(f.p.cooldowns[4], 90); assert.equal(f.mate.cooldowns[3], 90); assert.equal(f.p.ability.emperorChemistry, true);
    f.advance(1.8); assert.equal(f.goals.length, 1); assert.equal(f.goals[0].team, team); assert(f.effects.some(e => e[0] === 'rose'));
  });
  test(`Emperor awakening refreshes both reaction cooldowns and gates one-use moves, team ${team}`, () => {
    const f = fixture('emperor', team, 'magician'); f.g.setOwner(f.p); f.p.ability.reactionCooldown = 50; f.mate.ability.reactionCooldown = 50; f.mate.cooldowns[3] = 50;
    assert.equal(activateAwakening(f.g, f.p), true); assert.equal(f.p.awakeningLeft, 75); assert.equal(f.mate.cooldowns[3], 0); assert.equal(f.p.ability.reactionCooldown, 0); f.advance(3.4);
    f.enemy.x = f.p.x + (team ? -80 : 80); f.enemy.y = f.p.y;
    assert.equal(activateSkill(f.g, f.p, 0), true); f.advance(3.2); assert.equal(f.shots.at(-1).power, 95); assert.equal(f.shots.at(-1).options.accuracy, 1);
    f.g.setOwner(f.p); assert.equal(activateSkill(f.g, f.p, 0), false);
  });
}

test('Falcon Predator Eye moves at 1.5x speed and Skyward Volley waits after goalkeeper throws', () => {
  const f = fixture('falcon'); Object.assign(f.g.state.ball, { z: 20, distribution: { age: .49, team: 0 } });
  assert.equal(activateSkill(f.g, f.p, 0), false); assert.equal(f.p.cooldowns[0], 0);
  f.g.state.ball.distribution.age = .5; assert.equal(activateSkill(f.g, f.p, 0), true);
  f.g.state.ball.owner = null; f.p.cooldowns[1] = 0; assert.equal(activateSkill(f.g, f.p, 1), true); tickAbilities(f.g, f.p, .02);
  assert.equal(f.p.cooldowns[1], 20); assert.equal(f.p.motion.speed, 194 * 1.5);
});

test('Unstoppable butterfly chips cannot be trapped by aerial-counter characters', () => {
  for (const id of ['trapper', 'falcon', 'serpent', 'emperor']) {
    const f = fixture(id); Object.assign(f.g.state.ball, { owner: null, z: 40, unstoppableAir: true, lastKickTeam: 1, lastKickAgo: .1 });
    const slot = id === 'emperor' ? 2 : 0;
    const activated = activateSkill(f.g, f.p, slot);
    if (id === 'trapper') { assert.equal(activated, true); tickAbilities(f.g, f.p, .02); assert.equal(f.g.state.ball.owner, null); }
    else { assert.equal(activated, false); assert.equal(f.p.cooldowns[slot], 0); }
  }
});

test('remaining Arrival variants execute their specified finish, stun and airtime rules', () => {
  for (const team of [0, 1]) {
    const serpent = fixture('serpent', team); serpent.awaken();
    assert.equal(activateSkill(serpent.g, serpent.p, 0), true); serpent.advance(2.2); assert.equal(serpent.shots.at(-1).power, 65);
    const mio = fixture('butterflydancer', team); mio.awaken(); mio.g.setOwner(mio.enemy);
    assert.equal(activateSkill(mio.g, mio.p, 0), true); mio.advance(2); assert.equal(mio.g.state.ball.owner, mio.p.id); assert.equal(mio.enemy.stun, 3.5);
    const chip = fixture('butterflydancer', team); chip.awaken(); chip.g.setOwner(chip.p);
    assert.equal(activateSkill(chip.g, chip.p, 1), true); chip.advance(1.8); assert.equal(chip.shots.at(-1).power, 10); assert.equal(chip.g.state.ball.noFrictionFor, 3600); assert.equal(chip.g.state.ball.topspin, 1.8);
    const trap = fixture('butterflydancer', team); trap.g.state.ball.z = 25;
    assert.equal(activateSkill(trap.g, trap.p, 1), true); assert.equal(trap.g.state.ball.owner, trap.p.id); assert.equal(trap.dashes[0].distance, 400);
    const volley = fixture('emperor', team); volley.g.state.ball.z = 40;
    assert.equal(activateSkill(volley.g, volley.p, 2), true); assert.equal(volley.shots.at(-1).power, 75); assert.equal(volley.shots.at(-1).options.curve, .75);
    const perfected = fixture('emperor', team); perfected.awaken(); perfected.g.state.ball.z = 30;
    assert.equal(activateSkill(perfected.g, perfected.p, 2), true); assert.equal(perfected.shots.at(-1).power, 75); assert.equal(perfected.shots.at(-1).options.savePower, 98); assert.equal(perfected.p.cooldowns[2], 30);
    const move = fixture('emperor', team); move.awaken(); move.g.setOwner(move.mate); const origin = move.mate.y;
    assert.equal(activateSkill(move.g, move.p, 1), true); move.advance(2); assert.notEqual(move.mate.y, origin); assert.equal(move.shots.at(-1).power, 85); assert.equal(move.p.ability.emperorMoveUsed, true);
    const magnus = fixture('emperor', team); magnus.awaken(); magnus.g.setOwner(magnus.p);
    assert.equal(activateSkill(magnus.g, magnus.p, 3), true); magnus.advance(4.99); assert.equal(magnus.goals.length, 0); magnus.advance(.01); assert.equal(magnus.goals.length, 0); assert.equal(magnus.g.state.ball.magnusFlight, true); magnus.g.state.ball.x = team ? 100 : 1100; tickAbilities(magnus.g, magnus.p, .01); magnus.advance(2); assert.equal(magnus.goals[0].team, team); assert.equal(magnus.p.ability.magnusUsed, true);
  }
});

test('Emperor airborne volley from a teammate waits for an interceptable pass to arrive', () => {
  const f = fixture('emperor'); f.g.setOwner(f.mate);
  assert.equal(activateSkill(f.g, f.p, 2), true); assert.equal(f.shots.length, 1); assert.equal(f.shots[0].playerId, f.mate.id);
  f.g.setOwner(f.enemy); tickAbilities(f.g, f.p, .01); assert.equal(f.p.ability.emperorVolley, null); assert.equal(f.shots.length, 1);
  f.p.cooldowns[2] = 0; f.g.setOwner(f.mate); activateSkill(f.g, f.p, 2); f.g.setOwner(f.p); tickAbilities(f.g, f.p, .01);
  assert.equal(f.shots.at(-1).playerId, f.p.id); assert.equal(f.shots.at(-1).power, 75);
});

test('follow-ups cancel uncompleted earlier dash stages instead of replaying old movement', () => {
  const f = fixture('butterflydancer'); f.g.setOwner(f.p); activateSkill(f.g, f.p, 1); activateSkill(f.g, f.p, 1); f.advance(1);
  assert.equal(f.dashes.length, 3); // first weave, new quarter-field weave, vertical cut
  const emperor = fixture('emperor'); emperor.g.setOwner(emperor.p); activateSkill(emperor.g, emperor.p, 1); activateSkill(emperor.g, emperor.p, 1); emperor.advance(1);
  assert.equal(emperor.dashes.length, 1); assert.equal(emperor.shots.at(-1).power, 70);
});

test('invalid Arrival variants never spend cooldowns or once-per-awakening uses', () => {
  for (const id of ['serpent', 'butterflydancer', 'emperor']) {
    const f = fixture(id); f.awaken(); f.g.setOwner(f.enemy);
    const slot = id === 'serpent' ? 1 : id === 'butterflydancer' ? 1 : 0;
    assert.equal(activateSkill(f.g, f.p, slot), false); assert.equal(f.p.cooldowns[slot], 0);
    assert.equal(f.p.ability.serpentStrikerUsed, undefined); assert.equal(f.p.ability.emperorBicycleUsed, undefined);
  }
});

// Integration checks exercise the real match's flight, interception and passive
// paths, in addition to the deterministic move choreography checks above.
const { Game } = await import('./game.js');
function realMatch(team, character = 'emperor') {
  const g = new Game(null, { mode: 'test', gameFormat: 'standard-2v2', localPlayerId: team, players: [0, 1, 2, 3].map(id => ({ id, team: id % 2, character: id === team ? character : id === team + 2 ? 'magician' : 'none', isBot: false })) });
  g.state.kickoff = null;
  const p = g.state.players.find(p => p.id === team), mate = g.state.players.find(p => p.id === team + 2), enemy = g.state.players.find(p => p.team !== team);
  Object.assign(p, { x: team ? 800 : 400, y: 350 }); Object.assign(mate, { x: team ? 950 : 250, y: 350 });
  for (const other of g.state.players.filter(o => o.team !== team)) Object.assign(other, { x: 700, y: 100 });
  for (const player of g.state.players) tickAbilities(g, player, 0);
  function advance(seconds) { for (let t = 0; t < seconds; t += .01) g.update(.01); }
  return { g, p, mate, enemy, advance };
}
for (const team of [0, 1]) {
  test(`real reaction ball reaches halfway and scores only after receipt, team ${team}`, () => {
    const f = realMatch(team); f.g.setOwner(f.mate);
    assert.equal(activateSkill(f.g, f.p, 3), true); assert.equal(activateSkill(f.g, f.mate, 3), true);
    f.advance(.57); assert.equal(f.g.state.ball.owner, null); assert(f.g.state.ball.z > 0); assert.equal(f.g.state.ball.perfectPass, null);
    f.advance(4); assert.equal(f.g.state.score[team], 1); assert(f.p.cooldowns[3] > 85);
  });
  test(`real aerial chemical pass can be intercepted by another player, team ${team}`, () => {
    const f = realMatch(team); f.g.setOwner(f.mate); activateSkill(f.g, f.p, 3); activateSkill(f.g, f.mate, 3); f.advance(.57);
    const ball = f.g.state.ball; f.enemy.x = ball.x + (team ? -80 : 80); f.enemy.y = ball.y; f.enemy.leap = 2;
    f.advance(1); assert.equal(f.g.state.score[team], 0); assert(f.p.cooldowns[3] > 43 && f.p.cooldowns[3] <= 45); assert.equal(f.p.ability.reactionFlight, null);
  });
  test(`real Emperor passive distinguishes own half and Magician possession bonus, team ${team}`, () => {
    const f = realMatch(team); f.g.setOwner(f.p); tickAbilities(f.g, f.p, .01); assert.equal(f.g.powerBonus(f.p), 40); //35 own half +5 Magician passive
    f.p.x = team ? 500 : 700; assert.equal(f.g.powerBonus(f.p), 25);
    f.g.setOwner(f.mate); f.g.pass(f.mate, f.p); f.g.setOwner(f.p); tickAbilities(f.g, f.p, .01); assert.equal(f.g.powerBonus(f.p), 30);
    f.g.action(f.p); assert.equal(f.p.dribble, f.g.motionDuration(.85));
    f.g.setOwner(f.enemy); tickAbilities(f.g, f.p, .01); assert.equal(f.p.ability.emperorChemistry, false);
  });
}
for (const team of [0, 1]) {
  test(`Magnus physically flies, freezes at the goalbox and keeps Emperor at his shot origin, team ${team}`, () => {
    const f = realMatch(team); f.g.setOwner(f.p); f.p.awakened = true; f.p.awakeningLeft = 75; const origin = { x: f.p.x, y: f.p.y };
    assert.equal(activateSkill(f.g, f.p, 3), true); f.advance(4.9); assert.equal(f.g.state.ball.owner, f.p.id); assert.equal(f.g.state.score[team], 0);
    f.advance(.15); assert.equal(f.g.state.phase, 'play'); assert.equal(f.g.state.ball.magnusFlight, true); assert.equal(f.g.state.ball.owner, null); assert(Math.abs(f.g.state.ball.vx) > 1000); assert.deepEqual({ x: f.p.x, y: f.p.y }, origin);
    f.advance(.5); assert.equal(f.g.state.phase, 'cutscene'); assert.equal(f.g.state.cutscene.lines[0], 'VERDAMNT, JA!'); assert.equal(f.g.state.cutscene.choreography.kind, 'magnus-freeze'); assert.equal(f.g.state.ball.vx, 0); assert(Math.abs(f.g.state.ball.x - (team ? 216 : 984)) < .001); assert.deepEqual({ x: f.p.x, y: f.p.y }, origin); assert.equal(f.g.state.score[team], 0);
    f.advance(2.1); assert.equal(f.g.state.score[team], 1); assert.equal(f.g.state.ball.magnusFlight, false);
  });
  test(`Butterfly perfected destruction visibly weaves, nutmegs and backheels before its goal, team ${team}`, () => {
    const f = realMatch(team, 'butterflydancer'); f.g.setOwner(f.p); f.p.awakened = true; f.p.awakeningLeft = 60; f.advance(5.1);
    assert.equal(activateSkill(f.g, f.p, 0), true); assert.equal(f.g.state.cutscene.choreography.kind, 'butterfly-finish');
    const view = f.g.cutsceneView(.88); const dancer = view.players.find(p => p.id === f.p.id); assert(dancer.pose); assert.equal(view.ball.color, '#ffe45e');
    f.advance(5); assert.equal(f.g.state.score[team], 1);
  });
}

test('Butterfly ankle-break power, longer dribble and shorter cooldown do not stack', () => {
  const f = realMatch(0, 'butterflydancer'); f.g.setOwner(f.p); f.g.action(f.p);
  assert.equal(f.p.dribble, f.g.motionDuration(1)); assert.equal(f.p.dribbleCd, 1.5);
  assert.equal(f.g.steal(f.enemy, f.p), false); assert.equal(f.p.ability.ankleBoostLeft, 5); assert.equal(f.g.powerBonus(f.p), 15);
  assert.equal(f.g.steal(f.enemy, f.p), false); assert.equal(f.p.ability.ankleBoostLeft, 5); assert.equal(f.g.powerBonus(f.p), 15);
  f.p.motion = null; f.g.setInput(f.p.id, { keys: { d: true } }); const x = f.p.x, elapsed = f.g.state.elapsed; f.advance(.1); assert(Math.abs(f.p.x - x - 194 * 1.2 * .8 * f.g.motionSeconds(f.g.state.elapsed - elapsed)) < 1e-8);
});

test('chemical request cannot launch duplicate passes while both players are winding up', () => {
  const f = fixture('emperor', 0, 'magician'); f.g.setOwner(f.mate); activateSkill(f.g, f.p, 3); activateSkill(f.g, f.mate, 3);
  assert.equal(f.p.ability.reactionPending, true); assert.equal(activateSkill(f.g, f.p, 3), false); assert.equal(activateSkill(f.g, f.mate, 3), false);
  f.advance(.56); assert.equal(f.shots.length, 1); assert.equal(f.p.ability.reactionPending, false);
});

test('starting a vulnerable shot cancels earlier queued dashes and their dribble protection', () => {
  const f = fixture('butterflydancer'); f.g.setOwner(f.p); activateSkill(f.g, f.p, 0); activateSkill(f.g, f.p, 2);
  assert.equal(f.p.dribble, 0); assert.equal(f.p.invincible, 0); f.advance(1); assert.equal(f.dashes.length, 1); assert.equal(f.p.motion, null);
  const emperor = fixture('emperor'); emperor.g.setOwner(emperor.p); activateSkill(emperor.g, emperor.p, 1); activateSkill(emperor.g, emperor.p, 0); emperor.advance(1);
  assert.equal(emperor.dashes.length, 1); assert.equal(emperor.shots[0].power, 80);
});
