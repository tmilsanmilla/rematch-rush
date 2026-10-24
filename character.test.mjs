import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.js';
import { ROSTER, getSkills, activateSkill, activateAwakening, tickAbilities } from './characters.js';

function setup(character, owner = null) {
  const game = new Game(null, { character, mode: 'test' });
  game.state.kickoff = null;
  const [player, enemy] = game.state.players;
  Object.assign(player, { x: 650, y: 350, awakeningCharge: 100 });
  Object.assign(enemy, { x: 730, y: 350 });
  game.state.ball.owner = null;
  if (owner === player.id) game.setOwner(player);
  else if (owner === enemy.id) game.setOwner(enemy);
  return { game, player, enemy };
}

function advance(game, duration) {
  const count = Math.ceil(duration / .02);
  for (let index = 0; index < count; index++) game.update(duration / count);
}

function awakenDirectly(player, onBall = true) {
  player.awakened = true;
  player.awakeningLeft = 60;
  player.ability = { onBallAwakening: onBall, awakeningActive: true };
}

test('the expanded roster and Ninja awakening are represented', () => {
  assert.deepEqual(ROSTER.map(character => character.id), [
    'none', 'manmarker', 'ice', 'powershooter', 'ninja', 'playmaker', 'falcon', 'streetdribbler', 'magician', 'supersonic', 'trapper', 'serpent', 'butterflydancer', 'emperor',
  ]);
  assert.equal(ROSTER.find(character => character.id === 'ninja').awakening.duration, 45);
  assert.equal(getSkills('ninja')[1].cooldown, 15);
  const { game, player } = setup('ninja', 0);
  assert.equal(activateAwakening(game, player), true);
  assert.equal(player.awakeningCharge, 0);
  assert.equal(getSkills(player, true, true)[2].name, 'Mysterious knuckle');
});

test('on-ball and off-ball requirements reject moves without spending their cooldown', () => {
  const power = setup('powershooter');
  assert.equal(activateSkill(power.game, power.player, 0), false);
  assert.equal(power.player.cooldowns[0], 0);
  const ninja = setup('ninja', 0);
  assert.equal(activateSkill(ninja.game, ninja.player, 0), false);
  assert.equal(ninja.player.cooldowns[0], 0);
  assert.equal(activateSkill(ninja.game, ninja.player, 1), true);
  assert.equal(ninja.player.cooldowns[1], 15);
});

test('numeric player zero possession is never treated as a loose ball', () => {
  const power = setup('powershooter', 0);
  awakenDirectly(power.player);
  assert.equal(activateSkill(power.game, power.player, 0), false);
  assert.equal(power.game.state.ball.owner, 0);
  const speed = setup('supersonic', 0);
  speed.enemy.character = 'supersonic';
  assert.equal(activateSkill(speed.game, speed.enemy, 2), false);
  assert.equal(speed.enemy.cooldowns[2], 0);
  assert.equal(speed.game.state.ball.owner, 0);
});

test('all Playmaker team passes remain unavailable in 1v1 and preserve one-use flags', () => {
  for (const owner of [0, 1]) {
    const { game, player } = setup('playmaker', owner);
    assert.equal(activateSkill(game, player, 2), false);
    assert.equal(player.cooldowns[2], 0);
    awakenDirectly(player);
    assert.equal(activateSkill(game, player, 2), false);
    assert.equal(player.ability.mineUsed, undefined);
    assert.equal(player.ability.driveUsed, undefined);
    assert.equal(game.state.ball.owner, owner);
  }
});

test('Supersonic PINPOINT 1-2 requires a teammate without consuming the follow-up', () => {
  const { game, player } = setup('supersonic', 0);
  player.ability = { pinpointFollowup: 5 };
  player.cooldowns[1] = 28;
  assert.equal(getSkills(player, false, true)[1].name, 'PINPOINT 1-2');
  assert.equal(activateSkill(game, player, 1), false);
  assert.equal(player.cooldowns[1], 28);
  assert.equal(player.ability.pinpointFollowup, 5);
});

