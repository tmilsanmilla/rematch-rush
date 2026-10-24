const S = (name, cooldown, description, extra = {}) => ({ name, cooldown, description, ...extra });
const YELLOW = '#ffe45e';
const ORANGE = '#ff923d';
const CYAN = '#5cf4ff';
const PURPLE = '#c17aff';
const RED = '#ff4165';
const GREEN = '#75ff98';
const ICE = '#a7f0ff';
const GREY = '#d3dde7';
const PINK = '#ff84cf';
const BLUE = '#5eabff';

export const ROSTER = [
  {
    id: 'none', name: 'Characterless', rarity: 'starter', color: '#b7c7dc',
    tip: 'Your story starts on the pitch.', description: 'Master the fundamentals, then spin for your first playing style.',
    skills: [], awakening: null,
  },
  {
    id: 'manmarker', name: 'Manmarker', rarity: 'common', color: YELLOW,
    tip: 'Control the field. Spot weak points. Defend with your life.',
    description: 'An unrelenting defender who steals possession and shuts down attacking lanes.',
    skills: [
      S('Opportunistic steal', 26, 'Dash with a yellow aura. Steal possession and stun the carrier for 1.5s; a dribble turns the stun against you.'),
      S('MANMARK', 30, 'Lock onto a nearby opponent for 5s. Match their movement, intercept passes, and reflect shots at half power.'),
    ],
    awakening: { name: 'Defend this play', duration: 45, requires: 'off-ball', description: 'Off-ball only. Unlock Advantageous blindspot for 45 seconds.', quotes: ['I’ll defend this play…', 'Just try and get past me'], skills: [S('Advantageous blindspot', 0, 'Rush a nearby ball carrier and clear the ball at 50 power.', { once: true })] },
  },
  {
    id: 'ice', name: 'Ice', rarity: 'common', color: ICE,
    tip: 'Freeze the defense. Deliver the perfect assist.', description: 'Instant chemistry, a close-range nutmeg, and perfectly curved icy passes.',
    skills: [
      S('Perfect chemistry', 40, 'On-ball, cursor on a teammate: an instant unblockable pass within one third of the field. An out-of-range target never spends the cooldown.'),
      S('Point Blank Nutmeg', 20, 'On-ball with an opponent ahead: nutmeg and stun them for 0.5s, then dash around them with invincibility.'),
    ],
    awakening: { name: 'Freeze like the others', duration: 45, requires: 'any', description: 'Unlock the perfectly curved ICE cold assist for 45s.', quotes: ['Out of my way… OR FREEZE LIKE THE OTHERS!!!!'] },
  },
  {
    id: 'powershooter', name: 'Powershooter', rarity: 'rare', color: ORANGE,
    tip: 'One opening. One shot. Make it count.', description: 'Airborne power shots and a bruising charge that wins the ball.',
    skills: [
      S('Power shot', 32, 'Wind up for 1s with invincibility, then launch an orange airborne shot at 45 power.'),
      S('Brute force', 24, 'Charge forward and steal the ball, launching the opponent back with a 1s stun. A dribble reverses the impact.'),
    ],
    awakening: { name: 'One shot match', duration: 45, requires: 'on-ball', description: 'On-ball only. Power shot becomes WILDCARD and Trivela screamer is unlocked.', quotes: ['This is a one shot match, and that shot is MINE!'] },
  },
  {
    id: 'ninja', name: 'Ninja', rarity: 'rare', color: GREEN,
    tip: 'Find the unseen lane. Arrive before they notice.', description: 'Disappear off the ball, then slip through the defense with two sudden changes of direction.',
    skills: [
      S('Stealthy steps', 27, 'Off-ball: become invisible to opponents and move 25% faster for 5s. Touch the ball to steal it; a dribble reveals and stuns you for 2s.'),
      S('Maneuvering dribble', 15, 'On-ball: leave green afterimages and dash a fifth of the pitch forward. Unlocks Precision burst.'),
    ],
    awakening: { name: 'Unseen speed', duration: 45, requires: 'on-ball', description: 'Gain a strong green aura, 10s Stealthy steps, and the once-only Mysterious knuckle.', quotes: ['Only the fools that can keep up with me will be able to see what happens next'] },
  },
  {
    id: 'playmaker', name: 'Playmaker', rarity: 'epic', color: CYAN,
    tip: 'See the space. Shape the play.', description: 'Read the field, evade pressure, and create chances with precision passes.',
    skills: [
      S('Observational status', 40, 'Move 30% faster and recover from ragdolls 50% faster for 10s.'),
      S('Empty-space dribble', 25, 'On-ball: dash vertically, then cut forward with invincibility.'),
      S('COUNTER!', 30, 'Off-ball: a teammate passes to you from within half the pitch, then gains double speed for 5s. On-ball: Beautiful pass sends an airborne curved pass to your nearest teammate.'),
    ],
    awakening: { name: 'My vision', duration: 50, requires: 'off-ball', description: 'Off-ball only. Upgrade every skill with METAVISION, Injury-inducing swerve, and two precision team plays.', quotes: ['My vision… my passes… WILL BE THE REASON WE WIN!'] },
  },
  {
    id: 'falcon', name: 'Falcon', rarity: 'epic', color: GREY,
    tip: 'Own the sky. Meet the ball before anyone else.', description: 'Aerial volleys, predatory sprints, and wall-bounce dribbles.',
    skills: [
      S('Skyward Volley', 25, 'An airborne ball within one eighth of the field: leap and volley a 50-power shot at your cursor. Unavailable for 0.5s after a goalkeeper throw.'),
      S('Predator Eye', 20, 'Off-ball, within one third of the field: sprint toward the ball at 150% speed.'),
      S('Aerial Dribble', 25, 'On-ball: chip the ball a third of the field forward, then dash to regain possession.'),
    ],
    awakening: { name: 'Superpowered shot', duration: 45, requires: 'any', description: 'Replace Skyward Volley and Aerial Dribble with a bicycle kick and Sky domination for 45s.', quotes: ['Watch my superpowered shot…'] },
  },
  {
    id: 'streetdribbler', name: 'Street Dribbler', rarity: 'legendary', color: PURPLE,
    tip: 'Make the pitch your dance floor.', description: 'Purple and orange flair, unstoppable footwork, and spectacular curved finishes.',
    skills: [
      S('A finta imparável', 20, 'On-ball: a short backward feint, then an invincible dash a quarter of the pitch forward.'),
      S('Roleta magnífica', 24, 'On-ball: roulette forward a fifth of the pitch with invincibility, stunning nearby opponents for 0.5s. Follow with Meta no prazo.'),
      S('Drible com ginga', 27, 'On-ball: dribble half the pitch at 50% above normal walking speed.'),
    ],
    awakening: { name: 'Ginga', duration: 45, requires: 'on-ball', description: 'On-ball only. Unlock Destruição total do campo and Curva de horas extras.', quotes: ['Ginga dribbling… is called ginga dribbling', 'because as the people fall down after they’ve been dribbled… it looks like they’re dancing'] },
  },
  {
    id: 'magician', name: 'Magician', rarity: 'legendary', color: PINK,
    tip: 'Cast the pass that changes everything.', description: 'Elusive pink footwork, perfect team passes, and spectacular spell-binding finishes.',
    passive: { name: 'Better together', description: 'Teammates gain +5 shot power.' },
    skills: [
      S('Magician’s weave', 27, 'On-ball: weave up a quarter field, forward a quarter, then diagonally forward and down a fifth with invincibility.'),
      S('Perfect Pass Cast', 25, 'On-ball with a teammate: a perfect curved pink pass to your farthest teammate, without a range limit.'),
      S('My Assist', 35, 'On-ball with a teammate: pass to your nearest teammate, who immediately shoots at your cursor with 50 power.'),
    ],
    awakening: { name: 'Best midfielder', duration: 60, requires: 'on-ball', description: 'Replace all moves with Advanced Spell-Binding and a solo 90-power finish for 60s.', quotes: ['With his help… I can become the best midfielder, and he the best striker', 'And anyone who stands in our way… IS AS GOOD AS DEAD!'] },
  },
  {
    id: 'supersonic', name: 'Supersonic', rarity: 'master', color: RED,
    tip: 'The best striker in the world is already ahead.', description: 'The fastest player alive. Turn speed into steals, counters, and decisive goals.',
    passive: { name: 'Fastest in the world', description: 'Always move 50% faster.', speedMultiplier: 1.5 },
    skills: [
      S('HIGH SPEED DECIMATION DRIBBLE', 25, 'On-ball: blaze forward a third of the pitch, then cut to the center of the goal.'),
      S('PERFECTLY READ', 28, 'Off-ball: wind up for 0.5s, dash in front of the ball carrier, steal, and stun for 1s. A successful steal unlocks PINPOINT 1-2.'),
      S('LOOSE BALL', 20, 'Off-ball: dash three quarters of the distance to a loose ball. Collect it to gain +20 shot power for 5s.'),
    ],
    awakening: { name: 'World’s best striker', duration: 60, requires: 'any', description: 'Upgrade every move for 60s. Awakening on-ball also unlocks WORLD RECORD SPEED; awakening off-ball seizes possession.', quotes: ['The best striker in the world… IS ME!', 'From this distance, you’ve got nothing but weak spots!'] },
  },
  {
    id: 'trapper', name: 'Trapper', rarity: 'world class', color: BLUE,
    tip: 'One touch is all it takes.', description: 'Trap airborne shots, bait tackles with fake volleys, and unleash an ultimate revolving finish.',
    passive: { name: 'First touch', description: 'For 2.5s after receiving possession, gain +100% speed and +20 shot power. Awakening doubles those bonuses.' },
    skills: [
      S('Trap', 20, 'Off-ball: leap for up to 3s and trap any nearby shot, including airborne balls. On-ball: Trap: Volley fires a 65-power aerial shot with a 25s shared cooldown.'),
      S('Zero-Reset Turn', 15, 'On-ball: turn a fifth of the field backward, stunning nearby opponents for 2s with invincibility. Unlocks Direct Heel Drive.'),
      S('Fake Volley', 15, 'On-ball: stand with invincibility for 2s. A tackle is countered with a 2s stun and resets this cooldown. Three consecutive counters unlock Juggling Destroyer Shot.'),
    ],
    awakening: { name: 'Too lazy for this', duration: 75, requires: 'on-ball', description: 'Double the first-touch bonuses and replace every move for 75s.', quotes: ['god, I’m too lazy for this. Oh well, just try and take it from me'] },
  },
  {
    id: 'serpent', name: 'Serpent', rarity: 'epic', color: GREEN,
    tip: 'Turn the defensive situation into your attack.', description: 'Green-aura headers, an unstoppable charge, and intelligent team interceptions.',
    skills: [
      S('Serpentine Header', 20, 'Off-ball: jump to clear a nearby ball with 30 power, or 50 if it had airtime.'),
      S('Charge Press', 25, 'An opposing carrier must be ahead: wind up for 2s, then steal through their dribble and stun them for 0.75s. A missed charge stuns you for 1s.'),
      S('Take The Bait', 25, 'Team modes only: mark the farthest opponent. Intercept a ball headed toward them and kick it to your teammate.'),
    ],
    awakening: { name: 'I AM UNSTOPPABLE!', duration: 50, requires: 'off-ball', description: 'Off-ball: replace your first two moves with Ultimate Clearance and a goalkeeper-distribution finish for 50s.', quotes: ['This defensive situation is sparking a new feeling…', 'I AM UNSTOPPABLE!'] },
  },
  {
    id: 'butterflydancer', name: 'Butterfly Dancer', rarity: 'world class', color: YELLOW,
    tip: 'Now… IT’S SHOWTIME!', description: 'Dazzling yellow wings, flowing dribbles, and unstoppable topspin chips.',
    passive: { name: 'Butterfly rhythm', description: 'Dribbles last 0.5s longer with 0.5s less cooldown. For 5s after an ankle break, gain +20% speed and +10 shot power; does not stack.' },
    skills: [
      S('Abrirse paso cortando', 19, 'On-ball: dash half a field forward, a third backward, then a quarter diagonally down and forward with yellow butterfly wings.'),
      S('El primer toque es suficiente', 25, 'Off-ball with a loose or airborne ball: rush to trap it, heel-flick, then dash a third of the field. On-ball: Todos ellos caen weaves through three diagonal sixth-field dashes and stuns opponents for 2s. Follow with Corte mariposa for a 30s combined cooldown.'),
      S('Golpe de aproximación', 23, 'On-ball: a vulnerable 1.5s windup into an untrappable 10-power airborne topspin chip. Maintains speed for 5s; almost impossible to save unless directly at the keeper.'),
    ],
    awakening: { name: 'IT’S SHOWTIME!', duration: 60, requires: 'on-ball', description: 'Gain large transparent yellow butterfly wings and replace every move for 60s.', quotes: ['Now…', 'IT’S SHOWTIME!'] },
  },
  {
    id: 'emperor', name: 'Emperor', rarity: 'master', color: BLUE,
    tip: 'BOW BEFORE ME!', description: 'Perfectly accurate impact shots, curved volleys, and devastating blue-rose finishes.',
    passive: { name: 'Imperial authority', description: 'Always gain +20 shot power, increased to +35 in your own half. Receiving a Magician pass grants +5 additional power and 0.35s longer dribbles until possession ends.' },
    skills: [
      S('Unstoppable impact', 24, 'On-ball: wind up vulnerably for 0.5s, then fire a perfectly accurate 80-power shot with alternating blue and red aura.'),
      S('Emperor’s route', 20, 'Off-ball: two quarter-field dashes, blue then red, separated by 0.2s. Subjugation forces another carrier to send an interceptable pass, stunning an opponent for 1s. On-ball: Emperor’s dribble travels slightly farther; IMPACT follows with a vulnerable 70-power accurate shot. Combined cooldown: 30s.'),
      S('Emperor’s volley', 27, 'Volley a nearby airborne ball, or force a teammate to pass first, then fire a curved 75-power shot with blue roses.'),
      S('Emperor’s lackey', 90, 'Chemical reaction with a Magician teammate: both press 4 while Magician holds the ball. Receive an interceptable airborne pass at halfway, then fire a 100-power automatic goal. Interception causes a 45s cooldown; success causes 90s. Awakening moves this to 5.'),
    ],
    awakening: { name: 'BOW BEFORE ME!', duration: 75, requires: 'on-ball', description: 'Gain blue aura and roses. Replace all four moves, move the chemical reaction to slot 5, and refresh its cooldown for 75s.', quotes: ['Hey, there, everyone', 'BOW BEFORE ME!'] },
  },
].map(character => ({ ...character, skills: character.skills.map((skill, index) => ({ ...skill, key: String(index + 1), slot: index })) }));

