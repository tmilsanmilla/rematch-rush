import { ROSTER, getSkills } from './characters.js?v=9';

const FIELD = { left: 70, right: 1130, top: 65, bottom: 635, goalTop: 260, goalBottom: 440 };
const MID = { x: 600, y: 350 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomUnit = random => clamp(Number(random()) || 0, 0, .999999999);
export const BOT_CHARACTER_IDS = Object.freeze(ROSTER.map(character => character.id));

export function selectBotCharacter(random = Math.random) {
  return BOT_CHARACTER_IDS[Math.floor(randomUnit(random) * BOT_CHARACTER_IDS.length)];
}


export function balanceBotCharacters(players,random=Math.random,manual={}) {
  const humans=players.filter(p=>!p.isBot),bots=players.filter(p=>p.isBot);
  if(!humans.length)return players;
  const offset=Math.floor(randomUnit(random)*humans.length);
  bots.forEach((bot,index)=>{
    if(manual[bot.id]){bot.character=ROSTER.some(r=>r.id===manual[bot.id])?manual[bot.id]:'none';return;}
    const source=humans[bots.length<humans.length?Math.floor(randomUnit(random)*humans.length):(index+offset)%humans.length];
    const rarity=ROSTER.find(r=>r.id===source.character)?.rarity||'starter',pool=ROSTER.filter(r=>r.rarity===rarity);
    bot.character=pool[Math.floor(randomUnit(random)*pool.length)]?.id||'none';
  });return players;
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
  if (!brain.shot && brain.skillThink <= 0 && (!own || game.shotReady(p))) {
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
  // Respond to visible tackles before committing to a shot. The escape side is
  // sampled per encounter, not the same clock-driven left/right weave each time.
  if (own && enemy && p.dribbleCd <= 0 && !p.motion && game.distance(p, enemy) < 145 && enemy.motion?.steal) {
    if (brain.evadeTarget !== enemy.id || s.elapsed >= (brain.evadeUntil || 0)) {
      brain.evadeTarget = enemy.id; brain.evadeUntil = s.elapsed + .6;
      brain.escapeSide = randomUnit(random) < .5 ? -1 : 1;
    }
    const dx = Math.abs(p.x - enemy.x) > 15 ? Math.sign(p.x - enemy.x) : dir;
    const dy = p.y < FIELD.top + 80 ? 1 : p.y > FIELD.bottom - 80 ? -1 : brain.escapeSide;
    const keys = { a: dx < 0, d: dx > 0, w: dy < 0, s: dy > 0 };
    // First turn via real movement; the eventual dash then follows this escape
    // direction instead of always using the previous forward-facing angle.
    brain.shot = null; brain.decision = { keys, aim: { x: goalX, y: clamp(p.y + dy * 130, FIELD.top + 40, FIELD.bottom - 40) } };
    if ((Math.cos(p.angle) * dx + Math.sin(p.angle) * dy) / Math.SQRT2 > .92) send({ ...brain.decision, action: true, shootHeld: false });
    else send({ ...brain.decision, shootHeld: false });
    return;
  }
  const teamPassAt = s.lastTeamPassAt?.[p.team] ?? -10, pressure = enemy && game.distance(p, enemy) < 140;
  if (own && !p.motion && mate && goalDistance > 180 && s.elapsed - teamPassAt > 3.5 && game.distance(p, mate) > 85 && (pressure || (mate.x - p.x) * dir > 45 || goalDistance > 450)) {
    if (game.pass(p, mate, { power: 18 })) { s.lastTeamPassAt ||= [-10, -10]; s.lastTeamPassAt[p.team] = s.elapsed; brain.shot = null; send({ keys: {}, shootHeld: false }); return; }
  }
  const shootingLane = goalDistance <= 650 && (Math.abs(p.y - MID.y) <= 210 || goalDistance < 280);
  if (own && shootingLane && !p.motion && game.shotReady(p)) {
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
    brain.think = .10 + randomUnit(random) * .07;
    let tx = b.x, ty = b.y;
    const allies = s.players.filter(q => q.team === p.team), nearest = allies.slice().sort((a, q) => game.distance(a, b) - game.distance(q, b))[0];
    if (own) {
      if (!brain.runLane || s.elapsed >= brain.runLane.until) {
        brain.escapeSide = randomUnit(random) < .5 ? -1 : 1;
        brain.runLane = { y: clamp(p.y + brain.escapeSide * (55 + randomUnit(random) * 100), FIELD.top + 55, FIELD.bottom - 55), until: s.elapsed + .6 + randomUnit(random) * .8 };
      }
      tx = goalX; ty = brain.runLane.y;
      if (enemy && game.distance(p, enemy) < 150) ty = clamp(enemy.y + brain.escapeSide * 115, FIELD.top + 45, FIELD.bottom - 45);
    }
    else if (c.carrier?.team === p.team) { tx = clamp(c.carrier.x + dir * 150, FIELD.left + 100, FIELD.right - 100); ty = clamp(c.carrier.y + (c.carrier.y < MID.y ? 175 : -175), FIELD.top + 60, FIELD.bottom - 60); }
    else if (c.enemyCarrier) {
      const nearestDefender = allies.slice().sort((a, q) => game.distance(a, c.carrier) - game.distance(q, c.carrier))[0];
      const carrier = c.enemyCarrier, homeX = p.team ? FIELD.right : FIELD.left;
      const old = brain.observedCarrier, elapsed = old?.id === carrier.id ? s.elapsed - old.at : 0;
      const vx = elapsed > 0 ? clamp((carrier.x - old.x) / elapsed, -250, 250) : 0;
      const vy = elapsed > 0 ? clamp((carrier.y - old.y) / elapsed, -250, 250) : 0;
      brain.observedCarrier = { id: carrier.id, x: carrier.x, y: carrier.y, at: s.elapsed };
      const predicted = { x: clamp(carrier.x + vx * .22, FIELD.left, FIELD.right), y: clamp(carrier.y + vy * .22, FIELD.top, FIELD.bottom) };
      const gx = homeX - predicted.x, gy = MID.y - predicted.y, length = Math.hypot(gx, gy) || 1;
      const protectedCarrier = carrier.dribble > 0 || carrier.invincible > 0 || game.autoDribbling(carrier);
      if (nearestDefender === p) {
        const distance = game.distance(p, carrier), beaten = (p.x - carrier.x) * -dir < 0;
        const gap = protectedCarrier ? 110 : beaten ? 140 : length < 260 ? 48 : 72;
        tx = predicted.x + gx / length * gap; ty = predicted.y + gy / length * gap;
        if (distance < 110 && !protectedCarrier && !beaten) {
          brain.challengeAt ??= s.elapsed + .12 + randomUnit(random) * .24;
          if (s.elapsed >= brain.challengeAt) { tx = predicted.x; ty = predicted.y; }
        } else brain.challengeAt = null;
      } else {
        // Cover the shooting lane and a second runner rather than stack on the ball.
        const runner = c.enemies.filter(q => q.id !== carrier.id).sort((a, b) => Math.abs(a.x - homeX) - Math.abs(b.x - homeX))[0];
        tx = predicted.x + gx / length * 160;
        ty = runner ? runner.y * .65 + MID.y * .35 : predicted.y + gy / length * 160;
      }
      tx = clamp(tx, FIELD.left + 35, FIELD.right - 35); ty = clamp(ty, FIELD.top + 35, FIELD.bottom - 35);
    } else if (typeof b.owner === 'string') {
      const keeper=s.keepers.find(k=>k.id===b.owner),friendly=keeper?.team===p.team;
      if(brain.keeperId!==b.owner||!brain.keeperLane||s.elapsed>brain.keeperLane.until){
        const spread=randomUnit(random),side=randomUnit(random)<.5?-1:1;
        brain.keeperId=b.owner;brain.keeperLane={x:(friendly?(p.team?840:360):(p.team?480:720))+dir*(spread-.5)*180,y:MID.y+side*(65+randomUnit(random)*150),until:s.elapsed+.65+randomUnit(random)*.65};
      }
      tx=brain.keeperLane.x;ty=brain.keeperLane.y;
      if(friendly&&enemy&&game.distance(p,enemy)<110)ty=clamp(ty+(p.y>enemy.y?85:-85),FIELD.top+45,FIELD.bottom-45);
      if(!friendly&&c.enemy){tx=clamp((c.enemy.x+(p.team?1130:70))*.5,FIELD.left+120,FIELD.right-120);ty=clamp(c.enemy.y+(p.id%2?1:-1)*(45+randomUnit(random)*40),FIELD.top+50,FIELD.bottom-50);}
    }
    else if (nearest !== p) { tx = clamp(b.x + dir * 120, FIELD.left + 80, FIELD.right - 80); ty = clamp(b.y + (p.id < 2 ? -140 : 140), FIELD.top + 50, FIELD.bottom - 50); }
    const dx = tx - p.x, dy = ty - p.y;
    brain.decision = { keys: { w: dy < -13, s: dy > 13, a: dx < -13, d: dx > 13 }, aim: { x: goalX, y: MID.y } };
    const target = c.enemyCarrier || (c.loose ? b : null), distance = target ? game.distance(p, target) : Infinity;
    const facing = target && (Math.cos(p.angle) * (target.x - p.x) + Math.sin(p.angle) * (target.y - p.y)) / Math.max(1, distance);
    if (!own && target && distance < 82 && facing > .72 && p.slideCd <= 0 && b.z === 0 && !target.dribble && !target.invincible && !game.autoDribbling(target) && (!c.enemyCarrier || s.elapsed >= (brain.challengeAt ?? Infinity))) {
      send({ ...brain.decision, action: true }); brain.challengeAt = null;
    }
  }
  game.botDecision = brain.decision; send({ ...brain.decision, shootHeld: false });
}