test('awakening possession requirements preserve readiness on rejection', () => {
  const defender = setup('manmarker', 0);
  assert.equal(activateAwakening(defender.game, defender.player), false);
  assert.equal(defender.player.awakeningCharge, 100);
  defender.game.setOwner(defender.enemy);
  assert.equal(activateAwakening(defender.game, defender.player), true);
  assert.equal(defender.player.awakeningLeft, 45);
  assert.equal(defender.player.awakeningCharge, 0);
  const shooter = setup('powershooter');
  assert.equal(activateAwakening(shooter.game, shooter.player), false);
  assert.equal(shooter.player.awakeningCharge, 100);
});

test('Advantageous blindspot is consumed once per awakening', () => {
  const { game, player } = setup('manmarker', 1);
  awakenDirectly(player);
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(player.ability.blindspotUsed, true);
  advance(game, 1.5);
  assert.equal(getSkills(player, true, false)[2].used, true);
  game.setOwner(game.state.players[1]);
  assert.equal(activateSkill(game, player, 2), false);
});

test('MANMARK reflects an opposing shot at half power and records a numeric last touch', () => {
  const { game, player } = setup('manmarker');
  assert.equal(activateSkill(game, player, 1), true);
  Object.assign(game.state.ball, {
    x: 685, y: 350, owner: null, vx: -400, vy: 60, power: 80, z: 0,
    lastKickTeam: 1, lastKickAgo: .1,
  });
  tickAbilities(game, player, .01);
  assert.equal(game.state.ball.vx, 200);
  assert.equal(game.state.ball.vy, -30);
  assert.equal(game.state.ball.power, 40);
  assert.equal(game.state.ball.lastTouch, 0);
  assert.equal(game.state.ball.lastKickTeam, 0);
});

test('a successful velocity counter stuns the tackler and lowers cooldown to 10 seconds', () => {
  const { game, player, enemy } = setup('supersonic', 0);
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(player.recovery, 3);
  assert.equal(game.steal(enemy, player), false);
  assert.equal(game.state.ball.owner, 0);
  assert.equal(enemy.stun, 2);
  assert.equal(player.cooldowns[2], 10);
  assert.equal(player.recovery, 0);
  assert.equal(player.counter, 0);
  assert.equal(player.onCounter, null);
  assert.equal(player.motion.invincible, true);
  assert.equal(player.motion.speed * player.motion.left, game.width / 2);
});

test('an expired velocity counter cannot trigger later and keeps its longer cooldown', () => {
  const { game, player, enemy } = setup('supersonic', 0);
  activateSkill(game, player, 2);
  advance(game, 3.1);
  assert.equal(player.counter, 0);
  assert.equal(player.onCounter, null);
  assert(player.cooldowns[2] > 31 && player.cooldowns[2] < 33);
  assert.equal(game.steal(enemy, player), true);
});

test('Supersonic off-ball awakening takes possession but never grants move four', () => {
  const { game, player, enemy } = setup('supersonic', 1);
  assert.equal(activateAwakening(game, player), true);
  assert.equal(getSkills(player, true, false).length, 3);
  advance(game, 2.9);
  assert.equal(game.state.ball.owner, 0);
  assert(enemy.stun >= 2.8);
  assert.equal(getSkills(player, true, true).length, 3);
});

test('interruption removes WORLD RECORD SPEED and its movement bonus', () => {
  const { game, player } = setup('supersonic', 0);
  activateAwakening(game, player);
  advance(game, 2.9);
  assert.equal(getSkills(player, true, true).length, 4);
  assert.equal(activateSkill(game, player, 3), true);
  advance(game, 2.5);
  assert.equal(player.worldRecordSpeed, true);
  assert.equal(player.abilitySpeedBoost, 1.5);
  player.awakened = false;
  tickAbilities(game, player, .02);
  assert.equal(player.worldRecordSpeed, false);
  assert.equal(player.abilitySpeedBoost, 0);
});

test('an interrupted cinematic cannot release its awakened shot afterward', () => {
  const { game, player } = setup('powershooter', 0);
  awakenDirectly(player);
  assert.equal(activateSkill(game, player, 2), true);
  player.awakened = false;
  advance(game, 3.1);
  assert.equal(game.state.ball.owner, 0);
  assert.equal(game.state.ball.lastKickTeam, null);
});