const byId = Object.fromEntries(ROSTER.map(character => [character.id, character]));
const idOf = character => typeof character === 'string' ? character : character?.character?.id || character?.character || character?.id || 'none';
const skillList = list => list.map((skill, index) => ({ ...skill, key: String(index + 1), slot: index }));

export function getSkills(character, awakened = false, hasBall = false) {
  const id = idOf(character);
  const state = typeof character === 'object' ? character.ability || {} : {};
  let skills = (byId[id] || byId.none).skills.map(skill => ({ ...skill }));
  if (id === 'ice' && awakened) skills.push(S('ICE cold', 20, 'On-ball, cursor on a teammate: a cutscene into a perfect curved assist.'));
  if (id === 'ninja') {
    if (awakened) skills[0] = S('Stealthy steps', 27, 'Off-ball: invisible to opponents for 10s, with +25% speed. Touching the ball reveals you.');
    if (state.precisionFollowup > 0) skills[1] = S('Precision burst', 20, 'Follow-up, on-ball: dash a quarter of the field forward with invincibility.', { followup: true });
    if (awakened) skills.push(S('Mysterious knuckle', 0, 'On-ball: a 65-power unpredictable knuckleball.', { once: true, used: !!state.knuckleUsed }));
  }
  if (id === 'falcon' && awakened) {
    skills[0] = S('25 METER BICYCLE', 0, 'On-ball: a cinematic airborne 80-power bicycle kick.', { once: true, used: !!state.bicycleUsed });
    skills[2] = S('Sky domination', 20, 'On-ball: a 90-power wall pass that cannot score, followed by a sprint to intercept the rebound.');
  }
  if (id === 'magician') {
    if (state.placementFollowup > 0) skills[0] = S('Placement Over Power', 30, 'Follow-up, on-ball: a perfect pass to your nearest teammate within half the field.', { followup: true });
    if (awakened) skills = [
      S('Advanced Spell-Binding - DISAPPEAR!', 25, 'On-ball in your own half: cut diagonally forward and up, then drive to the opponent’s bottom corner.'),
      hasBall ? S('Advanced Spell-Binding - Instant Pay-Off', 50, 'Hold possession for at least 10s, then execute a perfect team return and an instant 100-power header. Requires a teammate.') : S('Advanced Spell-Binding - COUNTERATTACK!', 20, 'Loose ball with a teammate: rush to it and deliver a perfect pass.'),
      S('MAY THE BEST STRIKER SCORE!', 0, 'On-ball: turn the apparent pass into a 90-power shot at your cursor.', { once: true, used: !!state.bestStrikerUsed }),
    ];
  }
  if (id === 'trapper') {
    skills[0] = hasBall ? S('Trap: Volley', 25, 'On-ball: leap into a 65-power aerial volley.') : S('Trap', 20, 'Off-ball: leap for 3s and trap any nearby shot, including airborne balls. Cooldown begins when the leap ends.');
    if (state.heelFollowup > 0) skills[1] = S('Direct Heel Drive', 20, 'Follow-up, on-ball: two invincible quarter-field blue dashes, stunning opponents in your path for 1s.', { followup: true });
    if (state.fakeVolleyStreak >= 3) skills[2] = S('Juggling Destroyer Shot', 20, 'Three successful fake volleys unlock this invincible 100-power instant goal.');
    if (awakened) skills = [
      hasBall ? S('DEATH TRAP', 30, 'On-ball with an opponent ahead: fake, stun them, and smash an 80-power airborne shot.') : S('Two-Stage Fake Volley', 32, 'Loose ball: rush to it, then fire a 75-power aerial volley.'),
      hasBall ? S('Adaptive Playstyle', 23, 'On-ball: chip into a curved 75-power scorpion kick.') : S('Mid-Air Trap', 25, 'Immediately after an opponent shoots: rush to the shot and claim possession.'),
      S('FIVE STAGE ULTIMATE HEXCHAMBER REVOLVER SHOT', 0, 'Immediately after an opponent shoots: trap it, feint through five stages, and fire a perfectly accurate 100-power volley.', { once: true, used: !!state.hexchamberUsed }),
    ];
  }
  if (id === 'manmarker' && awakened) skills.push(S('Advantageous blindspot', 0, 'Off-ball, close to the opponent: seize and clear the ball at 50 power.', { once: true, used: !!state.blindspotUsed }));
  if (id === 'powershooter' && awakened) {
    skills[0] = S('WILDCARD', 30, 'Loose ball only: rush to the ball and launch an airborne 55-power shot in a cutscene.');
    skills.push(S('Trivela screamer', 0, 'On-ball: a 3s cutscene windup into a curved 80-power shot with 35% less accuracy.', { once: true, used: !!state.trivelaUsed }));
  }
  if (id === 'playmaker') {
    skills[2] = hasBall ? S('Beautiful pass', 45, 'An airborne, perfectly curved full-field pass to your nearest teammate. Requires a teammate.') : S('COUNTER!', 30, 'A teammate within half the field passes to you and gains double speed for 5s. Requires a teammate.');
    if (awakened) skills = [
      S('METAVISION', 40, 'Move 50% faster and become immune to ragdolls for 10s.'),
      S('Injury-inducing swerve', 30, 'On-ball with an opponent ahead: bait their run, suddenly stop, stun them for 2s, and accelerate away.'),
      hasBall ? S('Incomprehensible drive', 0, 'Three automatic team passes, a corner run, and an airborne rabona into the box. Requires a teammate.', { once: true, used: !!state.driveUsed }) : S('MINE.', 0, 'A teammate passes to you, then a vulnerable 2s windup sends an unpredictable 20-power knuckleball. Requires a teammate.', { once: true, used: !!state.mineUsed }),
    ];
  }
  if (id === 'streetdribbler') {
    if (state.rouletteFollowup > 0) skills[1] = S('Meta no prazo', 34, 'Follow-up: a vulnerable 1s windup, then an airborne, wildly curved 75-power shot.', { followup: true });
    if (awakened) {
      skills[0] = S('Destruição total do campo', 0, 'An aggressive half-field dribble floors everyone in your path. Reach the opposing box to nutmeg the keeper and score.', { once: true, used: !!state.destructionUsed });
      skills[2] = S('Curva de horas extras', 0, 'An airborne 90-power curved shot, with 50% less accuracy.', { once: true, used: !!state.overtimeUsed });
    }
  }
  if (id === 'supersonic') {
    if (state.pinpointFollowup > 0) skills[1] = S('PINPOINT 1-2', 35, 'A perfect give-and-go with your farthest teammate. Requires a teammate.', { followup: true });
    skills[2] = hasBall ? S('VELOCITY-ABUSING COUNTER-DRIBBLE', 35, 'Stand still for 3s. A steal attempt triggers an invincible half-field dash and a 2s stun; a successful counter lowers cooldown to 10s.') : skills[2];
    if (awakened) {
      skills = [
        S('CAN’T CATCH ME NOW', 0, 'On-ball between halfway and the opposing box: disappear for 3s and reappear to fire a boosted 100-power shot. Keepers can still save it.', { once: true, used: !!state.catchUsed }),
        S('TOO SLOW, TOO SLOW', 0, 'Off-ball: take possession, then pass to a teammate or dash a third of the pitch in 1v1.', { once: true, used: !!state.tooSlowUsed }),
        S('EVERYTHING IS JUST… TOO SLOW', 0, 'Immediately after an opponent kicks: freeze the ball, rush to it, and clear at 95 power.', { once: true, used: !!state.everythingUsed }),
      ];
      if (state.onBallAwakening !== false) skills.push(S('WORLD RECORD SPEED', 0, 'Move at 300% of normal speed for 35s, with an intensified crimson aura.', { once: true, used: !!state.recordUsed }));
    }
  }
  if (id === 'serpent' && awakened) {
    skills[0] = S('Ultimate Clearance', 22, 'Loose ball or immediately after an opponent’s shot: rush to it and slam a 65-power clearance at your cursor.');
    skills[1] = S('I used to be a striker!', 0, 'Your goalkeeper’s throw must have just hit the floor: rush to it and strike with 70 power.', { once: true, used: !!state.serpentStrikerUsed });
  }
  if (id === 'butterflydancer') {
    skills[1] = hasBall ? S('Todos ellos caen', 25, 'On-ball: three diagonal sixth-field dashes, stunning opponents in your path for 2s. Unlocks Corte mariposa.') : skills[1];
    if (state.butterflyFollowup > 0) skills[1] = S('Corte mariposa', 30, 'Follow-up on-ball: weave a quarter-field forward, then cut vertically to line up with goal.', { followup: true });
    if (awakened) skills = [
      hasBall ? S('Destrucción del campo: versión perfeccionada', 26, 'Hold the ball in your own half for 5s: weave through the field, nutmeg the keeper and backheel an automatic goal.', { once: true, used: !!state.butterflyGoalUsed }) : S('Mío', 26, 'The opponent must hold the ball: rush to them, steal and stun for 3.5s.'),
      S('Golpe de aproximación perfeccionado', 27, 'On-ball: instantly chip an untrappable 10-power airborne topspin shot that never slows down.'),
      S('¡Baila con un propósito!', 25, 'On-ball: dribble with zero cooldown for 15s; the move’s 10s cooldown begins when the effect ends.'),
    ];
  }
  if (id === 'emperor') {
    skills[1] = hasBall ? S('Emperor’s dribble', 20, 'On-ball: two dashes slightly farther than a quarter-field, blue then red. Unlocks IMPACT.') : skills[1];
    if (state.emperorFollowup > 0) skills[1] = hasBall ? S('IMPACT', 30, 'Follow-up: a vulnerable 0.5s windup into a perfectly accurate 70-power shot.', { followup: true }) : S('Subjugation', 30, 'Follow-up: another carrier must hold the ball. Force an interceptable pass to you; opponents are stunned for 1s.', { followup: true });
    if (awakened) skills = [
      S('Fallrückzieher', 0, 'On-ball with an opponent ahead: leap over their back and fire a perfectly accurate 95-power bicycle kick.', { once: true, used: !!state.emperorBicycleUsed }),
      S('MOVE IT!', 0, 'Off-ball with another carrier: push them away and fire an 85-power shot at your cursor.', { once: true, used: !!state.emperorMoveUsed }),
      S('PERFEKTIONIERTER VOLLEY', 30, 'An airborne ball: leap to it and fire a heavily curved, nearly unsaveable 75-power volley toward the goal.'),
      S('MAGNUS: TOPSPIN', 0, 'On-ball: a 5s cinematic windup into an automatic goal; blue roses cover the goalbox.', { once: true, used: !!state.magnusUsed }),
      byId.emperor.skills[3],
    ];
    if (typeof character === 'object' && state.chemicalPartnerId == null) skills.splice(awakened ? 4 : 3, 1);
  }
  if (id === 'magician' && state.chemicalPartnerId != null) skills.push(S('Emperor’s lackey', 90, 'With an Emperor teammate: both press 4 while you have the ball to send an interceptable airborne pass. His awakened reaction uses 5.'));
  return skillList(skills);
}

