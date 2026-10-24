import { ROSTER, getSkills } from './characters.js?v=7';

const FIELD = { left: 70, right: 1130, top: 65, bottom: 635, goalTop: 260, goalBottom: 440 };
const MID = { x: 600, y: 350 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomUnit = random => clamp(Number(random()) || 0, 0, .999999999);
export const BOT_CHARACTER_IDS = Object.freeze(ROSTER.map(character => character.id));

export function selectBotCharacter(random = Math.random) {
  return BOT_CHARACTER_IDS[Math.floor(randomUnit(random) * BOT_CHARACTER_IDS.length)];
}

function context(game, p) {
  const s = game.state, b = s.ball, own = game.hasBall(p), dir = p.team ? -1 : 1;
  const enemies = s.players.filter(q => q.team !== p.team);
  const mates = s.players.filter(q => q.team === p.team && q.id !== p.id);
  const carrier = s.players.find(q => q.id === b.owner);
  const enemyCarrier = carrier?.team !== p.team ? carrier : null;
  const enemy = enemyCarrier || enemies.slice().sort((a, q) => game.distance(p, a) - game.distance(p, q))[0];
  const mate = mates.slice().sort((a, q) => game.distance(p, a) - game.distance(p, q))[0];
  const ahead = enemies.filter(q => (q.x - p.x) * dir > 0 && Math.abs(q.y - p.y) < 125 && game.distance(p, q) < game.width / 6).sort((a, q) => game.distance(p, a) - game.distance(p, q))[0];
  const protectedBall = !!(b.perfectPass || b.scriptedGoal || b.magnusFlight || b.unstoppableAir);
  const loose = b.owner == null && !protectedBall;
  return {
    game, s, b, p, own, dir, enemies, mates, carrier, enemyCarrier, enemy, mate, ahead, loose, protectedBall,
    airborne: loose && b.z > 4, distance: game.distance(p, b), enemyDistance: enemy ? game.distance(p, enemy) : Infinity,
    goalX: p.team ? FIELD.left : FIELD.right,
    goalDistance: Math.abs(p.x - (p.team ? FIELD.left : FIELD.right)),
    recentShot: loose && b.lastKickTeam != null && b.lastKickTeam !== p.team && b.lastKickAgo < 1.6 && b.finish?.source !== 'distribution',
    ownHalf: p.team === 0 ? p.x < game.width / 2 : p.x > game.width / 2,
    held: p.possessionAge ?? Math.max(0, s.elapsed - (p.possessionStartedAt ?? s.elapsed)),
  };
}

function chemicalReady(c) {
  const { p, mates, game } = c, other = mates.find(q => q.character === (p.character === 'emperor' ? 'magician' : 'emperor'));
  const magician = p.character === 'magician' ? p : other;
  return !!other && !!magician && game.hasBall(magician) && !(p.ability?.reactionCooldown > 0 || other.ability?.reactionCooldown > 0 || p.ability?.reactionPending || other.ability?.reactionPending || p.ability?.reactionFlight || other.ability?.reactionFlight);
}

function canUse(c, slot) {
  const { p, own, mate, enemy, enemyCarrier, carrier, ahead, loose, airborne, distance, enemyDistance, goalDistance, recentShot, ownHalf, held, b, game } = c;
  const a = p.ability || {}, awake = p.awakened && p.awakeningLeft > 0, range = goalDistance <= 680;
  switch (p.character) {
    case 'manmarker': return slot === 0 ? !own && !!enemyCarrier && enemyDistance < 240 : slot === 1 ? !!enemy && enemyDistance < 260 && !(a.markLeft > 0) : slot === 2 && awake && !own && !!enemyCarrier && enemyDistance < 295;
    case 'ice': return slot === 0 ? own && !!mate && game.distance(p, mate) <= game.width / 3 : slot === 1 ? own && !!ahead && game.distance(p, ahead) < 130 : slot === 2 && awake && own && !!mate;
    case 'powershooter': return slot === 0 ? awake ? loose && distance < 600 : own && range : slot === 1 ? !own && !!enemyCarrier && enemyDistance < 310 : slot === 2 && awake && own && range;
    case 'ninja': return slot === 0 ? !own && !(p.stealth > 0) && (!!enemyCarrier || loose) : slot === 1 ? own && (goalDistance > 260 || a.precisionFollowup > 0) : slot === 2 && awake && own && range;
    case 'falcon': return slot === 0 ? awake ? own && range : airborne && distance <= game.width / 8 && !(b.distribution?.age < .5) : slot === 1 ? !own && distance <= game.width / 3 && !(a.predatorLeft > 0) : slot === 2 && own && goalDistance > 280;
    case 'playmaker':
      if (slot === 0) return !(a.observationLeft > 0);
      if (slot === 1) return own && (awake ? !!enemy && (enemy.x - p.x) * c.dir > 0 && Math.abs(enemy.y - p.y) < 170 && enemyDistance < 360 : goalDistance > 400 || enemyDistance < 150);
      return slot === 2 && !!mate && (own ? true : game.hasBall(mate) && (awake || game.distance(p, mate) <= game.width / 2));
    case 'streetdribbler': return own && (slot === 0 ? awake || goalDistance > 260 : slot === 1 ? a.rouletteFollowup > 0 ? range : goalDistance > 260 : slot === 2 && (awake ? range : goalDistance > 500));
    case 'magician':
      if (slot === 3) return chemicalReady(c);
      if (slot === 0) return own && (awake ? ownHalf : a.placementFollowup > 0 ? !!mate && game.distance(p, mate) <= game.width / 2 : goalDistance > 300 || enemyDistance < 150);
      if (slot === 1) return !!mate && (awake ? own ? held >= 10 : loose : own);
      return slot === 2 && own && range && (awake || !!mate);
    case 'trapper':
      if (slot === 0) return awake ? own ? range && !!ahead : loose && distance < 600 : own ? range : loose && distance < 190 && !(a.trapLeft > 0);
      if (slot === 1) return awake ? own ? range : recentShot : own && (a.heelFollowup > 0 || enemyDistance < 150);
      return slot === 2 && (awake ? recentShot : own && (a.fakeVolleyStreak >= 3 || enemyDistance < 80 && (enemy?.motion?.steal || enemy?.slideCd > 0) && !(a.fakeVolleyLeft > 0)));
    case 'supersonic':
      if (slot === 0) return own && (awake ? p.team === 0 ? p.x >= game.width * .5 && p.x < game.width * .8 : p.x <= game.width * .5 && p.x > game.width * .2 : goalDistance > 300);
      if (slot === 1) return awake ? !own && (loose || !!enemyCarrier) : a.pinpointFollowup > 0 ? own && !!mate : !own && !!enemyCarrier && enemyDistance < 600;
      if (slot === 2) return awake ? recentShot : own ? enemyDistance < 80 && !!(enemy?.motion?.steal || enemy?.slideCd > 0) && !(a.velocityCounterLeft > 0) : loose && distance > 60 && distance < 650;
      return slot === 3 && awake && a.onBallAwakening === true && !(a.recordSpeedLeft > 0);
    case 'serpent':
      if (slot === 0) return loose && distance < (awake ? 650 : game.width / 6);
      if (slot === 1) return awake ? loose && b.distribution?.team === p.team && b.distribution.landedAge != null && b.distribution.landedAge < 1.6 : !own && !!enemyCarrier && (enemyCarrier.x - p.x) * c.dir > 0 && Math.abs(enemyCarrier.y - p.y) < game.height / 3;
      return slot === 2 && !!mate && !!enemy && !(a.baitLeft > 0);
    case 'butterflydancer':
      if (slot === 0) return awake ? own ? ownHalf && held >= 5 && a.ownHalfHeld >= 5 : !!enemyCarrier : own && goalDistance > 350;
      if (slot === 1) return awake ? own && range : own ? goalDistance > 250 || a.butterflyFollowup > 0 : loose && distance < 600;
      return slot === 2 && own && (awake ? !(a.infiniteDribble > 0) && enemyDistance < 200 : range);
    case 'emperor':
      if (slot === (awake ? 4 : 3)) return chemicalReady(c);
      if (slot === 0) return own && range && (!awake || !!ahead);
      if (slot === 1) return awake ? !own && !!carrier && carrier.id !== p.id : a.emperorFollowup > 0 ? own ? range : !!carrier && carrier.id !== p.id : !own && distance > 180 || own && goalDistance > 500;
      if (slot === 2) return awake ? airborne : airborne && distance <= game.width / 6 || !own && !!mate && game.hasBall(mate);
      return slot === 3 && awake && own && range;
    default: return false;
  }
}

// These eligibility checks are tactical prefilters, not a second ability engine.
// A chosen move still passes through Game.setInput and activateMeteredSkill.
export function botSkillChoices(game, p) {
  const c = context(game, p);
  if (!['play', 'playing'].includes(c.s.phase) || p.stun > 0 || p.recovery > 0 || p.motion?.left > 0 || p.charging || c.s.kickoff && c.s.kickoff.team !== p.team || c.protectedBall && !c.own) return [];
  return getSkills(p, p.awakened && p.awakeningLeft > 0, c.own).flatMap((skill, slot) => {
    if (skill.used || p.cooldowns?.[slot] > 0 && !skill.followup || !canUse(c, slot)) return [];
    const passAim = p.character === 'ice' && slot !== 1 && c.mate;
    const aimedSteal = p.character === 'manmarker' && slot === 0 || p.character === 'powershooter' && slot === 1;
    const targetAim = !c.own && c.enemyCarrier && aimedSteal ? c.enemyCarrier : null;
    return [{ slot, name: skill.name, followup: !!skill.followup, aim: passAim ? { x: c.mate.x, y: c.mate.y } : targetAim ? { x: targetAim.x, y: targetAim.y } : null }];
  });
}

const lineDistance = (point, from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  const t = length ? clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / length, 0, 1) : 0;
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
};