test('scheduled windups freeze throughout cutscenes and resume afterward', () => {
  const { game, player } = setup('powershooter', 0);
  assert.equal(activateSkill(game, player, 0), true);
  assert.equal(game.tasks.length, 1);
  game.cutscene(2, ['A different play pauses the pitch'], '#fff', () => {});
  advance(game, 1.8);
  assert.equal(game.state.ball.owner, 0);
  assert.equal(game.tasks[0].left, 1);
  assert.equal(player.recovery, 1);
  assert.equal(game.state.time, 300);
  advance(game, .3);
  assert.equal(game.state.phase, 'play');
  assert.equal(game.state.ball.owner, 0);
  advance(game, 1);
  assert.equal(game.tasks.length, 0);
  assert.equal(game.state.ball.lastKickTeam, 0);
  assert.equal(game.state.ball.power, 45);
});

function addTeammate(game, player, { id = 'teammate', x = player.x + 250, y = player.y, character = 'none' } = {}) {
  const source = game.state.players.find(other => other !== player);
  const mate = { ...source, id, team: player.team, x, y, name: 'Teammate', character, ability: {}, cooldowns: [0, 0, 0, 0], stats: { goals: 0, tackles: 0, saves: 0 }, aim: { x: game.width, y: game.height / 2 } };
  game.state.players.push(mate);
  game.teammate = actor => actor.id === player.id ? mate : player;
  return mate;
}

test('Ice uses Euclidean chemistry range, keeps failed cooldowns, and delivers instantly', () => {
  const { game, player } = setup('ice', 0);
  const mate = addTeammate(game, player, { x: player.x + game.width / 4, y: player.y + game.width / 4 });
  player.aim = { x: mate.x, y: mate.y };
  assert.equal(activateSkill(game, player, 0), false);
  assert.equal(game.state.message, 'TOO FAR!');
  assert.equal(player.cooldowns[0], 0);
  assert.equal(game.state.ball.owner, player.id);
  mate.y = player.y + game.width / 6;
  player.aim = { x: mate.x, y: mate.y };
  assert.equal(activateSkill(game, player, 0), true);
  assert.equal(game.state.ball.owner, mate.id);
  assert.equal(player.cooldowns[0], 40);
  assert.equal(game.state.ball.finish, null);
});

test('Ice needs a teammate under the cursor and nutmegs a close opponent with protection', () => {
  const { game, player, enemy } = setup('ice', 0);
  assert.equal(activateSkill(game, player, 0), false);
  assert.equal(player.cooldowns[0], 0);
  const mate = addTeammate(game, player);
  player.aim = { x: mate.x + 70, y: mate.y };
  assert.equal(activateSkill(game, player, 0), false);
  assert.equal(activateSkill(game, player, 1), true);
  assert.equal(enemy.stun, .5);
  assert(player.invincible >= .8);
  assert.equal(player.motion.dribble, true);
  assert.equal(player.cooldowns[1], 20);
  assert.equal(game.state.ball.owner, null, 'the ball rolls through the opponent while Ice goes around');
  advance(game, .3);
  assert(game.state.ball.x > 700);
  assert.equal(game.state.ball.owner, null);
  advance(game, .3);
  assert.equal(game.state.ball.owner, null, 'the slowed nutmeg is still traveling at 0.6 real seconds');
  advance(game, .05);
  assert.equal(game.state.ball.owner, player.id);
  assert(player.x > enemy.x);
});

test('ICE cold remains unblockable through its curved pass and preserves rejected casts', () => {
  const { game, player, enemy } = setup('ice', 0);
  awakenDirectly(player);
  assert.equal(activateSkill(game, player, 2), false);
  assert.equal(player.cooldowns[2], 0);
  const mate = addTeammate(game, player, { x: player.x + 200 });
  player.aim = { x: mate.x, y: mate.y };
  assert.equal(activateSkill(game, player, 2), true);
  advance(game, 1.9);
  assert(game.state.ball.perfectPass);
  enemy.x = game.state.ball.x; enemy.y = game.state.ball.y;
  advance(game, 1);
  assert.equal(game.state.ball.owner, mate.id);
  assert.equal(game.state.ball.perfectPass, null);
});