const ability = p => p.ability || (p.ability = {});
const direction = p => p.team === 0 ? 1 : -1;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const colorOf = p => (byId[idOf(p)] || byId.none).color;
const facing = p => ({ x: Math.cos(Number.isFinite(p.angle) ? p.angle : p.team === 0 ? 0 : Math.PI), y: Math.sin(Number.isFinite(p.angle) ? p.angle : p.team === 0 ? 0 : Math.PI) });
const dist = (g, a, b) => g.distance ? g.distance(a, b) : Math.hypot(a.x - b.x, a.y - b.y);
const notify = (g, text) => { g.notify?.(text); return false; };
const effect = (g, type, p, color = colorOf(p), duration = 0.6) => g.effect?.(type, p.x, p.y, color, duration);
const opponents = (g, p) => g.state.players.filter(player => player.team !== p.team && !player.isKeeper && !player.keeper);
const closestEnemy = (g, p) => opponents(g, p).sort((a, b) => dist(g, p, a) - dist(g, p, b))[0];
const carrier = g => typeof g.state.ball.owner === 'object' ? g.state.ball.owner : g.state.players.find(player => player.id === g.state.ball.owner);
const enemyCarrier = (g, p) => { const owner = carrier(g); return owner && owner.team !== p.team ? owner : null; };
const teammate = (g, p) => g.teammate?.(p) || null;
const teammates = (g, p) => {
  const list = g.state.players.filter(other => other !== p && other.id !== p.id && other.team === p.team && !other.isKeeper && !other.keeper);
  const nominated = teammate(g, p);
  if (nominated && !list.includes(nominated)) list.push(nominated);
  return list;
};
const nearestTeammate = (g, p) => teammates(g, p).sort((a, b) => dist(g, p, a) - dist(g, p, b))[0];
const farthestTeammate = (g, p) => teammates(g, p).sort((a, b) => dist(g, p, b) - dist(g, p, a))[0];
const cursorTeammate = (g, p) => {
  const target = teammates(g, p).find(other => p.aim && dist(g, p.aim, other) <= 45);
  if (!target) notify(g, teammates(g, p).length ? 'Put your cursor on a teammate.' : 'This move requires a teammate and is unavailable in 1v1.');
  return target;
};
const enemyAhead = (g, p) => opponents(g, p).filter(other => (other.x - p.x) * direction(p) > 0 && Math.abs(other.y - p.y) < 125 && dist(g, p, other) < g.width / 6).sort((a, b) => dist(g, p, a) - dist(g, p, b))[0];
const ready = (g, p, condition, message) => condition || notify(g, message);
const onBall = (g, p) => ready(g, p, g.hasBall(p), 'You need the ball for this move.');
const offBall = (g, p) => ready(g, p, !g.hasBall(p), 'Use this move without the ball.');
const needsTeammate = (g, p) => { const player = teammate(g, p); if (!player) notify(g, 'This move requires a teammate and is unavailable in 1v1.'); return player; };
const cd = (p, slot, seconds) => { p.cooldowns[slot] = seconds; };
const spend = (g, p, key) => { const a = ability(p); if (a[key]) return notify(g, 'Already used during this awakening.'); a[key] = true; return true; };
const aura = (p, color, duration) => { p.aura = color; ability(p).auraLeft = Math.max(ability(p).auraLeft || 0, duration); };
const place = (g, p, x, y) => { p.x = clamp(x, 45, g.width - 45); p.y = clamp(y, 55, g.height - 55); };
const recover = (p, seconds, invincible = false) => { p.recovery = Math.max(p.recovery || 0, seconds); if (invincible) p.invincible = Math.max(p.invincible || 0, seconds + .1); };
const dash = (g, p, x, y, distance, duration, options = {}) => { aura(p, options.color || colorOf(p), duration + .2); g.dash(p, x, y, distance, duration, { color: colorOf(p), ...options }); };
const forwardDash = (g, p, distance, duration, options = {}) => dash(g, p, direction(p), 0, distance, duration, options);
const kick = (g, p, power, options = {}) => { g.kick(p, power, { color: colorOf(p), ...options }); if (options.savePower) g.state.ball.savePower = options.savePower; if (options.knuckle) g.state.ball.knuckle = true; };
const towardGoal = (g, p, power, options = {}) => {
  const previous = p.aim;
  const keeper = g.state.keepers?.[1 - p.team], corner = (keeper?.y ?? g.height / 2) >= g.height / 2 ? -65 : 65;
  p.aim = { x: p.team === 0 ? g.width : 0, y: g.height / 2 + corner };
  kick(g, p, power, options);
  p.aim = previous;
};
const pass = (g, from, to, { air = false, curve = 0, power = 60 } = {}) => {
  if (!g.hasBall(from)) return false;
  const oldAim = from.aim;
  from.aim = { x: to.x, y: to.y };
  kick(g, from, power, { air, curve, accuracy: 1, color: CYAN });
  from.aim = oldAim;
  // Normal ball physics still apply: ground passes can be intercepted.
  g.state.ball.passTarget = to.id;
  return true;
};
const later = (g, seconds, callback) => g.schedule(seconds, callback);
const cinematic = (g, duration, lines, p, callback, choreography = null) => g.cutscene(duration, lines, colorOf(p), callback, choreography ? { ...choreography, actorId: p.id, aim: choreography.aim || { ...p.aim } } : null);
const takeLoose = (g, p) => { if (g.state.ball.owner == null && !protectedBall(g)) { g.setOwner(p); return true; } return false; };
const trace = (g, p, target, count = 7) => {
  for (let i = 0; i < count; i++) g.effect?.('afterimage', p.x + (target.x - p.x) * i / count, p.y + (target.y - p.y) * i / count, colorOf(p), .9);
};
const frozenBall = g => ({ x: g.state.ball.x, y: g.state.ball.y });
const currentAwakening = p => p.awakened && p.awakeningLeft > 0;
const protectedBall = g => !!(g.state.ball.perfectPass || g.state.ball.scriptedGoal || g.state.ball.magnusFlight || g.state.ball.unstoppableAir);
const recentOpponentShot = (g, p) => {
  const b = g.state.ball;
  return b.owner == null && b.lastKickTeam != null && b.lastKickTeam !== p.team && b.lastKickAgo < 1.6 && !protectedBall(g) && b.finish?.source !== 'distribution';
};
const perfectPass = (g, from, to, { instant = false, curve = .6, color = colorOf(from), onReceive = null, aim = null } = {}) => {
  if (!g.hasBall(from) || !to) return false;
  const origin = { x: from.x, y: from.y };
  trace(g, from, to, 8); aura(from, color, 1); aura(to, color, 1);
  if (instant) { if (g.setOwner(to) === false) return false; g.recordKickCharge?.(from); effect(g, 'touch', to, color); return true; }
  const duration = clamp(dist(g, from, to) / 1800, .25, .8), b = g.state.ball;
  Object.assign(b, { owner: null, x: origin.x, y: origin.y, vx: 0, vy: 0, vz: 0, z: 12, curve: 0, color, power: 55, lastTouch: from.id, lastKickTeam: from.team, lastKickAgo: 0, finish: null, pickupDelay: duration + .1, passTarget: to.id });
  b.perfectPass = { fromId: from.id, targetId: to.id, origin, left: duration, duration, curve, color, onReceive, aim: aim ? { ...aim } : null };
  g.recordKickCharge?.(from);
  return true;
};
const guaranteedFinish = (g, p, options = {}) => {
  if (g.guaranteedGoal) return g.guaranteedGoal(p, { power: 100, color: colorOf(p), ...options });
  // Standalone character harnesses may not implement the engine's scripted goal.
  towardGoal(g, p, 100, options);
  later(g, .5, () => { if (g.state.phase === 'play' || g.state.phase === 'playing') g.goal?.(p.team); });
  return true;
};