export function chooseBotAim(game, p, random = Math.random) {
  const c = context(game, p), keeper = c.s.keepers?.find(k => k.team !== p.team);
  const targets = [FIELD.goalTop + 20, MID.y, FIELD.goalBottom - 20].map(y => ({ x: c.goalX, y }));
  const scored = targets.map(target => ({ target, score: (keeper ? Math.abs(target.y - keeper.y) : 50) + Math.min(150, ...c.enemies.map(enemy => lineDistance(enemy, p, target))) * .45 + randomUnit(random) * 12 }));
  scored.sort((a, b) => b.score - a.score);
  return { x: c.goalX, y: clamp(scored[0].target.y + (randomUnit(random) - .5) * 8, FIELD.goalTop + 12, FIELD.goalBottom - 12) };
}

export function updateBotPlayer(game, p, dt) {
  const c = context(game, p), { s, b, enemy, mate, own, goalX, goalDistance, dir } = c;
  game.botBrains ||= {};
  const brain = game.botBrains[p.id] ||= { think: 0, skillThink: 0, decision: { keys: {} }, shot: null, skillCursor: p.id };
  const random = game.options?.botRandom || Math.random, send = input => game.setInput(p.id, input);
  brain.think -= dt; brain.skillThink -= dt;
  if (!own) brain.shot = null;
  if (!['play', 'playing'].includes(s.phase) || p.stun > 0 || p.recovery > 0 || s.kickoff && s.kickoff.team !== p.team) { brain.shot = null; send({ keys: {}, shootHeld: false }); return; }
  if (!own && b.owner == null && !b.pass && b.lastKickTeam === p.team && b.lastKickAgo < .4) { send({ keys: {}, shootHeld: false }); return; }
  const awakening = ROSTER.find(character => character.id === p.character)?.awakening;
  if (p.awakeningCharge >= 100 && !p.awakened && awakening && !p.motion && (s.awakeningOwner == null || s.awakeningOwner === p.id) && (awakening.requires === 'any' || awakening.requires === 'on-ball' && own || awakening.requires === 'off-ball' && !own)) {
    brain.shot = null; brain.skillThink = .9; send({ keys: {}, shootHeld: false, awaken: true }); return;
  }
  if (!brain.shot && brain.skillThink <= 0) {
    brain.skillThink = 1.15 + randomUnit(random) * .45;
    const choices = botSkillChoices(game, p);
    if (choices.length) {
      const followups = choices.filter(choice => choice.followup), eligible = followups.length ? followups : choices;
      const choice = eligible[(brain.skillCursor++ + Math.floor(randomUnit(random) * eligible.length)) % eligible.length];
      const aim = choice.aim || chooseBotAim(game, p, random);
      send({ ...brain.decision, aim, shootHeld: false, skill: choice.slot + 1 });
      return;
    }
  }
  const teamPassAt = s.lastTeamPassAt?.[p.team] ?? -10, pressure = enemy && game.distance(p, enemy) < 140;
  if (own && !p.motion && mate && goalDistance > 180 && s.elapsed - teamPassAt > 3.5 && game.distance(p, mate) > 85 && (pressure || (mate.x - p.x) * dir > 45 || goalDistance > 450)) {
    if (game.pass(p, mate, { power: 18 })) { s.lastTeamPassAt ||= [-10, -10]; s.lastTeamPassAt[p.team] = s.elapsed; brain.shot = null; send({ keys: {}, shootHeld: false }); return; }
  }
  const shootingLane = goalDistance <= 650 && (Math.abs(p.y - MID.y) <= 210 || goalDistance < 280);
  if (own && shootingLane && !p.motion) {
    if (!brain.shot) brain.shot = { aim: chooseBotAim(game, p, random), ultraShot: game.ultraReady(p), power: 18 + randomUnit(random) * 6, strafe: randomUnit(random) < .5 ? -1 : 1, startedAt: s.elapsed };
    const shot = brain.shot, keeper = s.keepers?.find(k => k.team !== p.team), keeperClose = keeper && game.distance(p, keeper) < 115;
    const release = p.charge >= shot.power || p.charging && (keeperClose && p.charge >= 5 || goalDistance < 280 && p.charge >= 14 || enemy && game.distance(p, enemy) < 90 && p.charge >= 12);
    if (p.y <= 240) shot.strafe = 1; if (p.y >= 460) shot.strafe = -1;
    const advance = goalDistance > 460 && s.elapsed - shot.startedAt < .65;
    const keys = release ? {} : { w: shot.strafe < 0, s: shot.strafe > 0, a: advance && p.team === 1, d: advance && p.team === 0 };
    send({ keys, aim: shot.aim, ultraShot: !!shot.ultraShot, shootHeld: !release, ...(release ? { shootRelease: true } : {}) });
    game.botShot = shot;
    if (release) { brain.shot = null; game.botShot = null; }
    return;
  }
  if (brain.think <= 0) {
    brain.think = .14;
    let tx = b.x, ty = b.y;
    const allies = s.players.filter(q => q.team === p.team), nearest = allies.slice().sort((a, q) => game.distance(a, b) - game.distance(q, b))[0];
    if (own) { tx = goalX; ty = MID.y + Math.sin(s.elapsed * .9) * 100; }
    else if (c.carrier?.team === p.team) { tx = clamp(c.carrier.x + dir * 150, FIELD.left + 100, FIELD.right - 100); ty = clamp(c.carrier.y + (c.carrier.y < MID.y ? 175 : -175), FIELD.top + 60, FIELD.bottom - 60); }
    else if (c.enemyCarrier) {
      const nearestDefender = allies.slice().sort((a, q) => game.distance(a, c.carrier) - game.distance(q, c.carrier))[0];
      if (nearestDefender === p) { tx = c.carrier.x - dir * 25; ty = c.carrier.y; }
      else { tx = c.carrier.x - dir * 120; ty = clamp(MID.y + (p.id < 2 ? -130 : 130), FIELD.top + 40, FIELD.bottom - 40); }
    } else if (typeof b.owner === 'string') { tx = p.team ? 760 : 440; ty = MID.y + (p.id < 2 ? -95 : 95); }
    else if (nearest !== p) { tx = clamp(b.x + dir * 120, FIELD.left + 80, FIELD.right - 80); ty = clamp(b.y + (p.id < 2 ? -140 : 140), FIELD.top + 50, FIELD.bottom - 50); }
    const dx = tx - p.x, dy = ty - p.y;
    brain.decision = { keys: { w: dy < -13, s: dy > 13, a: dx < -13, d: dx > 13 }, aim: { x: goalX, y: MID.y } };
    if (own && enemy && game.distance(p, enemy) < 90 && p.dribbleCd <= 0) send({ ...brain.decision, action: true });
    else if (!own && (!c.carrier || c.carrier.team !== p.team) && game.distance(p, b) < 105 && p.slideCd <= 0 && b.z === 0) send({ ...brain.decision, action: true });
  }
  game.botDecision = brain.decision; send({ ...brain.decision, shootHeld: false });
}