test('Ninja has an explicit invincible Precision burst follow-up and longer awakened stealth', () => {
  const { game, player } = setup('ninja', 0);
  assert.equal(activateSkill(game, player, 1), true);
  assert.equal(player.cooldowns[1], 15);
  assert(Math.abs(player.motion.speed * player.motion.left - game.width / 5) < 1e-8);
  advance(game, .38);
  assert.equal(getSkills(player, false, true)[1].name, 'Precision burst');
  assert.equal(activateSkill(game, player, 1), true);
  assert.equal(player.cooldowns[1], 20);
  assert.equal(player.motion.invincible, true);
  assert(Math.abs(player.motion.speed * player.motion.left - game.width / 4) < 1e-8);
  const hidden = setup('ninja', 1);
  awakenDirectly(hidden.player);
  assert.equal(activateSkill(hidden.game, hidden.player, 0), true);
  assert.equal(hidden.player.stealth, 10);
  hidden.enemy.dribble = 1;
  hidden.player.x = hidden.enemy.x; hidden.player.y = hidden.enemy.y;
  tickAbilities(hidden.game, hidden.player, .01);
  assert.equal(hidden.player.stealth, 0);
  assert.equal(hidden.player.stun, 2);
  assert.equal(hidden.game.state.ball.owner, hidden.enemy.id);
});

test('Mysterious knuckle releases once per awakening at 65 power', () => {
  const { game, player } = setup('ninja', 0);
  awakenDirectly(player);
  assert.equal(activateSkill(game, player, 2), true);
  advance(game, 1.7);
  assert.equal(game.state.ball.power, 65);
  assert.equal(game.state.ball.knuckle, true);
  game.setOwner(player);
  assert.equal(activateSkill(game, player, 2), false);
  assert.equal(getSkills(player, true, true)[2].used, true);
});

test('Falcon volley validates airborne distance and Predator Eye runs at 150 percent speed', () => {
  const { game, player } = setup('falcon');
  assert.equal(activateSkill(game, player, 0), false);
  Object.assign(game.state.ball, { x: player.x + game.width / 8 + 1, y: player.y, z: 80 });
  assert.equal(activateSkill(game, player, 0), false);
  assert.equal(player.cooldowns[0], 0);
  game.state.ball.x = player.x + 100;
  assert.equal(activateSkill(game, player, 0), true);
  assert.equal(game.state.ball.power, 50);
  assert(game.state.ball.vz > 0);
  player.cooldowns[1] = 0;
  assert.equal(activateSkill(game, player, 1), true);
  tickAbilities(game, player, .02);
  assert.equal(player.motion.speed, 194 * 1.5);
  assert.equal(player.cooldowns[1], 20);
});

test('Falcon aerial dribble regains possession and Sky domination never scores', () => {
  const { game, player } = setup('falcon', 0);
  const start = player.x;
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(game.state.ball.x, start + game.width / 3);
  advance(game, .75);
  assert.equal(game.state.ball.owner, null, 'Falcon cannot catch the ball before his paced dash finishes');
  advance(game, .05);
  assert.equal(game.state.ball.owner, player.id);
  assert.equal(player.x, start + game.width / 3);
  awakenDirectly(player);
  player.cooldowns[2] = 0;
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(game.state.ball.cannotScore, true);
  advance(game, 3.1);
  assert.deepEqual(game.state.score, [0, 0]);
  assert.equal(game.state.ball.owner, player.id);
});

test('new team skills reject 1v1 without spending their shared cooldowns or one-use flags', () => {
  for (const character of ['ice', 'magician']) {
    for (const awakened of [false, true]) {
      const { game, player } = setup(character, 0);
      if (awakened) awakenDirectly(player);
      for (const slot of character === 'ice' ? awakened ? [0, 2] : [0] : awakened ? [1] : [1, 2]) {
        assert.equal(activateSkill(game, player, slot), false, `${character} ${slot}`);
        assert.equal(player.cooldowns[slot], 0);
      }
    }
  }
});