export function activateSkill(g, p, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 4) return false;
  if (g.state.phase !== 'playing' && g.state.phase !== 'play') return false;
  if ((p.stun || 0) > 0 || (p.recovery || 0) > 0) return notify(g, 'Recover before using a move.');
  const a = ability(p), id = idOf(p), awakened = currentAwakening(p);
  const skills = getSkills(p, awakened, g.hasBall(p));
  if (!skills[slot]) return false;
  const followup = (slot === 1 && ((!awakened && id === 'butterflydancer' && a.butterflyFollowup > 0) || (!awakened && id === 'emperor' && a.emperorFollowup > 0) || (id === 'streetdribbler' && a.rouletteFollowup > 0) || (id === 'supersonic' && !awakened && a.pinpointFollowup > 0) || (id === 'ninja' && a.precisionFollowup > 0) || (id === 'trapper' && !awakened && a.heelFollowup > 0))) || (id === 'magician' && !awakened && slot === 0 && a.placementFollowup > 0);
  if ((p.cooldowns[slot] || 0) > 0 && !followup) return notify(g, `${skills[slot].name} is cooling down.`);

  if (id === 'serpent') return serpentSkill(g, p, slot, awakened);
  if (id === 'butterflydancer') return butterflySkill(g, p, slot, awakened);
  if (id === 'emperor') return emperorSkill(g, p, slot, awakened);
  if (id === 'magician' && slot === 3) return chemicalReaction(g, p);

  if (id === 'ice') {
    if (slot === 0) {
      if (!onBall(g, p)) return false;
      const mate = cursorTeammate(g, p); if (!mate) return false;
      if (!ready(g, p, dist(g, p, mate) <= g.width / 3, 'TOO FAR!')) return false;
      perfectPass(g, p, mate, { instant: true, color: ICE }); cd(p, slot, 40); return true;
    }
    if (slot === 1) {
      if (!onBall(g, p)) return false;
      const enemy = enemyAhead(g, p);
      if (!ready(g, p, enemy && dist(g, p, enemy) < 135, 'Get an opponent directly in front of you for Point Blank Nutmeg.')) return false;
      cd(p, slot, 20); enemy.stun = Math.max(enemy.stun || 0, .5); effect(g, 'stun', enemy, ICE, .5);
      effect(g, 'touch', enemy, ICE); p.invincible = .85;
      const target = { x: clamp(enemy.x + direction(p) * 65, g.width * .065, g.width * .935), y: enemy.y };
      a.nutmeg = { origin: { x: p.x, y: p.y }, target, left: .52, duration: .52 };
      Object.assign(g.state.ball, { owner: null, x: p.x, y: p.y, vx: 0, vy: 0, vz: 0, z: 0, power: 0, finish: null, lastTouch: p.id, color: ICE, cannotScore: true, scriptedReturn: true, pickupDelay: .65 });
      const side = p.y < g.height / 2 ? 1 : -1;
      dash(g, p, direction(p), side * .8, 90, .2, { invincible: true, dribble: true });
      later(g, .21, () => { if (a.nutmeg) dash(g, p, target.x - p.x, target.y - p.y, dist(g, p, target), .28, { invincible: true, dribble: true }); }); return true;
    }
    if (slot === 2 && awakened) {
      if (!onBall(g, p)) return false;
      const mate = cursorTeammate(g, p); if (!mate) return false;
      cd(p, slot, 20);
      cinematic(g, 1.8, ['Just count the damn assist'], p, () => { if (currentAwakening(p) && g.hasBall(p)) perfectPass(g, p, mate, { curve: .85, color: ICE }); }); return true;
    }
  }

  if (id === 'manmarker') {
    if (slot === 0) {
      const d = facing(p); dash(g, p, d.x, d.y, g.width * .17, .42, { steal: true, stun: 1.5, counterStun: 1.5 }); cd(p, slot, 26); return true;
    }
    if (slot === 1) {
      const target = closestEnemy(g, p);
      if (!ready(g, p, target && dist(g, p, target) < 270, 'Get closer to an opponent to MANMARK.')) return false;
      a.markTarget = target.id; a.markLeft = 5; p.mark = 5; aura(p, YELLOW, 5); cd(p, slot, 30); return true;
    }
    if (slot === 2 && awakened) {
      const enemy = enemyCarrier(g, p);
      if (!offBall(g, p) || !ready(g, p, enemy && dist(g, p, enemy) < 300, 'Get close to the opponent with the ball.')) return false;
      if (!spend(g, p, 'blindspotUsed')) return false;
      cinematic(g, 1.4, ['Advantageous blindspot'], p, () => {
        if (!currentAwakening(p) || !enemyCarrier(g, p)) return;
        trace(g, p, enemy); place(g, p, enemy.x + direction(enemy) * 36, enemy.y);
        if (g.steal(p, enemy, .6)) kick(g, p, 50, { air: false });
      }); return true;
    }
  }

  if (id === 'powershooter') {
    if (slot === 0 && !awakened) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 32); recover(p, 1, true); aura(p, ORANGE, 1.8); effect(g, 'charge', p, ORANGE, 1);
      later(g, 1, () => { if (g.hasBall(p)) kick(g, p, 45, { air: true }); }); return true;
    }
    if (slot === 0 && awakened) {
      if (!ready(g, p, g.state.ball.owner == null, 'WILDCARD requires a loose ball.')) return false;
      cd(p, slot, 30); const target = frozenBall(g);
      cinematic(g, 1.3, ['WILDCARD'], p, () => { if (!currentAwakening(p)) return; trace(g, p, target); place(g, p, target.x, target.y); if (takeLoose(g, p)) kick(g, p, 55, { air: true }); }); return true;
    }
    if (slot === 1) {
      const d = facing(p); dash(g, p, d.x, d.y, g.width * .24, .5, { steal: true, stun: 1, counterStun: 1, knockback: 180 }); cd(p, slot, 24); return true;
    }
    if (slot === 2 && awakened) {
      if (!onBall(g, p) || !spend(g, p, 'trivelaUsed')) return false;
      cinematic(g, 3, ['Trivela screamer', 'This match is already over'], p, () => { if (currentAwakening(p) && g.hasBall(p)) kick(g, p, 80, { air: true, curve: .65, accuracy: .65 }); }); return true;
    }
  }

  if (id === 'ninja') {
    if (slot === 0) {
      if (!offBall(g, p)) return false;
      const duration = awakened ? 10 : 5;
      p.stealth = duration; a.stealthLeft = duration; a.ninjaSteal = true; aura(p, GREEN, duration); cd(p, slot, 27); effect(g, 'smoke', p, GREEN); return true;
    }
    if (slot === 1 && a.precisionFollowup > 0) {
      if (!onBall(g, p)) return false;
      a.precisionFollowup = 0; cd(p, slot, 20); trace(g, p, { x: p.x + direction(p) * g.width / 4, y: p.y });
      forwardDash(g, p, g.width / 4, .42, { invincible: true, dribble: true, color: GREEN }); return true;
    }
    if (slot === 1) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 15); a.precisionFollowup = 5; trace(g, p, { x: p.x + direction(p) * g.width * .2, y: p.y });
      forwardDash(g, p, g.width * .2, .36, { color: GREEN }); return true;
    }
    if (slot === 2 && awakened) {
      if (!onBall(g, p) || !spend(g, p, 'knuckleUsed')) return false;
      cinematic(g, 1.6, ['Oops, you guessed wrong'], p, () => { if (currentAwakening(p) && g.hasBall(p)) kick(g, p, 65, { air: true, knuckle: true, curve: .7, color: GREEN }); }, { kind: 'volley' }); return true;
    }
  }

  if (id === 'falcon') {
    if (slot === 0 && !awakened) {
      const b = g.state.ball;
      if (!ready(g, p, b.owner == null && b.z > 4 && !protectedBall(g) && !b.unstoppableAir && !(b.distribution?.age < .5), 'Skyward Volley needs an airborne loose ball.') || !ready(g, p, dist(g, p, b) <= g.width / 8, 'Move within one eighth of the field from the airborne ball.')) return false;
      cd(p, slot, 25); trace(g, p, b); place(g, p, b.x, b.y); p.leap = .6; g.setOwner(p); kick(g, p, 50, { air: true, color: GREY }); return true;
    }
    if (slot === 0 && awakened) {
      if (!onBall(g, p) || !spend(g, p, 'bicycleUsed')) return false;
      cinematic(g, 2.4, ['25 METER BICYCLE'], p, () => { if (currentAwakening(p) && g.hasBall(p)) { p.leap = .8; effect(g, 'charge', p, GREY, .8); kick(g, p, 80, { air: true }); } }, { kind: 'bicycle' }); return true;
    }
    if (slot === 1) {
      if (!offBall(g, p)) return false;
      const b = g.state.ball;
      if (!ready(g, p, dist(g, p, b) <= g.width / 3, 'Move within one third of the field from the ball.')) return false;
      cd(p, slot, 20); a.predatorLeft = 5; aura(p, GREY, 5); return true;
    }
    if (slot === 2 && !awakened) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 25); const target = { x: clamp(p.x + direction(p) * g.width / 3, g.width * .08, g.width * .92), y: p.y };
      const duration = .65; a.aerialDribble = { ...target, left: duration, duration, origin: { x: p.x, y: p.y } };
      kick(g, p, 45, { air: true, angle: p.team === 0 ? 0 : Math.PI });
      Object.assign(g.state.ball, { x: target.x, y: target.y, vx: 0, vy: 0, z: 28, vz: 0, cannotScore: true, scriptedReturn: true, pickupDelay: duration + .1 });
      dash(g, p, target.x - p.x, target.y - p.y, dist(g, p, target), duration, { color: GREY }); return true;
    }
    if (slot === 2 && awakened) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 20); const wall = { x: p.team === 0 ? g.width * .942 : g.width * .058, y: p.y < g.height / 2 ? g.height * .24 : g.height * .76 };
      const oldAim = p.aim; p.aim = wall; kick(g, p, 90, { air: false, color: GREY }); p.aim = oldAim;
      const b = g.state.ball; b.cannotScore = true; b.scriptedReturn = true;
      a.skyReturn = { left: 3, bounced: false, originX: p.x, lastVx: b.vx };
      aura(p, GREY, 3); return true;
    }
  }

  if (id === 'playmaker') {
    if (slot === 0) {
      a.observationLeft = 10; a.observationBoost = awakened ? .5 : .3; p.ragdollRecovery = awakened ? 1 : 1.5;
      if (awakened) p.ragdollImmune = 10;
      aura(p, CYAN, 10); cd(p, slot, 40); return true;
    }
    if (slot === 1 && !awakened) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 25); dash(g, p, 0, p.y < g.height * .35 ? 1 : -1, g.height * .25, .4, { invincible: true, dribble: true });
      later(g, .41, () => { if (g.hasBall(p)) forwardDash(g, p, g.width * .2, .4, { invincible: true, dribble: true }); }); return true;
    }
    if (slot === 1 && awakened) {
      if (!onBall(g, p)) return false;
      const enemy = closestEnemy(g, p);
      if (!ready(g, p, enemy && (enemy.x - p.x) * direction(p) > 0 && Math.abs(enemy.y - p.y) < 170 && dist(g, p, enemy) < 370, 'You need an opponent ahead of you.')) return false;
      cd(p, slot, 30); g.notify('Did you know?'); p.invincible = 1.7;
      forwardDash(g, p, g.width * .2, .48, { invincible: true, dribble: true });
      a.swerveTarget = enemy.id; a.swerveLeft = .5;
      later(g, .52, () => {
        if (!currentAwakening(p) || !g.hasBall(p)) return;
        p.motion = null; g.notify('Humans cannot suddenly move backwards'); enemy.stun = Math.max(enemy.stun || 0, 2);
        effect(g, 'stun', enemy, CYAN, 2); a.swerveLeft = 0;
        forwardDash(g, p, g.width * .2, .45, { invincible: true, dribble: true });
      }); return true;
    }
    if (slot === 2) {
      const mate = needsTeammate(g, p); if (!mate) return false;
      if (!awakened) {
        if (g.hasBall(p)) { aura(p, CYAN, 1.5); pass(g, p, mate, { air: true, curve: .55, power: 65 }); cd(p, slot, 45); return true; }
        if (!ready(g, p, g.hasBall(mate), 'Your teammate must have the ball.')) return false;
        if (!ready(g, p, dist(g, p, mate) <= g.width / 2, 'Move within half a field of your teammate.')) return false;
        aura(p, CYAN, 2); aura(mate, CYAN, 5); pass(g, mate, p, { power: 58 }); ability(mate).counterSpeedLeft = 5; cd(p, slot, 30); return true;
      }
      if (!g.hasBall(p)) {
        if (!ready(g, p, g.hasBall(mate), 'Your teammate must have the ball.') || !spend(g, p, 'mineUsed')) return false;
        aura(p, CYAN, 3); pass(g, mate, p, { power: 65 });
        // Begin the exposed windup only after the pass actually reaches this player.
        a.awaitMine = 8; return true;
      }
      if (!spend(g, p, 'driveUsed')) return false;
      const forward = direction(p), cornerY = p.y < g.height / 2 ? 80 : g.height - 80;
      aura(p, CYAN, 7); aura(mate, CYAN, 7);
      place(g, mate, mate.x + forward * 90, mate.y); pass(g, p, mate, { power: 55 });
      a.drive = { stage: 0, mateId: mate.id, left: 10, cornerY, forward }; return true;
    }
  }

  if (id === 'streetdribbler') {
    if (!onBall(g, p)) return false;
    if (slot === 0 && !awakened) {
      cd(p, slot, 20); const d = facing(p);
      dash(g, p, -d.x, -d.y, 65, .2, { invincible: true, dribble: true, color: PURPLE });
      later(g, .21, () => { if (g.hasBall(p)) dash(g, p, d.x, d.y, g.width * .25, .5, { invincible: true, dribble: true, color: ORANGE }); }); return true;
    }
    if (slot === 1 && a.rouletteFollowup > 0) {
      a.rouletteFollowup = 0; a.rouletteLeft = 0; p.motion = null; p.invincible = 0; p.dribble = 0; p.afterDribble = false; cd(p, slot, 34); recover(p, 1); effect(g, 'charge', p, PURPLE, 1);
      later(g, 1, () => { if (g.hasBall(p)) kick(g, p, 75, { air: true, curve: 1.05, accuracy: 1, color: PURPLE }); }); return true;
    }
    if (slot === 1) {
      cd(p, slot, 24); a.rouletteFollowup = 4.5; a.rouletteLeft = .55;
      const d = facing(p); dash(g, p, d.x, d.y, g.width * .2, .48, { invincible: true, dribble: true, color: PURPLE }); return true;
    }
    if (slot === 2 && !awakened) {
      cd(p, slot, 27); const d = facing(p); dash(g, p, d.x, d.y, g.width * .5, g.width * .5 / 330, { color: ORANGE }); return true;
    }
    if (slot === 0 && awakened) {
      if (!spend(g, p, 'destructionUsed')) return false;
      const origin = { x: p.x, y: p.y }, endX = clamp(p.x + direction(p) * g.width * .5, 70, g.width - 70);
      cinematic(g, 2.4, ['Destruição total do campo'], p, () => {
        if (!currentAwakening(p)) return;
        trace(g, p, { x: endX, y: p.y }, 12);
        for (const other of g.state.players) {
          if (other === p) continue;
          const onPath = other.x >= Math.min(origin.x, endX) - 30 && other.x <= Math.max(origin.x, endX) + 30 && Math.abs(other.y - origin.y) < 80;
          if (onPath) { other.stun = Math.max(other.stun || 0, 2); effect(g, 'stun', other, PURPLE, 2); }
        }
        place(g, p, endX, p.y);
        if (g.hasBall(p) && (p.team === 0 ? p.x > g.width * .8 : p.x < g.width * .2) && Math.abs(p.y - g.height / 2) < g.height * .26) {
          g.notify('Nutmeg!'); towardGoal(g, p, 100, { finishBoost: .18, air: false, color: ORANGE });
        }
      }); return true;
    }
    if (slot === 2 && awakened) {
      if (!spend(g, p, 'overtimeUsed')) return false;
      cinematic(g, 2, ['Curva de horas extras'], p, () => { if (currentAwakening(p) && g.hasBall(p)) kick(g, p, 90, { air: true, curve: 1.1, accuracy: .5, color: PURPLE }); }); return true;
    }
  }

  if (id === 'magician') {
    if (awakened) return magicianAwakened(g, p, slot);
    if (slot === 0 && a.placementFollowup > 0) {
      if (!onBall(g, p)) return false;
      const mate = nearestTeammate(g, p);
      if (!ready(g, p, !!mate, 'This move requires a teammate and is unavailable in 1v1.') || !ready(g, p, dist(g, p, mate) <= g.width / 2, 'Move within half a field of your teammate.')) return false;
      a.placementFollowup = 0; cd(p, slot, 30); perfectPass(g, p, mate, { color: PINK }); return true;
    }
    if (slot === 0) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 27); a.placementFollowup = 7; p.invincible = 1.5;
      dash(g, p, 0, -1, g.width / 4, .35, { invincible: true, dribble: true, color: PINK });
      later(g, .36, () => { if (g.hasBall(p)) forwardDash(g, p, g.width / 4, .4, { invincible: true, dribble: true, color: PINK }); });
      later(g, .77, () => { if (g.hasBall(p)) dash(g, p, direction(p), 1, g.width / 5, .4, { invincible: true, dribble: true, color: PINK }); }); return true;
    }
    if (slot === 1 || slot === 2) {
      if (!onBall(g, p)) return false;
      const mate = slot === 1 ? farthestTeammate(g, p) : nearestTeammate(g, p);
      if (!ready(g, p, !!mate, 'This move requires a teammate and is unavailable in 1v1.')) return false;
      cd(p, slot, slot === 1 ? 25 : 35);
      perfectPass(g, p, mate, { color: PINK, curve: .8, onReceive: slot === 2 ? 'assist' : null, aim: p.aim }); return true;
    }
  }

  if (id === 'trapper') {
    if (awakened) return trapperAwakened(g, p, slot);
    if (slot === 0 && g.hasBall(p)) {
      cd(p, slot, 25); p.leap = .7; aura(p, BLUE, .8); kick(g, p, 65, { air: true }); return true;
    }
    if (slot === 0) {
      a.trapLeft = 3; p.leap = 3; recover(p, 3); aura(p, BLUE, 3); return true;
    }
    if (slot === 1 && a.heelFollowup > 0) {
      if (!onBall(g, p)) return false;
      a.heelFollowup = 0; a.heelLeft = .95; p.invincible = Math.max(p.invincible || 0, .95); cd(p, slot, 20);
      dash(g, p, direction(p), .2, g.width / 4, .42, { invincible: true, dribble: true, color: BLUE });
      later(g, .43, () => { if (g.hasBall(p)) dash(g, p, direction(p), -.2, g.width / 4, .42, { invincible: true, dribble: true, color: BLUE }); }); return true;
    }
    if (slot === 1) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 15); a.heelFollowup = 5;
      for (const enemy of opponents(g, p)) if (dist(g, p, enemy) < 140) { enemy.stun = Math.max(enemy.stun || 0, 2); effect(g, 'stun', enemy, BLUE, 2); }
      forwardDash(g, p, -g.width / 5, .5, { invincible: true, dribble: true, color: BLUE }); return true;
    }
    if (slot === 2 && a.fakeVolleyStreak >= 3) {
      if (!onBall(g, p)) return false;
      a.fakeVolleyStreak = 0; cd(p, slot, 20); p.invincible = 1;
      g.notify('Juggling Destroyer Shot'); guaranteedFinish(g, p, { air: true }); return true;
    }
    if (slot === 2) {
      if (!onBall(g, p)) return false;
      p.counter = 2; recover(p, 2, true); a.fakeVolleyLeft = 2; aura(p, BLUE, 2);
      p.onCounter = enemy => {
        a.fakeVolleyLeft = 0; a.fakeVolleyStreak = (a.fakeVolleyStreak || 0) + 1;
        p.counter = 0; p.recovery = 0; p.invincible = 0; p.onCounter = null; cd(p, slot, 0);
        enemy.stun = Math.max(enemy.stun || 0, 2); aura(p, BLUE, 1.2); effect(g, 'counter', p, BLUE, 1);
        g.notify(a.fakeVolleyStreak >= 3 ? 'Juggling Destroyer Shot unlocked!' : `Fake Volley ${a.fakeVolleyStreak}/3`);
      }; return true;
    }
  }

  if (id === 'supersonic') {
    if (awakened) return supersonicAwakened(g, p, slot);
    if (slot === 0) {
      if (!onBall(g, p)) return false;
      cd(p, slot, 25); forwardDash(g, p, g.width / 3, .5);
      later(g, .51, () => { if (g.hasBall(p)) dash(g, p, 0, Math.sign(g.height / 2 - p.y) || 1, Math.abs(g.height / 2 - p.y), .25); }); return true;
    }
    if (slot === 1 && a.pinpointFollowup > 0) {
      const mate = needsTeammate(g, p); if (!mate || !onBall(g, p)) return false;
      a.pinpointFollowup = 0; cd(p, slot, 35); pass(g, p, mate, { power: 65 });
      forwardDash(g, p, g.width / 3, .42); a.pinpointReturn = { mateId: mate.id, left: 6 }; return true;
    }
    if (slot === 1) {
      if (!offBall(g, p)) return false;
      const enemy = enemyCarrier(g, p); if (!ready(g, p, !!enemy, 'An opponent must have the ball.')) return false;
      cd(p, slot, 28); recover(p, .5); effect(g, 'charge', p, RED, .5);
      later(g, .5, () => {
        if (!g.hasBall(enemy)) return;
        trace(g, p, enemy); place(g, p, enemy.x + direction(enemy) * 34, enemy.y);
        const wasDribbling = enemy.dribble > 0;
        const stolen = g.steal(p, enemy, 1);
        if (wasDribbling) p.stun = .5;
        if (stolen) { aura(p, RED, 2.5); a.pinpointFollowup = 5; }
      }); return true;
    }
    if (slot === 2 && !g.hasBall(p)) {
      if (!ready(g, p, g.state.ball.owner == null, 'LOOSE BALL requires an unclaimed ball.')) return false;
      const b = g.state.ball, d = dist(g, p, b); dash(g, p, b.x - p.x, b.y - p.y, d * .75, .38); cd(p, slot, 20); a.loosePowerWindow = 3; return true;
    }
    if (slot === 2) {
      p.counter = 3; recover(p, 3); a.velocityCounterLeft = 3; aura(p, RED, 3); cd(p, slot, 35);
      p.onCounter = enemy => {
        a.velocityCounterLeft = 0; p.counter = 0; p.recovery = 0; p.onCounter = null;
        enemy.stun = Math.max(enemy.stun || 0, 2); cd(p, slot, 10);
        forwardDash(g, p, g.width * .5, .65, { invincible: true, dribble: true });
        g.notify('VELOCITY-ABUSING COUNTER-DRIBBLE');
      }; return true;
    }
  }
  return false;
}