test('Magician selects the farthest perfect-pass target and My Assist fires on receipt', () => {
  const { game, player } = setup('magician', 0);
  const near = addTeammate(game, player, { id: 'near', x: player.x + 100 });
  const far = addTeammate(game, player, { id: 'far', x: player.x + 300 });
  assert.equal(activateSkill(game, player, 1), true);
  assert.equal(game.state.ball.perfectPass.targetId, far.id);
  advance(game, .6);
  assert.equal(game.state.ball.owner, far.id);
  game.setOwner(player);
  player.aim = { x: game.width, y: game.height / 2 - 90 };
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(game.state.ball.perfectPass.targetId, near.id);
  advance(game, .3);
  assert.equal(game.state.ball.lastTouch, near.id);
  assert.equal(game.state.ball.power, 55, 'the forced 50-power shot receives its Magician teammate’s +5 passive');
  assert.equal(game.state.ball.color, '#ff84cf');
  assert.equal(game.state.ball.owner, null);
});

test('Magician weave keeps its follow-up on rejected team pass and overwrites cooldown when used', () => {
  const { game, player } = setup('magician', 0);
  assert.equal(activateSkill(game, player, 0), true);
  assert.equal(player.cooldowns[0], 27);
  assert.equal(player.motion.invincible, true);
  advance(game, 1.3);
  const before = player.ability.placementFollowup;
  assert.equal(activateSkill(game, player, 0), false);
  assert.equal(player.ability.placementFollowup, before);
  const mate = addTeammate(game, player);
  assert.equal(activateSkill(game, player, 0), true);
  assert.equal(player.cooldowns[0], 30);
  assert.equal(game.state.ball.perfectPass.targetId, mate.id);
});

test('Instant Pay-Off requires ten seconds of possession then scores through a team return', () => {
  const { game, player } = setup('magician', 0);
  const mate = addTeammate(game, player);
  awakenDirectly(player);
  assert.equal(activateSkill(game, player, 1), false);
  assert.equal(player.cooldowns[1], 0);
  advance(game, 10.1);
  assert(player.possessionAge >= 10);
  assert.equal(activateSkill(game, player, 1), true);
  assert.equal(player.cooldowns[1], 50);
  advance(game, 5.2);
  assert.equal(game.state.score[0], 1);
  assert.equal(game.state.scorer, player.id);
  assert.notEqual(mate.id, player.id);
});

test('Trapper first-touch bonuses expire and awakening doubles their effects', () => {
  const { game, player, enemy } = setup('trapper', 0);
  tickAbilities(game, player, .01);
  assert.equal(player.abilitySpeedBoost, 1);
  assert.equal(player.receiptPowerBonus, 20);
  advance(game, 2.6);
  assert.equal(player.abilitySpeedBoost, 0);
  assert.equal(player.receiptPowerBonus, 0);
  awakenDirectly(player);
  game.setOwner(enemy); game.setOwner(player);
  tickAbilities(game, player, .01);
  assert.equal(player.abilitySpeedBoost, 2);
  assert.equal(player.receiptPowerBonus, 40);
});

test('Trapper traps high shots and starts its shared cooldown when the leap ends', () => {
  const { game, player } = setup('trapper');
  Object.assign(game.state.ball, { x: player.x + 200, y: player.y, z: 250 });
  assert.equal(activateSkill(game, player, 0), true);
  assert.equal(player.cooldowns[0], 0);
  game.state.ball.x = player.x + 50;
  tickAbilities(game, player, .01);
  assert.equal(game.state.ball.owner, player.id);
  assert.equal(player.cooldowns[0], 20);
  assert.equal(player.recovery, 0);
  const missed = setup('trapper', 1);
  assert.equal(activateSkill(missed.game, missed.player, 0), true);
  advance(missed.game, 3.1);
  assert(missed.player.cooldowns[0] > 19 && missed.player.cooldowns[0] <= 20);
});

test('three successful Fake Volleys unlock one Juggling Destroyer goal and misses reset the streak', () => {
  const { game, player, enemy } = setup('trapper', 0);
  for (let i = 1; i <= 3; i++) {
    assert.equal(activateSkill(game, player, 2), true);
    assert.equal(game.steal(enemy, player), false);
    assert.equal(enemy.stun, 2);
    assert.equal(player.ability.fakeVolleyStreak, i);
    assert.equal(player.cooldowns[2], 0);
  }
  assert.equal(getSkills(player, false, true)[2].name, 'Juggling Destroyer Shot');
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(player.cooldowns[2], 20);
  advance(game, .6);
  assert.equal(game.state.score[0], 0, 'the scripted ball flight also takes the slower world pace');
  advance(game, .08);
  assert.equal(game.state.score[0], 1);
  const missed = setup('trapper', 0);
  missed.player.ability = { fakeVolleyStreak: 2 };
  activateSkill(missed.game, missed.player, 2);
  advance(missed.game, 2.1);
  assert.equal(missed.player.ability.fakeVolleyStreak, 0);
  assert(missed.player.cooldowns[2] > 14 && missed.player.cooldowns[2] <= 15);
  assert.equal(missed.player.onCounter, null);
});

test('Trapper awakened interception validates a recent opponent shot and ultimate is once only', () => {
  const { game, player, enemy } = setup('trapper', 0);
  awakenDirectly(player);
  assert.equal(activateSkill(game, player, 2), false);
  assert.equal(player.ability.hexchamberUsed, undefined);
  game.setOwner(enemy); game.kick(enemy, 40);
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(player.ability.hexchamberUsed, true);
  advance(game, 6.02);
  assert.equal(game.state.ball.power, 100);
  assert.equal(game.state.ball.lastTouch, player.id);
  assert(game.state.ball.vz > 0);
  assert.equal(getSkills(player, true, false)[2].used, true);
});

test('Meta no prazo immediately drops roulette invincibility throughout its one-second windup', () => {
  const { game, player, enemy } = setup('streetdribbler', 0);
  assert.equal(activateSkill(game, player, 1), true);
  assert(player.invincible > 0);
  assert.equal(activateSkill(game, player, 1), true);
  assert.equal(player.recovery, 1);
  assert.equal(player.invincible, 0);
  assert.equal(player.dribble, 0);
  assert.equal(player.motion, null);
  assert.equal(game.steal(enemy, player), true);
  advance(game, 1.1);
  assert.equal(game.state.ball.owner, enemy.id);
});

test('Direct Heel Drive maintains invincibility between its two dashes', () => {
  const { game, player, enemy } = setup('trapper', 0);
  activateSkill(game, player, 1);
  advance(game, .55);
  assert.equal(activateSkill(game, player, 1), true);
  for (let index = 0; index < 44; index++) {
    game.update(.02);
    assert(player.invincible > 0, `protection at ${index * .02}s`);
    assert.equal(game.steal(enemy, player), false);
  }
  assert.equal(game.state.ball.owner, player.id);
});

test('Trapper cannot intercept an unblockable pass or treat keeper distribution as a shot', () => {
  const { game, player, enemy } = setup('ice', 0);
  const mate = addTeammate(game, player);
  awakenDirectly(player);
  player.aim = { x: mate.x, y: mate.y };
  activateSkill(game, player, 2);
  advance(game, 1.9);
  enemy.character = 'trapper'; enemy.ability = { trapLeft: 2 };
  enemy.x = game.state.ball.x; enemy.y = game.state.ball.y;
  tickAbilities(game, enemy, .01);
  assert(game.state.ball.perfectPass);
  assert.equal(game.state.ball.owner, null);
  const shot = setup('trapper');
  awakenDirectly(shot.player);
  Object.assign(shot.game.state.ball, { lastKickTeam: 1, lastKickAgo: .1, finish: { source: 'distribution' } });
  assert.equal(activateSkill(shot.game, shot.player, 1), false);
  assert.equal(activateSkill(shot.game, shot.player, 2), false);
  assert.equal(shot.player.ability.hexchamberUsed, undefined);
});

test('cinematic specials carry animation data and call a named online guest newbie', () => {
  const { game, player, enemy } = setup('trapper', 0);
  game.options.mode = 'online'; enemy.name = 'CustomGuestName';
  awakenDirectly(player);
  game.setOwner(enemy); game.kick(enemy, 40);
  assert.equal(activateSkill(game, player, 2), true);
  assert.equal(game.state.cutscene.lines[0], 'Thanks, newbie');
  assert.equal(game.state.cutscene.choreography.kind, 'hexchamber');
  assert.equal(game.state.cutscene.choreography.actorId, player.id);
  const falcon = setup('falcon', 0);
  awakenDirectly(falcon.player);
  activateSkill(falcon.game, falcon.player, 0);
  assert.equal(falcon.game.state.cutscene.choreography.kind, 'bicycle');
  const trapper = setup('trapper', 0);
  awakenDirectly(trapper.player);
  activateSkill(trapper.game, trapper.player, 1);
  assert.equal(trapper.game.state.cutscene.choreography.kind, 'scorpion');
});