function magicianAwakened(g, p, slot) {
  const a = ability(p);
  if (slot === 0) {
    if (!onBall(g, p)) return false;
    const ownHalf = p.team === 0 ? p.x < g.width / 2 : p.x > g.width / 2;
    if (!ready(g, p, ownHalf, 'Use DISAPPEAR! in your own half.')) return false;
    cd(p, slot, 25);
    cinematic(g, 2.4, ['Advanced spell-binding…', 'DISAPPEAR!'], p, () => {
      if (!currentAwakening(p) || !g.hasBall(p)) return;
      const diagonal = { x: p.x + direction(p) * g.width / (3 * Math.SQRT2), y: p.y - g.width / (3 * Math.SQRT2) };
      trace(g, p, diagonal, 9); place(g, p, diagonal.x, diagonal.y);
      const corner = { x: p.team === 0 ? g.width * .86 : g.width * .14, y: g.height * .86 };
      dash(g, p, corner.x - p.x, corner.y - p.y, dist(g, p, corner), .75, { invincible: true, dribble: true, color: PINK });
    }, { kind: 'dash', destination: { x: clamp(p.x + direction(p) * g.width / (3 * Math.SQRT2), 45, g.width - 45), y: clamp(p.y - g.width / (3 * Math.SQRT2), 55, g.height - 55) } }); return true;
  }
  if (slot === 1) {
    const mate = nearestTeammate(g, p);
    if (!ready(g, p, !!mate, 'This move requires a teammate and is unavailable in 1v1.')) return false;
    if (!g.hasBall(p)) {
      if (!ready(g, p, g.state.ball.owner == null, 'COUNTERATTACK! requires a loose ball.')) return false;
      cd(p, slot, 20); const position = frozenBall(g);
      cinematic(g, 1.8, ['YOU CAN’T OUTPACE ME!'], p, () => {
        if (!currentAwakening(p) || g.state.ball.owner != null) return;
        trace(g, p, position, 10); place(g, p, position.x, position.y); g.setOwner(p); perfectPass(g, p, mate, { color: PINK });
      }); return true;
    }
    const held = Number.isFinite(p.possessionAge) ? p.possessionAge : Math.max(0, (g.state.elapsed || 0) - (p.possessionStartedAt ?? g.state.elapsed ?? 0));
    if (!ready(g, p, held >= 10, 'Keep possession for 10 seconds before Instant Pay-Off.')) return false;
    cd(p, slot, 50);
    cinematic(g, 3.2, ['Advanced Spell-Binding…', 'Instant Pay-Off'], p, () => {
      if (!currentAwakening(p) || !g.hasBall(p)) return;
      const box = { x: p.team === 0 ? g.width * .87 : g.width * .13, y: g.height / 2 };
      trace(g, p, box, 12); place(g, p, box.x, box.y);
      cinematic(g, 1, ['Instant Pay-Off'], p, () => { if (currentAwakening(p) && g.hasBall(p)) { p.leap = .6; guaranteedFinish(g, p, { air: true, color: PINK }); } }, { kind: 'header' });
    }, { kind: 'give-and-go', mateId: mate.id, targetId: closestEnemy(g, p)?.id }); return true;
  }
  if (slot === 2) {
    if (!onBall(g, p) || !spend(g, p, 'bestStrikerUsed')) return false;
    cinematic(g, 3.5, ['This is it! We can win with my pass', 'No… this can’t be the best way to progress myself. I will do this… AND I DON’T NEED YOUR HELP!'], p, () => { if (currentAwakening(p) && g.hasBall(p)) kick(g, p, 90, { air: true, color: PINK }); }); return true;
  }
  return false;
}

function trapperAwakened(g, p, slot) {
  if (slot === 0 && g.hasBall(p)) {
    const enemy = enemyAhead(g, p);
    if (!ready(g, p, !!enemy, 'DEATH TRAP needs an opponent in front of you.')) return false;
    cd(p, slot, 30);
    cinematic(g, 3, ['That’s a volley,', 'Into a fake', 'and instantly KILL IT on the return!'], p, () => {
      if (!currentAwakening(p) || !g.hasBall(p)) return;
      enemy.stun = Math.max(enemy.stun || 0, 2); effect(g, 'stun', enemy, BLUE, 2); p.leap = .7; kick(g, p, 80, { air: true, color: BLUE });
    }, { kind: 'volley', targetId: enemy.id }); return true;
  }
  if (slot === 0) {
    if (!ready(g, p, g.state.ball.owner == null, 'Two-Stage Fake Volley requires a loose ball.')) return false;
    cd(p, slot, 32); const target = frozenBall(g);
    cinematic(g, 2.5, ['Oh, yeah? I could totally get this, no problem'], p, () => {
      if (!currentAwakening(p) || g.state.ball.owner != null) return;
      trace(g, p, target, 10); place(g, p, target.x, target.y); g.setOwner(p); p.leap = .7; kick(g, p, 75, { air: true, color: BLUE });
    }, { kind: 'volley' }); return true;
  }
  if (slot === 1 && g.hasBall(p)) {
    cd(p, slot, 23);
    cinematic(g, 2.2, ['Adaptive Playstyle', 'Scorpion kick!'], p, () => { if (currentAwakening(p) && g.hasBall(p)) { p.leap = .7; kick(g, p, 75, { air: true, curve: .7, accuracy: 1, color: BLUE }); } }, { kind: 'scorpion' }); return true;
  }
  if (slot === 1) {
    if (!ready(g, p, recentOpponentShot(g, p), 'Use Mid-Air Trap immediately after an opponent shoots.')) return false;
    cd(p, slot, 25); const target = frozenBall(g);
    cinematic(g, 2, ['Nice pass, you freaking idiot'], p, () => {
      if (!currentAwakening(p) || g.state.ball.owner != null) return;
      trace(g, p, target, 12); place(g, p, target.x, target.y); g.setOwner(p); aura(p, BLUE, 2);
    }); return true;
  }
  if (slot === 2) {
    if (!ready(g, p, recentOpponentShot(g, p), 'Use this immediately after an opponent shoots.') || !spend(g, p, 'hexchamberUsed')) return false;
    const target = frozenBall(g), shooter = g.state.players.find(other => other.team !== p.team && other.id === g.state.ball.lastTouch) || closestEnemy(g, p);
    const isGuest = ['online', 'host', 'guest', 'online-host', 'online-guest'].includes(g.options?.mode) && shooter?.team === 1;
    const username = g.options?.mode === 'bot' && shooter?.team !== g.localTeam ? 'clanker' : isGuest || /^(guest|newbie)$/i.test(shooter?.name || '') ? 'newbie' : shooter?.name || 'newbie';
    cinematic(g, 6, [`Thanks, ${username}`, 'FEINT!', 'FEINT!', 'VOLLEY!', 'FIVE STAGE ULTIMATE HEXCHAMBER REVOLVER SHOT!'], p, finalView => {
      if (!currentAwakening(p) || g.state.ball.owner != null) return;
      const finish = finalView?.players?.find(other => other.id === p.id) || target;
      trace(g, p, finish, 12); place(g, p, finish.x, finish.y); g.setOwner(p);
      p.leap = .9; kick(g, p, 100, { air: true, accuracy: 1, color: BLUE });
    }, { kind: 'hexchamber', targetId: shooter?.id }); return true;
  }
  return false;
}

function supersonicAwakened(g, p, slot) {
  const a = ability(p);
  if (slot === 0) {
    if (!onBall(g, p)) return false;
    const inLane = p.team === 0 ? p.x >= g.width * .5 && p.x < g.width * .8 : p.x <= g.width * .5 && p.x > g.width * .2;
    if (!ready(g, p, inLane, 'Use this between halfway and the opponent’s penalty box.') || !spend(g, p, 'catchUsed')) return false;
    p.stealth = 3;
    cinematic(g, 3, ['CAN’T CATCH ME NOW'], p, () => {
      p.stealth = 0; if (!currentAwakening(p)) return; trace(g, p, { x: p.team === 0 ? g.width * .88 : g.width * .12, y: g.height / 2 }, 14);
      place(g, p, p.team === 0 ? g.width * .88 : g.width * .12, g.height / 2);
      if (g.hasBall(p)) towardGoal(g, p, 100, { air: true, finishBoost: .18 });
    }); return true;
  }
  if (slot === 1) {
    if (!offBall(g, p) || !spend(g, p, 'tooSlowUsed')) return false;
    cinematic(g, 1.6, ['Too slow, too slow'], p, () => {
      if (!currentAwakening(p)) return;
      const b = g.state.ball, enemy = enemyCarrier(g, p); trace(g, p, b); place(g, p, b.x, b.y);
      if (enemy) { enemy.dribble = 0; enemy.invincible = 0; g.steal(p, enemy, 1); } else if (b.owner == null) g.setOwner(p);
      if (!g.hasBall(p)) return;
      const mate = teammate(g, p);
      if (mate) pass(g, p, mate, { power: 65 }); else forwardDash(g, p, g.width / 3, .5);
    }); return true;
  }
  if (slot === 2) {
    const b = g.state.ball;
    if (!ready(g, p, recentOpponentShot(g, p), 'Use this immediately after an opponent kicks the ball.') || !spend(g, p, 'everythingUsed')) return false;
    const position = frozenBall(g); b.vx = 0; b.vy = 0; b.vz = 0;
    cinematic(g, 1.8, ['Your kick… was just too slow!'], p, () => {
      if (!currentAwakening(p)) return;
      trace(g, p, position, 14); place(g, p, position.x, position.y);
      if (g.state.ball.owner == null) { g.setOwner(p); kick(g, p, 95, { air: false }); }
    }); return true;
  }
  if (slot === 3 && a.onBallAwakening) {
    if (!spend(g, p, 'recordUsed')) return false;
    cinematic(g, 2.4, ['I SEE IT NOW! THE WAY TO REACH NEW HEIGHTS! OUT OF MY WAY!'], p, () => { if (!currentAwakening(p)) return; a.recordSpeedLeft = 35; p.worldRecordSpeed = true; aura(p, '#ff174c', 35); }); return true;
  }
  return false;
}

export function activateAwakening(g, p) {
  const definition = byId[idOf(p)];
  if (!definition?.awakening) return notify(g, 'Spin for a character to unlock an awakening.');
  if (g.state.phase !== 'playing' && g.state.phase !== 'play') return false;
  if (p.awakened) return notify(g, 'Your awakening is already active.');
  if ((p.awakeningCharge || 0) < 100) return notify(g, 'Awakening is still charging.');
  if ((p.stun || 0) > 0 || (p.recovery || 0) > 0) return notify(g, 'Recover before awakening.');
  const hasBall = g.hasBall(p), requirement = definition.awakening.requires;
  if (requirement === 'on-ball' && !onBall(g, p)) return false;
  if (requirement === 'off-ball' && !offBall(g, p)) return false;
  const a = ability(p);
  // The engine owns the global 100-second readiness race. Consuming the winning
  // awakening resets only its owner; new readiness can interrupt it later.
  for (const key of ['serpentStrikerUsed', 'butterflyGoalUsed', 'emperorBicycleUsed', 'emperorMoveUsed', 'magnusUsed', 'blindspotUsed', 'trivelaUsed', 'mineUsed', 'driveUsed', 'destructionUsed', 'overtimeUsed', 'catchUsed', 'tooSlowUsed', 'everythingUsed', 'recordUsed', 'knuckleUsed', 'bicycleUsed', 'bestStrikerUsed', 'hexchamberUsed']) a[key] = false;
  a.onBallAwakening = hasBall; a.rouletteFollowup = 0; a.pinpointFollowup = 0; a.placementFollowup = 0; a.heelFollowup = 0; a.precisionFollowup = 0; a.fakeVolleyStreak = 0; a.fakeVolleyLeft = 0; a.awakeningActive = true;
  p.counter = 0; p.onCounter = null;
  p.awakeningCharge = 0; p.awakened = true; p.awakeningLeft = definition.awakening.duration;
  p.cooldowns = [0, 0, 0, 0, 0];
  a.butterflyFollowup = 0; a.emperorFollowup = 0; a.infiniteDribble = 0;
  if (definition.id === 'emperor') {
    a.reactionCooldown = 0;
    const partner = teammates(g, p).find(mate => idOf(mate) === 'magician');
    if (partner) { ability(partner).reactionCooldown = 0; cd(partner, 3, 0); }
  }
  const quotes = definition.id === 'supersonic' ? [definition.awakening.quotes[hasBall ? 1 : 0]] : definition.awakening.quotes;
  cinematic(g, quotes.length > 1 ? 3.4 : 2.8, quotes, p, () => {
    if (!p.awakened) return;
    aura(p, definition.color, p.awakeningLeft);
    if (definition.id === 'butterflydancer') wingAura(p, p.awakeningLeft);
    if (definition.id === 'emperor') roses(g, p, 12);
    effect(g, 'awakening', p, definition.color, 1.4);
    if (definition.id === 'supersonic' && !hasBall) {
      const b = g.state.ball, enemy = enemyCarrier(g, p); trace(g, p, b, 14); place(g, p, b.x, b.y);
      if (enemy) { enemy.stun = Math.max(enemy.stun || 0, 3); g.setOwner(p); } else if (b.owner == null) g.setOwner(p);
    }
  }); return true;
}

export function tickAbilities(g, p, dt) {
  const a = ability(p), id = idOf(p), motionDt = g.motionSeconds?.(dt) ?? dt;
  if (a.awakeningActive && !p.awakened) {
    if (id === 'butterflydancer') a.wingsLeft = 0;
    a.awakeningActive = false; a.recordSpeedLeft = 0; a.awaitMine = 0; a.drive = null; a.payoff = null;
    if (a.observationBoost === .5) { a.observationLeft = 0; p.ragdollImmune = 0; }
  }
  // Shared cooldowns, stun, invincibility, stealth, charge, and awakening time
  // are advanced by the match engine. Only custom ability timers live here.
  const hadTrap = a.trapLeft > 0, hadFake = a.fakeVolleyLeft > 0;
  const timed = ['auraLeft', 'stealthLeft', 'observationLeft', 'counterSpeedLeft', 'recordSpeedLeft', 'markLeft', 'swerveLeft', 'rouletteLeft', 'rouletteFollowup', 'pinpointFollowup', 'loosePowerWindow', 'velocityCounterLeft', 'precisionFollowup', 'placementFollowup', 'heelFollowup', 'heelLeft', 'predatorLeft', 'trapLeft', 'fakeVolleyLeft'];
  for (const key of timed) if (a[key] > 0) a[key] = Math.max(0, a[key] - dt);
  if (a.auraLeft <= 0 && !p.awakened) p.aura = null;
  if (g.hasBall(p) && !a.hadPossession) a.receiptAt = g.state.elapsed || 0;
  if (Number.isFinite(p.receivedAt)) a.receiptAt = p.receivedAt;
  a.hadPossession = g.hasBall(p);
  const freshTouch = id === 'trapper' && Number.isFinite(a.receiptAt) && (g.state.elapsed || 0) - a.receiptAt < 2.5;
  const firstTouchSpeed = freshTouch ? currentAwakening(p) ? 2 : 1 : 0;
  p.receiptPowerBonus = (freshTouch ? currentAwakening(p) ? 40 : 20 : 0) + teammates(g, p).filter(other => idOf(other) === 'magician').length * 5;
  p.abilitySpeedBoost = Math.max(a.observationLeft > 0 ? a.observationBoost : 0, a.counterSpeedLeft > 0 ? 1 : 0, p.stealth > 0 && id === 'ninja' ? .25 : 0, a.recordSpeedLeft > 0 ? 1.5 : 0, firstTouchSpeed);
  // WORLD RECORD SPEED totals base + 50% passive + 150% additional = 300%.
  p.worldRecordSpeed = a.recordSpeedLeft > 0;
  if (!a.observationLeft) { p.ragdollRecovery = 1; if (p.ragdollImmune > 0) p.ragdollImmune = 0; }

  if (id === 'supersonic' && a.velocityCounterLeft <= 0 && p.onCounter) { p.counter = 0; p.onCounter = null; }
  if (id === 'trapper' && hadFake && a.fakeVolleyLeft <= 0) {
    a.fakeVolleyStreak = 0; p.counter = 0; p.onCounter = null; cd(p, 2, 15);
  }
  if (id === 'trapper' && hadTrap && a.trapLeft <= 0) { p.leap = 0; p.recovery = 0; cd(p, 0, 20); }
  if (a.loosePowerWindow > 0 && g.hasBall(p)) { p.shotPowerBonus = 20; a.shotPowerLeft = 5; a.loosePowerWindow = 0; g.notify('+20 SHOT POWER'); }
  if (a.shotPowerLeft > 0) { a.shotPowerLeft = Math.max(0, a.shotPowerLeft - dt); if (!a.shotPowerLeft) p.shotPowerBonus = 0; }

  if (id === 'ninja' && p.stealth > 0) {
    const enemy = enemyCarrier(g, p), b = g.state.ball;
    if (g.hasBall(p)) { p.stealth = 0; a.ninjaSteal = false; }
    else if (a.ninjaSteal && enemy && dist(g, p, enemy) < 40) {
      const dribbled = enemy.dribble > 0; g.steal(p, enemy, 1);
      p.stealth = 0; a.ninjaSteal = false;
      if (dribbled) p.stun = Math.max(p.stun || 0, 2);
    } else if (b.owner == null && (b.z || 0) < 8 && dist(g, p, b) < 38) { g.setOwner(p); p.stealth = 0; a.ninjaSteal = false; }
  }

  const traveling = g.state.ball.perfectPass;
  if (traveling && traveling.fromId === p.id) {
    const target = g.state.players.find(other => other.id === traveling.targetId);
    traveling.left = Math.max(0, traveling.left - motionDt);
    if (!target) g.state.ball.perfectPass = null;
    else if (traveling.left <= 0) {
      g.setOwner(target); effect(g, 'touch', target, traveling.color);
      if (traveling.onReceive === 'assist') {
        const previous = target.aim; target.aim = traveling.aim || p.aim;
        kick(g, target, 50, { color: PINK, accuracy: 1 }); target.aim = previous;
      }
    } else {
      const progress = 1 - traveling.left / traveling.duration, origin = traveling.origin;
      const dx = target.x - origin.x, dy = target.y - origin.y, length = Math.hypot(dx, dy) || 1, bend = Math.sin(progress * Math.PI) * Math.min(150, length * .18) * traveling.curve;
      Object.assign(g.state.ball, { x: origin.x + dx * progress - dy / length * bend, y: origin.y + dy * progress + dx / length * bend, z: 12 + Math.sin(progress * Math.PI) * 30 });
    }
  }

  if (id === 'ice' && a.nutmeg) {
    const data = a.nutmeg; data.left = Math.max(0, data.left - motionDt);
    if (g.state.ball.owner != null) a.nutmeg = null;
    else if (data.left <= 0) { place(g, p, data.target.x, data.target.y); p.motion = null; g.setOwner(p); a.nutmeg = null; }
    else {
      const progress = 1 - data.left / data.duration;
      Object.assign(g.state.ball, { x: data.origin.x + (data.target.x - data.origin.x) * progress, y: data.origin.y + (data.target.y - data.origin.y) * progress, vx: 0, vy: 0, z: 0, vz: 0 });
    }
  }

  if (id === 'falcon') {
    const b = g.state.ball;
    if (a.predatorLeft > 0) {
      if (g.hasBall(p) || p.stun > 0) { a.predatorLeft = 0; if (p.motion?.ability === 'predator') p.motion = null; }
      else {
        const distance = dist(g, p, b), n = distance || 1;
        p.motion = { dx: (b.x - p.x) / n, dy: (b.y - p.y) / n, speed: 194 * 1.5, left: dt + .001, ability: 'predator' };
        if (distance < 35 && b.owner == null && !protectedBall(g) && b.z < 45) g.setOwner(p);
      }
    }
    if (a.aerialDribble) {
      a.aerialDribble.left -= motionDt;
      if (b.owner != null) a.aerialDribble = null;
      else if (a.aerialDribble.left <= 0) { place(g, p, a.aerialDribble.x, a.aerialDribble.y); p.motion = null; g.setOwner(p); a.aerialDribble = null; }
      else { b.z = 25 + Math.sin((1 - a.aerialDribble.left / a.aerialDribble.duration) * Math.PI) * 45; b.vz = 0; }
    }
    if (a.skyReturn) {
      const data = a.skyReturn; data.left -= motionDt;
      if (b.owner != null || data.left <= 0) { b.scriptedReturn = false; a.skyReturn = null; }
      else {
        if (Math.sign(b.vx) !== Math.sign(data.lastVx)) data.bounced = true;
        data.lastVx = b.vx;
        const distance = dist(g, p, b);
        if (data.bounced) {
          if (distance < 100 || Math.abs(p.x - data.originX) >= g.width * .5) { place(g, p, b.x, b.y); g.setOwner(p); a.skyReturn = null; }
          else { const n = distance || 1; p.motion = { dx: (b.x - p.x) / n, dy: (b.y - p.y) / n, speed: 1100, left: dt + .001, ability: 'skyReturn' }; }
        } else if (!p.motion) forwardDash(g, p, g.width * .35, .8, { color: GREY });
      }
    }
  }
  if (id === 'trapper') {
    if (a.trapLeft > 0 && g.state.ball.owner == null && !protectedBall(g) && dist(g, p, g.state.ball) < 100) {
      g.setOwner(p); a.trapLeft = 0; p.leap = 0; p.recovery = 0; cd(p, 0, 20); effect(g, 'block', p, BLUE); g.notify('TRAPPED!');
    }
    if (a.heelLeft > 0) for (const enemy of opponents(g, p)) if (dist(g, p, enemy) < 95) { enemy.stun = Math.max(enemy.stun || 0, 1); effect(g, 'stun', enemy, BLUE, .4); }
  }
  if (a.payoff) {
    const data = a.payoff, mate = g.state.players.find(other => other.id === data.mateId); data.left -= dt;
    if (!currentAwakening(p) || !mate || data.left <= 0) a.payoff = null;
    else if (data.stage === 'out' && g.hasBall(mate)) { perfectPass(g, mate, p, { color: PINK }); data.stage = 'return'; }
    else if (data.stage === 'return' && g.hasBall(p)) {
      a.payoff = null;
      cinematic(g, 1, ['Instant Pay-Off'], p, () => { if (currentAwakening(p) && g.hasBall(p)) { p.leap = .6; guaranteedFinish(g, p, { air: true, color: PINK }); } });
    }
  }

  if (a.markLeft > 0) {
    const target = g.state.players.find(player => player.id === a.markTarget);
    if (target && !(p.stun > 0)) {
      const x = target.x + direction(target) * 45, y = target.y;
      const amount = Math.min(1, motionDt * 18); place(g, p, p.x + (x - p.x) * amount, p.y + (y - p.y) * amount);
      p.angle = Math.atan2(target.y - p.y, target.x - p.x);
      const b = g.state.ball;
      if (b.owner == null && !protectedBall(g) && b.lastKickTeam === target.team && dist(g, p, b) < 80 && (b.z || 0) < 30) {
        if ((b.power || 0) > 10 && b.lastKickAgo < .7) {
          b.vx *= -.5; b.vy *= -.5; b.power *= .5; b.lastTouch = p.id; b.lastKickTeam = p.team; b.lastKickAgo = 0; g.recordDeflection?.(p);
          effect(g, 'block', p, YELLOW); g.notify('MANMARK — blocked at half power');
        } else if (dist(g, p, b) < 48) g.setOwner(p);
      }
    }
  }
  if (a.swerveLeft > 0) {
    const target = g.state.players.find(player => player.id === a.swerveTarget);
    if (target) place(g, target, p.x + direction(p) * 45, p.y);
  }
  if (a.rouletteLeft > 0) for (const enemy of opponents(g, p)) if (dist(g, p, enemy) < 85) enemy.stun = Math.max(enemy.stun || 0, .5);

  if (a.awaitMine > 0) {
    a.awaitMine -= dt;
    if (g.hasBall(p)) {
      a.awaitMine = 0; recover(p, 2); effect(g, 'charge', p, CYAN, 2);
      later(g, 2, () => { if (currentAwakening(p) && g.hasBall(p)) kick(g, p, 20, { curve: 1.3, knuckle: true, savePower: 50 }); });
    }
  }
  if (a.pinpointReturn) {
    const data = a.pinpointReturn, mate = g.state.players.find(player => player.id === data.mateId); data.left -= dt;
    if (mate && g.hasBall(mate) && !p.motion) { pass(g, mate, p, { power: 65 }); a.pinpointReturn = null; }
    else if (data.left <= 0) a.pinpointReturn = null;
  }
  if (a.drive) {
    const drive = a.drive, mate = g.state.players.find(player => player.id === drive.mateId); drive.left -= dt;
    if (!mate || drive.left <= 0) a.drive = null;
    else if (drive.stage === 0 && g.hasBall(mate)) {
      const x = p.team === 0 ? g.width * .88 : g.width * .12;
      dash(g, p, x - p.x, drive.cornerY - p.y, Math.hypot(x - p.x, drive.cornerY - p.y), 1.1);
      drive.stage = 1;
    } else if (drive.stage === 1 && !p.motion && g.hasBall(mate)) { pass(g, mate, p, { power: 65 }); drive.stage = 2; }
    else if (drive.stage === 2 && g.hasBall(p)) {
      const x = p.team === 0 ? g.width * .85 : g.width * .15;
      dash(g, mate, x - mate.x, g.height / 2 - mate.y, Math.hypot(x - mate.x, g.height / 2 - mate.y), .6);
      drive.stage = 3;
    } else if (drive.stage === 3 && !mate.motion && g.hasBall(p)) { pass(g, p, mate, { air: true, curve: .8, power: 60 }); a.drive = null; g.notify('Rabona!'); }
  }
  tickArrivalAbilities(g, p, dt);
}