test('all five slots across the expanded roster remain finite and serializable', () => {
  let scenarios = 0;
  for (const character of ROSTER) {
    for (const awakened of [false, true]) {
      for (const owner of [null, 0, 1]) {
        for (let slot = 0; slot < 5; slot++) {
          const { game, player } = setup(character.id, owner);
          if (awakened) awakenDirectly(player);
          activateSkill(game, player, slot);
          advance(game, 5.6);
          const label = `${character.id}, awakening=${awakened}, owner=${owner}, slot=${slot}`;
          for (const actor of game.state.players) {
            assert(Number.isFinite(actor.x) && Number.isFinite(actor.y), label);
          }
          assert(Number.isFinite(game.state.ball.x) && Number.isFinite(game.state.ball.y), label);
          assert.doesNotThrow(() => JSON.stringify(game.exportState()), label);
          scenarios++;
        }
      }
    }
  }
  assert.equal(scenarios, ROSTER.length * 2 * 3 * 5);
});


for (const team of [0, 1]) test(`Street Dribbler follow-up exposes one second of windup and never shoots before it, team ${team}`, () => {
  const kicks = [], game = new Game(null, {mode:'online',gameFormat:'standard-1v1',localTeam:team,localPlayerId:team,character:'streetdribbler',onEvent:event=>{if(event.type==='kick')kicks.push({...event,at:game.state.elapsed});}});
  game.state.kickoff = null;
  const player = game.localPlayer(), enemy = game.opponent(player);
  Object.assign(player, {x:600,y:350,ability:{rouletteFollowup:4.5,rouletteLeft:.55},invincible:.55,dribble:.55,motion:{dx:1,dy:0,speed:100,left:.5}});
  Object.assign(enemy,{x:100,y:100}); game.setOwner(player);
  assert.match(getSkills(player,false,true)[1].description, /vulnerable 1s windup/);
  assert.equal(game.activateMeteredSkill(player,1),true);
  assert.equal(player.recovery,1); assert.equal(player.invincible,0); assert.equal(player.dribble,0); assert.equal(player.motion,null);
  assert.equal(player.shotWindup.duration,1); assert.equal(player.shotWindup.left,1); assert.equal(game.shotMeter(player).power,75);
  const charge = game.effects.find(effect=>effect.type==='charge'); assert.equal(charge.total,1); assert.equal(charge.left,1);
  assert.equal(game.tasks.length,1); assert.equal(game.tasks[0].left,1);
  advance(game,.99); assert.equal(kicks.length,0); assert.equal(game.hasBall(player),true); assert.ok(game.shotMeter(player).fill>.98);
  game.update(.009); assert.equal(kicks.length,0); assert.equal(game.hasBall(player),true);
  game.update(.002); assert.equal(kicks.length,1); assert.ok(game.state.elapsed>=1&&game.state.elapsed<1.01); assert.equal(kicks[0].power,75);
  assert.equal(player.shotWindup,null); assert.equal(player.ultraCharge,1); assert.equal(game.shotMeter(player).label,'SHOT');
  advance(game,.6); assert.equal(kicks.length,1,'the old one-and-a-half-second task must not release a second shot');
});