// Arrival moves use the same authoritative pass, dash and shot paths as ordinary
// play. Cinematic callbacks recheck possession so an exposed windup can be beaten.
const ownHalf = (g, p) => p.team === 0 ? p.x < g.width / 2 : p.x > g.width / 2;
const canTouchLoose = (g, p, range = g.width / 6) => g.state.ball.owner == null && !protectedBall(g) && dist(g, p, g.state.ball) <= range;
const wingAura = (p, duration) => { ability(p).wingsLeft = Math.max(ability(p).wingsLeft || 0, duration); p.butterflyWings = true; aura(p, YELLOW, duration); };
const roses = (g, p, count = 8) => {
  for (let i = 0; i < count; i++) g.effect?.('rose', p.x + Math.cos(i * 2.4) * (15 + i * 4), p.y + Math.sin(i * 2.4) * (15 + i * 4), BLUE, 1.3);
};
const clearWindup = p => { const a = ability(p); a.butterflyPath = null; a.emperorRoute = null; p.motion = null; p.dribble = 0; p.invincible = 0; p.counter = 0; p.onCounter = null; };
const physicalPass = (g, from, to, options = {}) => {
  if (g.pass) return g.pass(from, to, options);
  const result = pass(g, from, to, options);
  if (result) g.state.ball.pass = { fromId: from.id, targetId: to.id, team: from.team };
  return result;
};
const chip = (g, p, permanent) => {
  towardGoal(g, p, 10, { air: true, accuracy: 1, color: YELLOW, unstoppableAir: true, noFrictionFor: permanent ? 3600 : 5, topspin: 1.8, savePower: 98, finishBoost: .45, airtime: 4.5 });
  Object.assign(g.state.ball, { unstoppableAir: true, noFrictionFor: permanent ? 3600 : 5, topspin: 1.8 });
};
const heldSeconds = (g, p) => Number.isFinite(p.possessionAge) ? p.possessionAge : Math.max(0, (g.state.elapsed || 0) - (p.possessionStartedAt ?? g.state.elapsed ?? 0));
const reactionSlot = p => idOf(p) === 'emperor' && currentAwakening(p) ? 4 : 3;
const chemicalPair = (g, p) => {
  const otherId = idOf(p) === 'emperor' ? 'magician' : 'emperor';
  const other = teammates(g, p).find(mate => idOf(mate) === otherId);
  if (!other) return null;
  return idOf(p) === 'emperor' ? { emperor: p, magician: other } : { emperor: other, magician: p };
};
const reactionCooldown = (emperor, magician, seconds) => {
  for (const player of [emperor, magician]) {
    ability(player).reactionReady = 0; ability(player).reactionPending = false;
    ability(player).reactionCooldown = seconds;
    cd(player, reactionSlot(player), seconds);
  }
};
function chemicalReaction(g, p) {
  const pair = chemicalPair(g, p);
  if (!ready(g, p, !!pair, 'Emperor’s lackey requires an Emperor and Magician on the same team.')) return false;
  const { emperor, magician } = pair, ea = ability(emperor), ma = ability(magician);
  if (!ready(g, p, g.hasBall(magician), 'Magician must hold the ball for this chemical reaction.')) return false;
  if (!ready(g, p, !(ea.reactionCooldown > 0 || ma.reactionCooldown > 0 || ea.reactionPending || ea.reactionFlight), 'Emperor’s lackey is cooling down.')) return false;
  ability(p).reactionReady = 8;
  ability(p).reactionPromptLeft = 8;
  ability(p).reactionPrompt = 'Chemical reaction requested — waiting for your teammate.';
  const partner = p === emperor ? magician : emperor;
  if (!(ability(partner).reactionReady > 0)) {
    ability(partner).reactionPromptLeft = 8;
    ability(partner).reactionPrompt = `Press ${reactionSlot(partner) + 1} to accept Emperor’s lackey.`;
    g.notify?.(`${p.name || byId[idOf(p)].name} requests Emperor’s lackey. ${byId[idOf(partner)].name}: press ${reactionSlot(partner) + 1} to accept.`);
    return true;
  }
  ea.reactionReady = 0; ma.reactionReady = 0; ea.reactionPrompt = ''; ma.reactionPrompt = ''; ea.reactionPending = true;
  // Both have consented. The pass remains physical and interceptable; no goal is
  // scheduled until the intended receiver actually controls the ball.
  recover(magician, .55); aura(magician, PINK, 1.5);
  const halfway = { x: g.width / 2, y: emperor.y };
  dash(g, emperor, halfway.x - emperor.x, 0, Math.abs(halfway.x - emperor.x), .5, { color: BLUE });
  later(g, .56, () => {
    if (!g.hasBall(magician)) { reactionCooldown(emperor, magician, 45); return; }
    ea.reactionPending = false; emperor.motion = null; place(g, emperor, g.width / 2, emperor.y);
    physicalPass(g, magician, emperor, { air: true, power: 55, color: PINK });
    g.state.ball.reaction = { emperorId: emperor.id, magicianId: magician.id };
    ea.reactionFlight = { magicianId: magician.id, left: 7 };
  });
  return true;
}

function serpentSkill(g, p, slot, awakened) {
  const a = ability(p), b = g.state.ball;
  if (slot === 0 && !awakened) {
    if (!offBall(g, p) || !ready(g, p, canTouchLoose(g, p), 'Get near a loose ball for Serpentine Header.')) return false;
    const power = b.z > 1 || b.hadAirtime || b.lastAirtimeAt != null ? 50 : 30;
    cd(p, slot, 20); trace(g, p, b); place(g, p, b.x, b.y); g.setOwner(p); p.leap = .6; aura(p, GREEN, 1); kick(g, p, power, { air: true, color: GREEN }); return true;
  }
  if (slot === 0 && awakened) {
    if (!ready(g, p, b.owner == null && !protectedBall(g), 'Ultimate Clearance requires a loose ball or an opposing shot.')) return false;
    cd(p, slot, 22); const target = frozenBall(g);
    cinematic(g, 2.2, ['You won’t be stealing any goals while I’m on patrol'], p, () => {
      if (!currentAwakening(p) || b.owner != null || protectedBall(g)) return;
      trace(g, p, target); place(g, p, target.x, target.y); g.setOwner(p); kick(g, p, 65, { color: GREEN });
    }); return true;
  }
  if (slot === 1 && !awakened) {
    const enemy = enemyCarrier(g, p);
    if (!offBall(g, p) || !ready(g, p, enemy && (enemy.x - p.x) * direction(p) > 0 && Math.abs(enemy.y - p.y) < g.height / 3, 'Charge Press needs the opposing carrier ahead of you.')) return false;
    cd(p, slot, 25); clearWindup(p); recover(p, 2); aura(p, GREEN, 2.6); effect(g, 'charge', p, GREEN, 2);
    later(g, 2, () => {
      if (carrier(g)?.id !== enemy.id || p.stun > 0) { p.stun = Math.max(p.stun || 0, 1); return; }
      trace(g, p, enemy); place(g, p, enemy.x - direction(p) * 25, enemy.y);
      enemy.dribble = 0; enemy.invincible = 0; enemy.counter = 0; enemy.onCounter = null;
      g.setOwner(p); enemy.stun = Math.max(enemy.stun || 0, .75); effect(g, 'stun', enemy, GREEN, .75);
    }); return true;
  }
  if (slot === 1 && awakened) {
    const distribution = b.distribution;
    if (!ready(g, p, b.owner == null && !protectedBall(g) && distribution?.team === p.team && distribution.landedAge != null && distribution.landedAge < 1.6, 'Use this just after your goalkeeper’s throw hits the floor.') || !spend(g, p, 'serpentStrikerUsed')) return false;
    const target = frozenBall(g);
    cinematic(g, 2.6, ['It’s over! I used to be a striker, you know!'], p, () => {
      if (!currentAwakening(p) || b.owner != null || protectedBall(g)) return;
      trace(g, p, target); place(g, p, target.x, target.y); g.setOwner(p); kick(g, p, 70, { color: GREEN });
    }); return true;
  }
  if (slot === 2) {
    const mate = nearestTeammate(g, p);
    if (!ready(g, p, !!mate, 'Take The Bait is only available in team modes.')) return false;
    const target = opponents(g, p).sort((x, y) => dist(g, p, y) - dist(g, p, x))[0];
    if (!ready(g, p, !!target, 'An opponent is needed to mark.')) return false;
    cd(p, slot, 25); a.baitTarget = target.id; a.baitLeft = 25; aura(p, GREEN, 3); return true;
  }
  return false;
}

function butterflySkill(g, p, slot, awakened) {
  const a = ability(p), b = g.state.ball, forward = direction(p);
  if (!awakened && slot === 0) {
    if (!onBall(g, p)) return false;
    cd(p, slot, 19); wingAura(p, 1.5); const path = {}; a.butterflyPath = path;
    forwardDash(g, p, g.width / 2, .45, { color: YELLOW, dribble: true });
    later(g, .46, () => { if (a.butterflyPath === path && g.hasBall(p)) forwardDash(g, p, -g.width / 3, .38, { color: YELLOW, dribble: true }); });
    later(g, .85, () => { if (a.butterflyPath === path && g.hasBall(p)) dash(g, p, forward, 1, g.width / 4, .4, { color: YELLOW, dribble: true }); }); return true;
  }
  if (!awakened && slot === 1 && a.butterflyFollowup > 0) {
    if (!onBall(g, p)) return false;
    a.butterflyFollowup = 0; const path = {}; a.butterflyPath = path; cd(p, slot, 30); wingAura(p, 1); a.butterflyStunLeft = .95;
    dash(g, p, forward, -.22, g.width / 4, .45, { color: YELLOW, dribble: true });
    later(g, .46, () => { if (a.butterflyPath === path && g.hasBall(p)) dash(g, p, 0, g.height / 2 - p.y, Math.abs(g.height / 2 - p.y), .4, { color: YELLOW, dribble: true }); }); return true;
  }
  if (!awakened && slot === 1 && !g.hasBall(p)) {
    if (!ready(g, p, b.owner == null && !protectedBall(g), 'El primer toque needs a loose or airborne ball.')) return false;
    cd(p, slot, 25); wingAura(p, 1.1); trace(g, p, b, 12); place(g, p, b.x, b.y); g.setOwner(p); p.leap = .3;
    forwardDash(g, p, g.width / 3, .4, { color: YELLOW, dribble: true }); effect(g, 'touch', p, YELLOW); return true;
  }
  if (!awakened && slot === 1) {
    if (!onBall(g, p)) return false;
    cd(p, slot, 25); a.butterflyFollowup = 5; a.butterflyStunLeft = .95; wingAura(p, 1);
    const path = {}; a.butterflyPath = path;
    dash(g, p, forward, -1, g.width / 6, .28, { color: YELLOW, dribble: true });
    later(g, .29, () => { if (a.butterflyPath === path && g.hasBall(p)) dash(g, p, forward, 1, g.width / 6, .28, { color: YELLOW, dribble: true }); });
    later(g, .58, () => { if (a.butterflyPath === path && g.hasBall(p)) dash(g, p, forward, -1, g.width / 6, .28, { color: YELLOW, dribble: true }); }); return true;
  }
  if (!awakened && slot === 2) {
    if (!onBall(g, p)) return false;
    cd(p, slot, 23); clearWindup(p); recover(p, 1.5); wingAura(p, 2); effect(g, 'charge', p, YELLOW, 1.5);
    later(g, 1.5, () => { if (g.hasBall(p) && !(p.stun > 0)) chip(g, p, false); }); return true;
  }
  if (awakened && slot === 0 && !g.hasBall(p)) {
    const enemy = enemyCarrier(g, p);
    if (!ready(g, p, !!enemy, 'Mío needs an opponent holding the ball.')) return false;
    cd(p, slot, 26);
    cinematic(g, 2, ['Muy lente, muy lente!'], p, () => {
      if (!currentAwakening(p) || carrier(g)?.id !== enemy.id) return;
      trace(g, p, enemy); place(g, p, enemy.x - forward * 25, enemy.y); g.setOwner(p); enemy.stun = Math.max(enemy.stun || 0, 3.5); wingAura(p, 2);
    }); return true;
  }
  if (awakened && slot === 0) {
    if (!onBall(g, p) || !ready(g, p, ownHalf(g, p) && heldSeconds(g, p) >= 5 && (a.ownHalfHeld || 0) >= 5, 'Hold possession in your own half for 5s before this move.') || !spend(g, p, 'butterflyGoalUsed')) return false;
    cd(p, slot, 26);
    cinematic(g, 4.2, ['Destrucción del campo: versión perfeccionada', 'Wow, you all really suck'], p, () => {
      if (!currentAwakening(p) || !g.hasBall(p)) return;
      const box = { x: p.team === 0 ? g.width * .87 : g.width * .13, y: g.height / 2 };
      trace(g, p, box, 14); place(g, p, box.x, box.y); wingAura(p, 2); guaranteedFinish(g, p, { power: 100, color: YELLOW });
    }, { kind: 'butterfly-finish', destination: { x: p.team === 0 ? g.width * .87 : g.width * .13, y: g.height / 2 }, keeperId: g.state.keepers?.[1 - p.team]?.id }); return true;
  }
  if (awakened && slot === 1) {
    if (!onBall(g, p)) return false;
    cd(p, slot, 27);
    cinematic(g, 1.8, ['Watch my chip!'], p, () => { if (currentAwakening(p) && g.hasBall(p)) chip(g, p, true); }); return true;
  }
  if (awakened && slot === 2) {
    if (!onBall(g, p)) return false;
    if (!ready(g, p, !(a.infiniteDribble > 0), 'Your dance is already active.')) return false;
    // Timer-controlled cooldown: 15 seconds of dancing, followed by 10 seconds.
    cd(p, slot, 25);
    cinematic(g, 1.6, ['Now, let’s dance!'], p, () => { if (currentAwakening(p) && g.hasBall(p)) { a.infiniteDribble = 15; cd(p, 2, 25); p.dribbleCd = 0; p.dribbleCooldown = 0; wingAura(p, 15); } }); return true;
  }
  return false;
}