test('perfect-pass flight follows the slower world pace while its aura window uses real seconds', () => {
  const game = new Game(null, {mode:'online',gameFormat:'standard-2v2',character:'magician'});
  game.state.kickoff = null;
  const player = game.localPlayer(), mate = game.state.players.find(other=>other.id!==player.id&&other.team===player.team);
  Object.assign(player,{x:200,y:250}); Object.assign(mate,{x:800,y:250}); game.setOwner(player);
  assert.equal(activateSkill(game,player,1),true);
  const flight = game.state.ball.perfectPass, duration = flight.duration;
  tickAbilities(game,player,.1);
  assert.ok(Math.abs(flight.left-(duration-.085))<1e-9);
  assert.ok(Math.abs(game.state.ball.x-(200+600*.085/duration))<1e-9);
  assert.ok(Math.abs(player.ability.auraLeft-.9)<1e-9,'the visual ability window still advances by the full real tenth of a second');
  assert.equal(player.ultraCharge,1,'flight progress does not add a second kick');
  tickAbilities(game,player,duration-.1);
  assert.equal(game.state.ball.owner,null,'the pass cannot snap to its receiver at the old unpaced deadline');
  tickAbilities(game,player,duration/.85-duration+.001);
  assert.equal(game.state.ball.owner,mate.id);
});

test('Ice nutmeg ball progress uses paced travel without stretching its follow-up clock', () => {
  const {game,player,enemy} = setup('ice',0);
  Object.assign(player,{x:300,y:350}); Object.assign(enemy,{x:380,y:350});
  assert.equal(activateSkill(game,player,1),true);
  const route = player.ability.nutmeg, origin = {...route.origin}, target = {...route.target};
  player.ability.precisionFollowup = 2;
  tickAbilities(game,player,.26);
  assert.ok(Math.abs(route.left-(.52-.26*.85))<1e-9);
  assert.ok(Math.abs(game.state.ball.x-(origin.x+(target.x-origin.x)*.425))<1e-9);
  assert.ok(Math.abs(player.ability.precisionFollowup-1.74)<1e-9);
  tickAbilities(game,player,.26);
  assert.equal(game.state.ball.owner,null,'the ball stays on its paced route at the old travel deadline');
  tickAbilities(game,player,.1);
  assert.equal(game.state.ball.owner,player.id);
  assert.equal(player.ability.nutmeg,null);
});

test('Falcon aerial-dribble and return travel deadlines match paced motion rather than logical windows', () => {
  const {game,player} = setup('falcon',0);
  assert.equal(activateSkill(game,player,2),true);
  const aerial = player.ability.aerialDribble;
  tickAbilities(game,player,.65);
  assert.ok(Math.abs(aerial.left-(.65-.65*.85))<1e-9);
  assert.equal(game.state.ball.owner,null);
  tickAbilities(game,player,.12);
  assert.equal(game.state.ball.owner,player.id);
  awakenDirectly(player); player.cooldowns[2]=0;
  assert.equal(activateSkill(game,player,2),true);
  const returning = player.ability.skyReturn;
  tickAbilities(game,player,.5);
  assert.ok(Math.abs(returning.left-2.575)<1e-9);
  assert.ok(Math.abs(player.ability.auraLeft-2.5)<1e-9);
});

test('MANMARK smooth tracking slows by fifteen percent and retains its five-second ability window', () => {
  const {game,player,enemy} = setup('manmarker',1);
  Object.assign(player,{x:300,y:250}); Object.assign(enemy,{x:450,y:350});
  assert.equal(activateSkill(game,player,1),true);
  const start = {x:player.x,y:player.y}, target = {x:enemy.x-45,y:enemy.y};
  tickAbilities(game,player,.02);
  assert.ok(Math.abs(player.x-(start.x+(target.x-start.x)*.02*.85*18))<1e-9);
  assert.ok(Math.abs(player.y-(start.y+(target.y-start.y)*.02*.85*18))<1e-9);
  assert.ok(Math.abs(player.ability.markLeft-4.98)<1e-9);
});

test('Magnus physical-flight fallback does not teleport the ball early at its old deadline', () => {
  const {game,player} = setup('emperor'); awakenDirectly(player);
  player.ability.magnusFlight={left:.2,goalBoxX:984};
  Object.assign(game.state.ball,{x:600,y:350,owner:null,magnusFlight:true,scriptedReturn:true});
  tickAbilities(game,player,.2);
  assert.ok(Math.abs(player.ability.magnusFlight.left-.03)<1e-9);
  assert.equal(game.state.phase,'play'); assert.equal(game.state.ball.x,600);
  tickAbilities(game,player,.04);
  assert.equal(player.ability.magnusFlight,null);
  assert.equal(game.state.phase,'cutscene'); assert.equal(game.state.ball.x,984);
});