function emperorSkill(g, p, slot, awakened) {
  const a = ability(p), b = g.state.ball;
  if (slot === (awakened ? 4 : 3)) return chemicalReaction(g, p);
  if (!awakened && (slot === 0 || (slot === 1 && a.emperorFollowup > 0 && g.hasBall(p)))) {
    if (!onBall(g, p)) return false;
    const followup = slot === 1; if (followup) { a.emperorFollowup = 0; a.emperorRoute = null; }
    cd(p, slot, followup ? 30 : 24); clearWindup(p); recover(p, .5); aura(p, BLUE, .25);
    later(g, .25, () => aura(p, RED, .35));
    later(g, .5, () => { if (g.hasBall(p) && !(p.stun > 0)) { kick(g, p, followup ? 70 : 80, { accuracy: 1, rose: true, color: BLUE }); roses(g, p); } }); return true;
  }
  if (!awakened && slot === 1 && a.emperorFollowup > 0) {
    const from = carrier(g);
    if (!offBall(g, p) || !ready(g, p, from && from.id !== p.id, 'Subjugation needs someone else holding the ball.')) return false;
    a.emperorFollowup = 0; a.emperorRoute = null; cd(p, slot, 30);
    if (from.team !== p.team) { from.stun = Math.max(from.stun || 0, 1); effect(g, 'stun', from, RED, 1); }
    physicalPass(g, from, p, { power: 55, color: BLUE }); return true;
  }
  if (!awakened && slot === 1) {
    const on = g.hasBall(p), distance = g.width * (on ? .27 : .25), forward = direction(p);
    cd(p, slot, 20); a.emperorFollowup = 5; const route = {}; a.emperorRoute = route;
    dash(g, p, forward, 0, distance, .35, { color: BLUE, dribble: on });
    later(g, .55, () => { if (a.emperorRoute === route) dash(g, p, forward, 0, distance, .35, { color: RED, dribble: g.hasBall(p) }); }); return true;
  }
  if (!awakened && slot === 2) {
    const owner = carrier(g), mate = owner && owner.id !== p.id && owner.team === p.team ? owner : null;
    const aerial = b.owner == null && b.z > 4 && !protectedBall(g) && dist(g, p, b) <= g.width / 6;
    if (!ready(g, p, !!mate || aerial, 'Emperor’s volley requires a teammate with the ball or a nearby airborne ball.')) return false;
    cd(p, slot, 27);
    if (mate) { physicalPass(g, mate, p, { power: 55, air: true, color: BLUE }); a.emperorVolley = { left: 6 }; }
    else { trace(g, p, b); place(g, p, b.x, b.y); g.setOwner(p); p.leap = .6; kick(g, p, 75, { air: true, curve: .75, color: BLUE, rose: true }); roses(g, p); }
    return true;
  }
  if (awakened && slot === 0) {
    const enemy = enemyAhead(g, p);
    if (!onBall(g, p) || !ready(g, p, !!enemy, 'Fallrückzieher needs an opponent ahead of you.') || !spend(g, p, 'emperorBicycleUsed')) return false;
    cinematic(g, 3.2, ['Eat crap, losers!'], p, () => {
      if (!currentAwakening(p) || !g.hasBall(p)) return;
      p.leap = 1; kick(g, p, 95, { air: true, accuracy: 1, color: BLUE, rose: true }); roses(g, p, 12);
    }, { kind: 'bicycle', targetId: enemy.id }); return true;
  }
  if (awakened && slot === 1) {
    const owner = carrier(g);
    if (!offBall(g, p) || !ready(g, p, owner && owner.id !== p.id, 'MOVE IT! needs someone else holding the ball.') || !spend(g, p, 'emperorMoveUsed')) return false;
    cinematic(g, 2, ['MOVE IT!'], p, () => {
      if (!currentAwakening(p) || carrier(g)?.id !== owner.id) return;
      trace(g, p, owner); place(g, p, owner.x, owner.y); place(g, owner, owner.x, owner.y + (owner.y < g.height / 2 ? 85 : -85));
      owner.stun = Math.max(owner.stun || 0, .75); g.setOwner(p); kick(g, p, 85, { color: BLUE, rose: true }); roses(g, p, 12);
    }); return true;
  }
  if (awakened && slot === 2) {
    if (!ready(g, p, b.owner == null && b.z > 4 && !protectedBall(g), 'PERFEKTIONIERTER VOLLEY needs an airborne ball.')) return false;
    cd(p, slot, 30); trace(g, p, b); place(g, p, b.x, b.y); g.setOwner(p); p.leap = .8;
    towardGoal(g, p, 75, { air: true, curve: 1.15, accuracy: 1, savePower: 98, finishBoost: .4, color: BLUE, rose: true }); roses(g, p, 12); return true;
  }
  if (awakened && slot === 3) {
    if (!onBall(g, p) || !spend(g, p, 'magnusUsed')) return false;
    cinematic(g, 5, ['MAGNUS: TOPSPIN'], p, () => {
      if (!currentAwakening(p) || !g.hasBall(p)) return;
      roses(g, p, 16);
      const oldAim = p.aim; p.aim = { x: p.team === 0 ? g.width : 0, y: g.height / 2 };
      kick(g, p, 100, { air: true, accuracy: 1, noFrictionFor: 5, color: BLUE, rose: true }); p.aim = oldAim;
      Object.assign(b, { cannotScore: true, scriptedReturn: true, magnusFlight: true, pickupDelay: 10 });
      a.magnusFlight = { left: 4, goalBoxX: p.team === 0 ? g.width * .82 : g.width * .18 };
      // Ordinary physical flight reaches the box before the second time stop.
      // The caster stays at the shot origin while the camera returns to him.
    }); return true;
  }
  return false;
}

function tickArrivalAbilities(g, p, dt) {
  const a = ability(p), id = idOf(p), b = g.state.ball, motionDt = g.motionSeconds?.(dt) ?? dt;
  for (const key of ['butterflyFollowup', 'emperorFollowup', 'wingsLeft', 'butterflyStunLeft', 'baitLeft', 'ankleBoostLeft', 'reactionReady', 'reactionPromptLeft', 'reactionCooldown']) if (a[key] > 0) a[key] = Math.max(0, a[key] - dt);
  if (b.z > 1) b.hadAirtime = true;
  if (id === 'magician' || id === 'emperor') {
    const pair = chemicalPair(g, p);
    a.chemicalPartnerId = pair ? (id === 'emperor' ? pair.magician.id : pair.emperor.id) : null;
    if (!pair || !g.hasBall(pair.magician)) { a.reactionReady = 0; a.reactionPrompt = ''; }
    if (!(a.reactionPromptLeft > 0)) a.reactionPrompt = '';
    if (a.reactionCooldown > 0) cd(p, reactionSlot(p), a.reactionCooldown);
    if (!(a.reactionReady > 0) && !a.reactionFlight && a.reactionPrompt?.startsWith('Chemical')) a.reactionPrompt = '';
    if (id === 'emperor') {
      if (!g.hasBall(p)) a.emperorChemistry = false;
      else if (!a.emperorHadPossession || a.emperorReceiptFromId !== p.lastReceivedFromId) {
        const source = g.state.players.find(other => other.id === p.lastReceivedFromId);
        a.emperorChemistry = source?.team === p.team && idOf(source) === 'magician';
        a.emperorReceiptFromId = p.lastReceivedFromId;
      }
      a.emperorHadPossession = g.hasBall(p);
      if (p.awakened && a.auraLeft > 0) {
        a.roseClock = (a.roseClock || 0) + dt;
        if (a.roseClock > 1.2) { a.roseClock = 0; roses(g, p, 2); }
      }
      if (a.magnusFlight) {
        const flight = a.magnusFlight; flight.left -= motionDt;
        const enteredBox = p.team === 0 ? b.x >= flight.goalBoxX : b.x <= flight.goalBoxX;
        if (enteredBox || flight.left <= 0) {
          a.magnusFlight = null; b.x = flight.goalBoxX; b.vx = 0; b.vy = 0; b.vz = 0;
          roses(g, b, 14);
          cinematic(g, 2, ['VERDAMNT, JA!'], p, () => {
            b.magnusFlight = false; b.scriptedReturn = false; b.cannotScore = false;
            roses(g, p, 20); roses(g, b, 20);
            if (g.goal) g.goal(p.team);
            else { g.setOwner(p); guaranteedFinish(g, p, { power: 100, color: BLUE, rose: true }); }
          }, { kind: 'magnus-freeze', ballPosition: { x: b.x, y: b.y, z: b.z } });
        }
      }
      if (a.emperorVolley) {
        a.emperorVolley.left -= dt;
        const owner = carrier(g);
        if (g.hasBall(p)) { a.emperorVolley = null; p.leap = .6; kick(g, p, 75, { air: true, curve: .75, color: BLUE, rose: true }); roses(g, p); }
        else if ((owner && owner.id !== p.id) || a.emperorVolley.left <= 0) a.emperorVolley = null;
      }
      if (a.reactionFlight) {
        const data = a.reactionFlight, magician = g.state.players.find(other => other.id === data.magicianId);
        data.left -= dt;
        if (!magician) { a.reactionFlight = null; b.reaction = null; a.reactionCooldown = 45; cd(p, reactionSlot(p), 45); }
        else if (g.hasBall(p)) {
          a.reactionFlight = null; b.reaction = null; reactionCooldown(p, magician, 90);
          cinematic(g, 1.8, ['Thanks, Magician'], p, () => { if (g.hasBall(p)) { roses(g, p, 16); guaranteedFinish(g, p, { power: 100, air: true, rose: true, color: BLUE }); } });
        } else if (b.owner != null || data.left <= 0) { a.reactionFlight = null; b.reaction = null; reactionCooldown(p, magician, 45); g.notify?.('Chemical reaction intercepted.'); }
      }
    }
  }
  if (id === 'serpent' && a.baitLeft > 0 && !p.stun && b.owner == null && !protectedBall(g)) {
    const target = g.state.players.find(other => other.id === a.baitTarget), mate = nearestTeammate(g, p);
    if (target && mate && b.lastKickTeam === target.team) {
      const speed = Math.hypot(b.vx || 0, b.vy || 0), dx = target.x - b.x, dy = target.y - b.y, d = Math.hypot(dx, dy) || 1;
      const approaching = speed > 20 && ((b.vx || 0) * dx + (b.vy || 0) * dy) / (speed * d) > .8;
      if (b.passTarget === target.id || approaching) {
        a.baitLeft = 0; trace(g, p, b, 12); place(g, p, b.x, b.y); g.setOwner(p); aura(p, GREEN, 1.5); physicalPass(g, p, mate, { power: 55, color: GREEN });
      }
    }
  }
  if (id === 'butterflydancer') {
    a.ownHalfHeld = g.hasBall(p) && ownHalf(g, p) ? (a.ownHalfHeld || 0) + dt : 0;
    p.butterflyWings = p.awakened || a.wingsLeft > 0;
    if (a.infiniteDribble > 0) {
      a.infiniteDribble = Math.max(0, a.infiniteDribble - dt);
      if (!currentAwakening(p)) a.infiniteDribble = 0;
      if (a.infiniteDribble > 0) { p.dribbleCd = 0; p.dribbleCooldown = 0; cd(p, 2, a.infiniteDribble + 10); }
      else cd(p, 2, 10);
    }
    if (a.butterflyStunLeft > 0) {
      const start = a.butterflyLast || p, end = p, vx = end.x - start.x, vy = end.y - start.y, length2 = vx * vx + vy * vy;
      for (const enemy of opponents(g, p)) {
        const amount = length2 ? clamp(((enemy.x - start.x) * vx + (enemy.y - start.y) * vy) / length2, 0, 1) : 0;
        if (Math.hypot(enemy.x - start.x - vx * amount, enemy.y - start.y - vy * amount) < 60) {
          enemy.stun = Math.max(enemy.stun || 0, 2); a.ankleBoostLeft = 5; effect(g, 'stun', enemy, YELLOW, .5);
        }
      }
    }
    a.butterflyLast = { x: p.x, y: p.y };
  }
}
