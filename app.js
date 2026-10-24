import { Game } from './game.js?v=15';
import { ROSTER, getSkills } from './characters.js?v=7';
import { OnlineSession } from './online.js?v=7';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const icon = name => `<svg aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const storageKey = 'rematch-rush-profile-v1';
const UNLIMITED_SPINS = true;
const ids = new Set(ROSTER.map(character => character.id));
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* A fresh local profile also works with restricted storage. */ }
const profile = {
  name: typeof saved.name === 'string' ? saved.name.slice(0, 18) : 'Player',
  unlocked: [...new Set(['none', ...(Array.isArray(saved.unlocked) ? saved.unlocked.filter(id => ids.has(id)) : [])])],
  equipped: ids.has(saved.equipped) ? saved.equipped : 'none',
  spins: Number.isInteger(saved.spins) ? Math.max(0, Math.min(saved.spins, 3)) : 3,
  sound: saved.sound !== false,
  reducedMotion: saved.reducedMotion === true,
};
if (!profile.unlocked.includes(profile.equipped)) profile.equipped = 'none';
let selected = profile.equipped;
let currentScreen = 'home';
let game = null;
let online = null;
let onlineConnection = null;
let pendingOnline = false;
let gameMode = null;
let localTeam = 0;
let localPlayerId = 0;
let onlineFormat = 'custom';
let offlineFormat = 'bot-standard';
let queueFormat = null;
let customConfig = { slots: ['human', 'human', 'bot', 'bot'], duration: 300, scoreLimit: 0 };
let roomLobby = null;
const GAME_FORMATS = {
  'bot-standard': { name: 'Bot Standard · 1v1', detail: 'You versus one bot. An AI goalkeeper on each team.', humans: 1 },
  'bot-2v2': { name: '2v2 vs Bots', detail: 'You + a bot teammate versus two bots, plus AI goalkeepers.', humans: 1 },
  'standard-1v1': { name: '1v1', detail: 'Join the queue to find another player. AI goalkeepers on both sides.', humans: 2 },
  'standard-2v2': { name: '2v2', detail: 'Join the queue for two human players per team, plus AI goalkeepers.', humans: 4 },
  custom: { name: 'Custom Room', detail: 'Choose human and bot teammates, match length, and a goal target.', humans: 2 },
};
const SPIN_ODDS = {
  normal: [['common', 44], ['rare', 30], ['epic', 15], ['legendary', 8.4], ['world class', 2.2], ['master', .4]],
  lucky: [['rare', 33], ['epic', 45], ['legendary', 13], ['world class', 7], ['master', 2]],
};
let previousFocus = null;
let modalPausedGame = false;
let spinTimer = null;
let spinning = false;
let hudSignature = null;
let lastNetworkState = 0;
let toastTimer = null;
let lastState = null;
let audioContext = null;
let shotPointer = null;
const characterOf = id => ROSTER.find(character => character.id === (typeof id === 'object' ? id?.id : id)) || ROSTER[0];
const rarityOrder = ['common', 'rare', 'epic', 'legendary', 'world class', 'master'];
const orderedRoster = [...ROSTER].sort((a, b) => {
  const rank = character => rarityOrder.includes(character.rarity) ? rarityOrder.indexOf(character.rarity) : rarityOrder.length;
  return rank(a) - rank(b);
});
const rarityColors = { starter: '#85947c', common: '#83966f', rare: '#5796c0', epic: '#9974bb', legendary: '#c99b3c', 'world class': '#e65e48', master: '#6378d9' };
const titles = { none: 'THE GAME.', manmarker: 'THE DEFENSE.', ice: 'THE FREEZE.', powershooter: 'THE FINISH.', ninja: 'THE SHADOWS.', playmaker: 'THE VISION.', falcon: 'THE SKY.', streetdribbler: 'THE RHYTHM.', magician: 'THE MAGIC.', supersonic: 'THE SPEED.', trapper: 'THE CONTROL.', serpent: 'THE HUNT.', butterflydancer: 'THE SHOW.', emperor: 'THE THRONE.' };
const stageWords = { none: 'ROOKIE', manmarker: 'DEFEND', ice: 'ICE COLD', powershooter: 'POWER', ninja: 'UNSEEN', playmaker: 'VISION', falcon: 'SOAR', streetdribbler: 'GINGA', magician: 'SPELLBOUND', supersonic: 'VELOCITY', trapper: 'TRAP', serpent: 'UNSTOPPABLE', butterflydancer: 'SHOWTIME', emperor: 'BOW BEFORE ME' };

function save() { try { localStorage.setItem(storageKey, JSON.stringify(profile)); } catch { /* Play remains available without storage. */ } }
function syncProfile() {
  $('#profile-name').textContent = profile.name;
  document.body.classList.toggle('no-motion', profile.reducedMotion);
  $$('.sound-button').forEach(button => { button.innerHTML = icon(profile.sound ? 'sound' : 'muted'); button.setAttribute('aria-label', profile.sound ? 'Mute sound' : 'Enable sound'); button.setAttribute('aria-pressed', String(profile.sound)); });
  save();
}
function sound(type = 'click') {
  if (!profile.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    const notes = type === 'goal' ? [392, 494, 587, 784] : type === 'spin' ? [440, 554, 659] : type === 'kick' ? [100, 65] : type === 'save' ? [210, 145] : [560];
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = type === 'kick' ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * .075);
      gain.gain.linearRampToValueAtTime(type === 'goal' ? .065 : .035, now + index * .075 + .008);
      gain.gain.exponentialRampToValueAtTime(.001, now + index * .075 + .13);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(now + index * .075); oscillator.stop(now + index * .075 + .15);
    });
  } catch { /* Sound is optional when the browser blocks audio. */ }
}
function toast(message) {
  clearTimeout(toastTimer); const element = $('#toast'); element.textContent = message; element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 3400);
}
function showScreen(name) {
  currentScreen = name;
  $$('.screen').forEach(screen => { screen.hidden = screen.id !== `${name}-screen`; });
  $('#site-header').hidden = name === 'game';
  $('#nav-play').classList.toggle('active', name === 'home');
  $('#nav-characters').classList.toggle('active', name === 'characters');
  document.body.style.overflow = name === 'game' ? 'hidden' : '';
  if (name !== 'game') window.scrollTo({ top: 0 });
  if (name === 'characters') renderCharacters();
}
function openModal(html, wide = false) {
  previousFocus = document.activeElement;
  $('#modal-content').innerHTML = html;
  $('#modal-card').classList.toggle('wide', wide);
  $('#modal').hidden = false;
  $('#modal .modal-close').hidden = game?.getState?.().phase === 'ended';
  if (game?.running) {
    if (game.suspendControls) game.suspendControls();
    else {
      const neutral = { keys: {}, shootHeld: false, shootRelease: true };
      game.localInput.keys = {}; game.localInput.shootHeld = false;
      if (gameMode === 'guest') online?.sendInput(neutral);
      else game.setInput(localTeam, neutral);
    }
    if (gameMode === 'bot') { game.stop(); modalPausedGame = true; }
  }
  setTimeout(() => { const target = $('#modal-content [autofocus]') || $('#modal-content button') || $('#modal .modal-close'); target?.focus(); }, 40);
}
function closeModal({ keepOnline = false, resume = true } = {}) {
  if (spinning) return;
  if (resume && currentScreen === 'game' && game?.getState?.().phase === 'ended') return;
  $('#modal').hidden = true;
  if (!keepOnline && pendingOnline) closeOnline();
  if (modalPausedGame && resume && game && game.getState().phase !== 'ended') game.start();
  modalPausedGame = false;
  previousFocus?.focus?.();
}
function closeOnline() {
  const session = online; online = null; onlineConnection = null; pendingOnline = false;
  session?.close();
}

function footballer(character, { small = false, shirtOverride = null } = {}) {
  const id = character.id, color = shirtOverride || ({ none: '#e8e9d5', manmarker: '#e6c756', ice: '#9fdde1', powershooter: '#f47b40', ninja: '#62a969', playmaker: '#69bfca', falcon: '#b8c2c9', streetdribbler: '#a778bf', magician: '#ed8aba', supersonic: '#e85d50', trapper: '#6b9ae1', serpent: '#65bd71', butterflydancer: '#ebd46d', emperor: '#608dde' }[id] || '#e8e9d5');
  const skin = ['powershooter', 'streetdribbler', 'none'].includes(id) ? '#aa7653' : id === 'supersonic' ? '#c38d69' : '#d6a17a';
  const hair = id === 'ice' ? '#edf6f2' : id === 'trapper' ? '#5477ae' : id === 'falcon' ? '#9ca8ad' : id === 'magician' ? '#703f6a' : id === 'manmarker' ? '#b79f63' : id === 'supersonic' ? '#332b27' : '#28332b';
  const hairShape = id === 'supersonic' ? 'M90 69 84 48 98 52 94 36 110 44 115 26 125 45 139 33 139 50 153 47 145 70Z' : id === 'ninja' ? 'M86 67Q82 34 116 34q37 0 35 36l-11-9-17-6-20 7Z' : id === 'streetdribbler' ? 'M86 65q-10-11-3-19 0-13 10-13 2-10 14-7 10-8 20 0 13-4 19 9 13 2 8 15l-6 18-15-12-31 3Z' : 'M87 67q-4-30 27-32 36-5 36 31l-11-7-18-10-16 12Z';
  const number = { none: '10', manmarker: '04', ice: '06', powershooter: '09', ninja: '07', playmaker: '08', falcon: '17', streetdribbler: '11', magician: '14', supersonic: '01', trapper: '99', serpent: '23', butterflydancer: '18', emperor: '00' }[id] || '10';
  return `<svg viewBox="0 0 240 285" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="120" cy="270" rx="67" ry="8" fill="#26392a" opacity=".12"/><g transform="translate(0,-2)"><path d="m99 195-5 29-13 24 17 8 19-30 6-25Z" fill="${skin}"/><path d="m129 198 9 28 8 25 17-5-4-30-7-25Z" fill="${skin}"/><path d="m93 229-12 20 16 9 14-24Z" fill="#e9ead7"/><path d="m142 231 4 20 18-3-4-23Z" fill="#e9ead7"/><path d="m82 247-10 12q-4 7 7 8l23-1 1-11-8-5Z" fill="#f06d39"/><path d="m145 249 2 13 26 2q8-2 3-7l-15-11Z" fill="#f06d39"/><path d="m78 266 25-1m46-2 26 1" stroke="#253b2d" stroke-width="3"/><path d="m88 161-2 39 34 7 6-24 9 23 29-10-12-39Z" fill="#213b35"/><path d="m91 173-4 26 15 3 6-30Zm42 5 4 25 11-4-6-24Z" fill="#172e29"/><path d="m90 93-19 6-17 31-13 18 12 11 19-20 17-18Z" fill="${skin}"/><path d="m146 95 16 8 17 27 19 13-6 13-25-16-23-26Z" fill="${skin}"/><path d="m47 145-11 7-1 11 6 6 8-4 6-10Z" fill="${skin}"/><path d="m194 141 10 5 3 9-5 8-9-6-4-8Z" fill="${skin}"/><path d="m88 91 20-8 22 0 21 11 12 20-19 12 7 41q-32 13-65-2l4-38-20-8Z" fill="${color}"/><path d="m88 93 9-4-7 42 1 30-5 4 4-38-20-8 5-10Z" fill="#142c2a" opacity=".18"/><path d="m139 91 11 4 12 20-11 6-5-14Z" fill="#fff8e4" opacity=".22"/><path d="m106 82 3 14 15 7 12-12-7-10Z" fill="${skin}"/><path d="m108 91 16 11 12-12" fill="none" stroke="#233c32" stroke-width="4"/><path d="m89 165 60 1" stroke="#142b27" stroke-width="3" opacity=".5"/><path d="m73 116 15 9m60-4 13-7" stroke="#243d32" stroke-width="3" opacity=".8"/><text x="118" y="145" text-anchor="middle" font-family="Impact,Arial,sans-serif" font-style="italic" font-weight="bold" font-size="31" fill="#233d34" opacity=".86">${number}</text><path d="m99 108 5 1-1 6-5-1Z" fill="#263f34"/><path d="m134 109 6 2-2 6-5-2Z" fill="#f6f3dd" opacity=".8"/><path d="m93 55-1 24q5 16 23 17 19-1 27-20l1-23Z" fill="${skin}"/><path d="m95 67-8-2-1 9 8 5m47-13 7-2-1 11-7 3" fill="${skin}"/><path d="m94 76 10 11 14 4 15-9-4 12-15 4-13-7Z" fill="#684a35" opacity=".2"/><path d="${hairShape}" fill="${hair}"/><path d="m101 69 9-1m16 0 8 2" stroke="#2f352b" stroke-width="2.4" stroke-linecap="round"/><path d="m115 80 7 0" stroke="#895f46" stroke-width="1.5" stroke-linecap="round"/>${id === 'ninja' ? '<path d="m92 73 49-1-6 17-19 8-19-11Z" fill="#35433d"/><path d="m92 58 51-5" stroke="#4b8757" stroke-width="7"/><path d="m145 56 27 10-23-2 18 15-28-16Z" fill="#62a969"/>' : ''}${id === 'ice' ? '<path d="m96 56 40-2" stroke="#b1e7ed" stroke-width="5"/><path d="m145 107-7 8 8 7 7-7Z" fill="#edfaff"/>' : id === 'falcon' ? '<path d="m90 105 12 9-9 5m54-14-12 9 9 5" fill="none" stroke="#eef1e9" stroke-width="4"/>' : id === 'magician' ? '<path d="m90 55 54-2" stroke="#ed8aba" stroke-width="4"/><path d="m143 106 2 4 5 1-4 3 1 5-5-3-4 3 1-5-4-3 5-1Z" fill="#fff0d6"/>' : id === 'trapper' ? '<path d="m108 39 10 19 7-21m-32 19 10 5" fill="none" stroke="#8fbaff" stroke-width="5"/>' : ''}${id === 'streetdribbler' ? '<path d="m88 55 59-1" stroke="#e68145" stroke-width="7"/><path d="m145 52 19 9-15-1 9 13-17-13Z" fill="#e68145"/>' : ''}</g>${small ? '' : '<g transform="translate(178 252)"><circle r="17" fill="#f1f0de" stroke="#d4d8ca" stroke-width="1"/><path d="m-4-6 9 1 3 8-7 5-8-5Zm-8-5 4 5-7 7m26-8-6 4 8 7M-5 14l6-6 7 5" fill="#2d4035" stroke="#2d4035" stroke-width="1"/></g>'}</svg>`;
}

function renderPitch() {
  $('#pitch-art').innerHTML = `<svg viewBox="0 0 640 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><clipPath id="pitch-clip"><rect x="48" y="100" width="548" height="326"/></clipPath><linearGradient id="pitch-light" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#6a8050" stop-opacity=".12"/><stop offset="1" stop-color="#b3bf77" stop-opacity=".19"/></linearGradient></defs><g transform="rotate(-12 320 260)"><g clip-path="url(#pitch-clip)"><rect x="48" y="100" width="548" height="326" fill="#496044"/>${Array.from({ length: 8 }, (_, index) => `<rect x="${48 + index * 69}" y="100" width="34" height="326" fill="#304d35" opacity=".26"/>`).join('')}<rect x="48" y="100" width="548" height="326" fill="url(#pitch-light)"/></g><g stroke="#b0bf8a" stroke-width="1.6" fill="none" opacity=".7"><rect x="48" y="100" width="548" height="326"/><path d="M322 100v326"/><circle cx="322" cy="263" r="55"/><circle cx="322" cy="263" r="2" fill="#b0bf8a"/><path d="M48 175h90v176H48m548-176h-90v176h90M48 222h36v82H48m548-82h-36v82h36"/><path d="M138 231a38 38 0 0 1 0 64m368-64a38 38 0 0 0 0 64"/><circle cx="111" cy="263" r="2"/><circle cx="533" cy="263" r="2"/></g><g stroke="#a6b18d" stroke-width="1" opacity=".55" fill="#102f21"><path d="M48 234H24v59h24M596 234h24v59h-24"/><path d="M24 240h24m-24 8h24m-24 8h24m-24 8h24m-24 8h24m-24 8h24m-24 8h24M31 234v59m8-59v59m565-59v59m8-59v59m-16-53h24m-24 8h24m-24 8h24m-24 8h24m-24 8h24m-24 8h24m-24 8h24"/></g><path d="M293 315q95-79 218-69" fill="none" stroke="#ecd98b" stroke-width="2" stroke-dasharray="7 9" opacity=".5"/><path d="m501 237 14 9-15 7" fill="none" stroke="#ecd98b" stroke-width="2" opacity=".6"/><ellipse cx="102" cy="266" rx="15" ry="7" fill="#102c2070"/><circle cx="102" cy="253" r="10" fill="#edd66a"/><circle cx="102" cy="243" r="5" fill="#ac825a"/><ellipse cx="547" cy="259" rx="15" ry="7" fill="#102c2070"/><circle cx="547" cy="247" r="10" fill="#edd66a"/><circle cx="547" cy="237" r="5" fill="#ac825a"/></g><g transform="translate(334 125) scale(.58)">${footballer(characterOf('manmarker'), { small: true, shirtOverride: '#6d9cb7' }).replace(/<svg[^>]*>|<\/svg>/g, '')}</g><g transform="translate(139 151) scale(.87)">${footballer(characterOf('none'), { shirtOverride: '#ed794c' }).replace(/<svg[^>]*>|<\/svg>/g, '')}</g><g transform="translate(393 272) rotate(-12)"><path d="m0 0 15-6-8 16" fill="none" stroke="#f18c51" stroke-width="2"/><path d="m-7 9-7 8m20-1-5 7" stroke="#f18c51" stroke-width="2" opacity=".6"/></g></svg>`;
}

function renderCharacters() {
  const character = characterOf(selected), unlocked = profile.unlocked.includes(character.id), equipped = profile.equipped === character.id;
  $('#roster-unlocked').textContent = `${profile.unlocked.length} OF ${ROSTER.length} UNLOCKED`;
  $('#character-short').textContent = titles[character.id] || 'THE GAME.';
  $('#character-tip').textContent = character.tip || character.description;
  $('#stage-word').textContent = stageWords[character.id] || character.name;
  $('#character-art').innerHTML = footballer(character);
  $('#selected-name').textContent = character.name.toUpperCase();
  const rarity = $('#selected-rarity'); rarity.textContent = character.rarity.toUpperCase(); rarity.style.background = `${rarityColors[character.rarity] || '#85947c'}20`; rarity.style.color = rarityColors[character.rarity];
  const equip = $('#equip-button'); equip.innerHTML = equipped ? `Equipped ${icon('check')}` : unlocked ? `Equip character ${icon('arrow')}` : `Locked ${icon('lock')}`; equip.disabled = equipped || !unlocked;
  $('#spins-count').textContent = UNLIMITED_SPINS ? '∞' : profile.spins;
  $('#spin-button').disabled = !UNLIMITED_SPINS && profile.spins <= 0;
  $('#spin-button').innerHTML = UNLIMITED_SPINS || profile.spins > 0 ? `Spin for a character ${icon('arrow')}` : `All spins used ${icon('check')}`;
  for (const type of ['normal', 'lucky']) $(`#${type}-spin-odds`).innerHTML = SPIN_ODDS[type].map(([rarity, chance]) => `<div><i style="--rarity:${rarityColors[rarity]}"></i>${esc(rarity)}<b>${chance}%</b></div>`).join('');
  $('#character-skill-list').innerHTML = renderPlaybook(character);
  $('#roster-grid').innerHTML = orderedRoster.map(item => `<button class="roster-card ${item.id === selected ? 'selected' : ''} ${profile.unlocked.includes(item.id) ? '' : 'locked'}" data-action="select-character" data-character="${esc(item.id)}" style="--card-color:${rarityColors[item.rarity]}" aria-label="View ${esc(item.name)} moves${profile.unlocked.includes(item.id) ? '' : ', locked'}" aria-haspopup="dialog" aria-pressed="${item.id === selected}"><i class="card-rarity"></i>${profile.equipped === item.id ? '<span class="card-equipped">✓</span>' : profile.unlocked.includes(item.id) ? '' : '<svg class="card-lock" aria-hidden="true"><use href="#icon-lock"/></svg>'}<span class="card-art">${footballer(item, { small: true })}</span><span class="card-info"><b>${esc(item.name).toUpperCase()}</b><small>${esc(item.rarity)} · View moves ↗</small></span></button>`).join('');
}


function renderPlaybook(character) {
  const move = (skill, key) => `<div class="preview-skill" title="${esc(skill.description)}"><kbd>${key}</kbd><span>${esc(skill.name)}</span><small>${skill.once ? 'ONCE' : `${skill.cooldown}s`}</small></div>`;
  const base = '<div class="preview-skill"><kbd>F</kbd><span>Ultrashot<small>Every kick adds 1 charge. After 3 kicks, hold F and release for a boosted Curve Shot or Quick Shot.</small></span></div>';
  const skills = character.skills.length ? character.skills.map((skill, index) => move(skill, index + 1)).join('') : '<p class="empty-skills">A clean slate. Master movement, shooting, and the art of a perfect tackle.</p>';
  const passive = character.passive ? `<div class="preview-skill passive-preview" title="${esc(character.passive.description)}"><kbd>✦</kbd><span>${esc(character.passive.name)}<small>${esc(character.passive.description)}</small></span></div>` : '';
  const awakeWithBall = getSkills({character: character.id, ability: {}}, true, true);
  const alternateMoves = getSkills({character: character.id, ability: {}}, true, false).map((skill, index) => ({skill, index})).filter(({skill, index}) => skill.name !== awakeWithBall[index]?.name);
  const awakened = character.awakening ? `<details class="awakening-preview"><summary><kbd>E</kbd><span>${esc(character.awakening.name)}</span><small>${character.awakening.duration}s</small></summary><p>${esc(character.awakening.description)}</p>${awakeWithBall.map((skill, index) => move(skill, index + 1)).join('')}${alternateMoves.length ? '<p>Without the ball:</p>' + alternateMoves.map(({skill, index}) => move(skill, index + 1)).join('') : ''}</details>` : '';
  return skills + base + passive + awakened + '<button class="button outline playbook-guide-button" data-action="character-guide" aria-haspopup="dialog">See what every move does ↗</button>';
}

function guideVariants(character, awakened = false, ability = {}) {
  const player = { character: character.id, ability: ['emperor', 'magician'].includes(character.id) ? { chemicalPartnerId: -1, ...ability } : ability };
  const withBall = getSkills(player, awakened, true), withoutBall = getSkills(player, awakened, false);
  return withBall.flatMap((skill, index) => {
    const alternate = withoutBall[index];
    if (alternate && alternate.name !== skill.name) return [{ ...skill, condition: 'With the ball' }, { ...alternate, condition: 'Without the ball' }];
    return [skill];
  });
}
function characterGuide() {
  const character = characterOf(selected), unlocked = profile.unlocked.includes(character.id);
  const moves = guideVariants(character), awakened = character.awakening ? guideVariants(character, true) : [];
  const known = new Set([...moves, ...awakened].map(skill => skill.name));
  const followupState = { precisionFollowup: 1, placementFollowup: 1, heelFollowup: 1, fakeVolleyStreak: 3, rouletteFollowup: 1, pinpointFollowup: 1, butterflyFollowup: 5, emperorFollowup: 5 };
  const followups = [...guideVariants(character, false, followupState), ...(character.awakening ? guideVariants(character, true, followupState) : [])].filter(skill => {
    if (known.has(skill.name)) return false;
    known.add(skill.name); return true;
  });
  const moveCards = list => list.map(skill => `<article class="guide-move"><header><kbd>${esc(skill.key)}</kbd><h4>${esc(skill.name)}</h4><small class="guide-cooldown">${skill.once ? 'Once per awakening' : `${skill.cooldown}s cooldown`}</small></header>${skill.condition ? `<small class="guide-condition">${esc(skill.condition)}</small>` : ''}<p>${esc(skill.description)}</p></article>`).join('');
  const awakening = character.awakening;
  const awakeningRequirement = awakening?.requires === 'on-ball' ? 'Activate with the ball.' : awakening?.requires === 'off-ball' ? 'Activate without the ball.' : 'Activate with or without the ball.';
  openModal(`<div class="character-guide"><div class="character-guide-heading"><div class="guide-portrait" aria-hidden="true">${footballer(character, { small: true })}</div><div><span class="modal-eyebrow">THE PLAYBOOK / MOVE GUIDE</span><h2 class="modal-title" id="modal-title" tabindex="-1" autofocus>${esc(character.name)}</h2><span class="guide-rarity">${esc(character.rarity)}</span></div></div><p class="modal-description">${esc(character.description)}</p>${unlocked ? '' : '<p class="guide-note">You can explore every move before unlocking this character.</p>'}<section class="guide-section"><h3>Moves</h3><div class="guide-moves">${moves.length ? moveCards(moves) : '<p class="modal-description">Characterless has no special moves. Use movement, tackle / dribble, and Ultrashot to play.</p>'}</div></section>${followups.length ? `<section class="guide-section"><h3>Unlocked follow-ups</h3><p class="guide-note">Use the same move key again when its follow-up appears.</p><div class="guide-moves">${moveCards(followups)}</div></section>` : ''}<section class="guide-section guide-ultrashot"><h3>Ultrashot · every character</h3><p>Every kick adds 1 Ultrashot charge, including passes and kicking moves. After 3 kicks, hold F or the Ultrashot button and release for a boosted Curve Shot or Quick Shot. Normal mouse shots keep your earned charge until you choose to use it. Long shots can miss, and keepers can still save it.</p></section>${character.passive ? `<section class="guide-section guide-passive"><h3>Passive · ${esc(character.passive.name)}</h3><p>${esc(character.passive.description)}</p></section>` : ''}${awakening ? `<section class="guide-section guide-awakening"><h3>Awakening · ${esc(awakening.name)}</h3><p>Press E when ready. ${awakeningRequirement} Lasts ${awakening.duration} seconds.</p><p>${esc(awakening.description)}</p><div class="guide-moves">${moveCards(awakened)}</div></section>` : '<p class="guide-note">This character has no awakening.</p>'}<p class="guide-note">Moves that need a teammate are unavailable in 1v1.</p><footer class="guide-actions">${unlocked && profile.equipped !== character.id ? `<button class="button primary" data-action="equip-reveal" data-character="${esc(character.id)}">Equip ${esc(character.name)} ${icon('check')}</button>` : ''}<button class="button outline" data-action="close-modal">Back to characters</button></footer></div>`, true);
  previousFocus = $(`.roster-card[data-character="${character.id}"]`);
}

function matchModal() {
  queueFormat = null;
  const option = (format, action, badge) => `<button class="opponent-option" data-action="${action}" data-format="${format}"><span class="opponent-icon">${badge}</span><span><strong>${GAME_FORMATS[format].name}</strong><small>${GAME_FORMATS[format].detail}</small></span>${icon('arrow')}</button>`;
  openModal(`<span class="modal-eyebrow">CHOOSE YOUR MATCH</span><h2 class="modal-title" id="modal-title">THE PITCH<br>IS YOURS.</h2><p class="modal-description">Play instantly against bots, find an online match, or build your own teams.</p><section class="match-section" aria-labelledby="offline-matches"><h3 id="offline-matches">Offline <span>PLAY INSTANTLY</span></h3>${option('bot-standard', 'play-bot', '1v1')}${option('bot-2v2', 'play-bot', '2v2')}</section><section class="match-section" aria-labelledby="online-matches"><h3 id="online-matches">Online <span>PLAY WITH PEOPLE</span></h3>${option('standard-1v1', 'queue-online', '1v1')}${option('standard-2v2', 'queue-online', '2v2')}<button class="opponent-option" data-action="online"><span class="opponent-icon">＋</span><span><strong>Create a room</strong><small>Customize human and bot teams, match length, and the goal target.</small></span>${icon('arrow')}</button><button class="button outline full-button" data-action="join-online">Join a room with a code ${icon('arrow')}</button></section><p class="modal-footnote">Playing as ${esc(profile.name)} · ${esc(characterOf(profile.equipped).name)}<br>Every team has an AI goalkeeper.</p>`);
}
function helpModal() {
  openModal(`<span class="modal-eyebrow">THE BASICS / A LITTLE KNOW-HOW</span><h2 class="modal-title" id="modal-title">LET YOUR FEET<br>DO THE TALKING.</h2><p class="modal-description">First to the ball. Last to give up. Outscore your opponent before the five-minute whistle.</p><div class="controls-grid"><div class="control-row"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span><strong>Move around the pitch</strong><small>Arrow keys work too. Carrying the ball slows you 20%.</small></span></div><div class="control-row"><span><kbd>⌖</kbd></span><span><strong>Aim with your mouse</strong><small>Point at the pitch to choose your shot direction. Long shots have more spread and can miss the goal.</small></span></div><div class="control-row"><span><kbd>CLICK</kbd></span><span><strong>Normal shot</strong><small>Hold the left mouse button or Shoot button to charge, then release. Each successful kick adds 1 Ultrashot charge. Normal shots never spend it.</small></span></div><div class="control-row"><span><kbd>F</kbd></span><span><strong>Ultrashot · 3 kicks to earn</strong><small>When all 3 charge pips are filled, hold F or the Ultrashot button, then release. This spends the charge on a Curve Shot or Quick Shot. An empty attempt adds no charge.</small></span></div><div class="control-row"><span><kbd>C</kbd></span><span><strong>Tackle or dribble</strong><small>Off-ball: slide to steal. On-ball: evade a tackle.</small></span></div><div class="control-row"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><kbd>5</kbd></span><span><strong>Character abilities</strong><small>Unlock a character to bring their moves to the pitch. Emperor’s chemical reaction moves to key 5 during awakening.</small></span></div><div class="control-row"><span><kbd>Q</kbd></span><span><strong>Pass to your teammate</strong><small>Use Q or the Pass button in team modes. Every completed kick-pass adds 1 Ultrashot charge. Ground passes can be intercepted.</small></span></div><div class="control-row"><span><kbd>E</kbd></span><span><strong>Awaken your full potential</strong><small>Charges in 100 seconds. Some styles need possession.</small></span></div></div><p class="help-detail"><b>Pick your shooting spot.</b> Close, well-aimed shots are stronger chances. Normal and Ultra shots can still be saved. Earned instant-goal specials are the exceptions. Very distant shots and shots toward your own goal are unlikely to score.<br><b>Play the rebound.</b> The ball stays in play and bounces off the walls. Max-power shots and goalkeeper throws travel through the air. Dribble into a tackle to stun your rival. Teammate passing abilities require a team mode; trying them in 1v1 never spends their cooldown. Replays show up to 10 seconds before a goal. The scorer can skip. After online matches, everyone can choose Rematch in the same room.<br><b>On touch screens:</b> use the direction pad and action buttons. Drag on the pitch to aim.</p><button class="button primary full-button" data-action="close-modal">Got it. Game on. ${icon('arrow')}</button>`, true);
}
function profileModal() {
  openModal(`<span class="modal-eyebrow">YOUR NAME / YOUR REPUTATION</span><h2 class="modal-title" id="modal-title">MAKE A NAME<br>FOR YOURSELF.</h2><p class="modal-description">This is the name your rival sees on the pitch.</p><form id="profile-form"><label class="field-label" for="username-input">Player name</label><input id="username-input" class="text-input" name="username" maxlength="18" value="${esc(profile.name)}" required autofocus autocomplete="nickname"><button class="button primary" type="submit">Save player name ${icon('check')}</button></form>`);
}
function settingsModal() {
  openModal(`<span class="modal-eyebrow">OFF THE PITCH / PREFERENCES</span><h2 class="modal-title" id="modal-title">YOUR GAME.<br>YOUR RULES.</h2><p class="modal-description">Settle in before you settle the score.</p><div class="settings-row"><div><strong>Match sounds</strong><small>Kicks, saves, goals, and interface sounds.</small></div><label class="toggle"><input id="sound-setting" type="checkbox" ${profile.sound ? 'checked' : ''} aria-label="Match sounds"><span></span></label></div><div class="settings-row"><div><strong>Reduced interface motion</strong><small>Keep menu transitions and spin effects simple.</small></div><label class="toggle"><input id="motion-setting" type="checkbox" ${profile.reducedMotion ? 'checked' : ''} aria-label="Reduced interface motion"><span></span></label></div><button class="button outline full-button" data-action="help">View controls & playbook ${icon('arrow')}</button><p class="modal-footnote">Your player name, unlocked styles, and preferences are saved on this device.</p>`);
}

function customRoomControls() {
  const select = (id, options, value) => `<select id="${id}" class="text-input">${options.map(([key, label]) => `<option value="${key}"${String(key) === String(value) ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  const slot = (id, label) => `<label class="team-slot">${label}${select(`room-slot-${id}`, [['human', 'Friend'], ['bot', 'Bot'], ['empty', 'Empty']], customConfig.slots[id])}</label>`;
  return `<div class="custom-teams"><fieldset><legend>Blue team</legend><div class="team-slot"><span>Player 1</span><strong>You · ${esc(profile.name)}</strong></div>${slot(2, 'Player 2')}</fieldset><fieldset><legend>Red team</legend>${slot(1, 'Player 1')}${slot(3, 'Player 2')}</fieldset></div><div class="custom-settings"><label>Match length${select('room-duration', [[120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']], customConfig.duration)}</label><label>Goal target${select('room-score-limit', [[0, 'No goal target'], [3, 'First to 3'], [5, 'First to 5'], [10, 'First to 10']], customConfig.scoreLimit)}</label></div><p class="guide-note" id="custom-room-summary">${customConfig.slots.some((kind, id) => id % 2 === 1 && kind !== 'empty') ? customRoomSummary() : 'Add a friend or bot to the red team.'}</p><p class="guide-note">Each side needs at least one player. Friends fill open human slots in order. Every side also gets a goalkeeper.</p><button class="button primary full-button" data-action="create-room" id="create-room-button"${customConfig.slots.some((kind, id) => id % 2 === 1 && kind !== 'empty') ? '' : ' disabled'}>Create custom room ${icon('arrow')}</button>`;
}
function customRoomSummary() {
  const describe = team => customConfig.slots.map((kind, id) => ({kind, id})).filter(item => item.id % 2 === team && item.kind !== 'empty').map(item => item.id === 0 ? 'You' : item.kind === 'bot' ? 'Bot' : 'Friend').join(' + ') || 'Empty team';
  return `${describe(0)} vs ${describe(1)} · ${customConfig.duration / 60} minutes${customConfig.scoreLimit ? ` · First to ${customConfig.scoreLimit}` : ''}`;
}
function onlineModal(tab = 'create') {
  roomLobby = null; queueFormat = null; onlineFormat = 'custom';
  openModal(`<span class="modal-eyebrow">ONLINE / CUSTOM ROOMS</span><h2 class="modal-title" id="modal-title">YOUR ROOM.<br>YOUR RULES.</h2><p class="modal-description">Choose your teams and share a 4-character code. For public matchmaking, choose 1v1 or 2v2 in Online.</p><div class="modal-tabs"><button class="modal-tab ${tab === 'create' ? 'active' : ''}" data-action="online-create-tab">Create a room</button><button class="modal-tab ${tab === 'join' ? 'active' : ''}" data-action="online-join-tab">Join a room</button></div><div id="online-panel">${tab === 'create' ? customRoomControls() : `<form id="join-form"><label class="field-label" for="room-code-input">Room code</label><input class="text-input" id="room-code-input" name="code" placeholder="A7B2" maxlength="4" minlength="4" pattern="[A-Za-z0-9]{4}" autocomplete="off" autocapitalize="characters" spellcheck="false" required autofocus><button class="button primary" type="submit" id="join-room-button">Join room ${icon('arrow')}</button></form>`}</div><div id="room-lobby" class="room-lobby" aria-live="polite"></div><div class="room-status" id="room-status" role="status"><span class="live-dot"></span><span>Keep this page open while your friends join.</span></div>`);
}
function renderRoomLobby(lobby) {
  roomLobby = lobby;
  const element = $('#room-lobby'); if (!element || !lobby) return;
  const queued = queueFormat !== null;
  element.innerHTML = `<b>${GAME_FORMATS[lobby.gameFormat]?.name || 'Online match'} · ${lobby.connectedHumans} / ${lobby.requiredHumans} players</b><div class="lobby-players">${(lobby.players || []).map(player => `<div data-team="${player.team}"><span>${player.team === 0 ? 'BLUE' : 'RED'}${player.isBot ? ' · BOT' : ''}</span><strong>${esc(player.name)}</strong><small>${esc(characterOf(player.character).name)}</small></div>`).join('')}</div><p>${lobby.connectedHumans < lobby.requiredHumans ? queued ? 'Searching for more players. You can cancel at any time.' : 'Waiting for the rest of the players. Share this room code with your friends.' : 'Everyone is here. Starting the match…'}</p>${lobby.settings ? `<p>${Math.round(lobby.settings.duration / 60)} minutes${lobby.settings.scoreLimit ? ` · First to ${lobby.settings.scoreLimit}` : ''}</p>` : ''}`;
}
async function startQueue(format) {
  if (!['standard-1v1', 'standard-2v2'].includes(format)) return;
  closeOnline(); queueFormat = format;
  openModal(`<span class="modal-eyebrow">ONLINE / MATCHMAKING</span><h2 class="modal-title" id="modal-title">FINDING YOUR<br>${format === 'standard-1v1' ? 'RIVAL.' : 'TEAM.'}</h2><p class="modal-description">${GAME_FORMATS[format].name} · Waiting for ${GAME_FORMATS[format].humans} real players. The match starts automatically when everyone connects.</p><div id="online-panel"><p class="queue-search"><span class="live-dot"></span>Searching for players…</p></div><div id="room-lobby" class="room-lobby" aria-live="polite"></div><div class="room-status" id="room-status" role="status"></div><button class="button outline full-button" data-action="cancel-queue">Cancel search ${icon('close')}</button>`);
  const session = newOnlineSession();
  try { await session.queue(profile.name, profile.equipped, format); }
  catch (error) {
    if (online !== session || currentScreen === 'game') return;
    pendingOnline = false;
    setRoomStatus(error.message || 'Matchmaking could not connect. Try again.', true);
    $('#online-panel').innerHTML = `<button class="button primary full-button" data-action="queue-online" data-format="${format}">Search again ${icon('arrow')}</button>`;
  }
}
function setRoomStatus(message, error = false) {
  const status = $('#room-status'); if (!status) return;
  status.classList.toggle('error', error); status.innerHTML = `<span class="live-dot"></span><span>${esc(message)}</span>`;
}
function newOnlineSession() {
  closeOnline();
  pendingOnline = true;
  const session = new OnlineSession({
    onStatus(status) {
      if (online !== session) return;
      if (queueFormat && currentScreen !== 'game' && !['queue', 'connected', 'error'].includes(status.type)) return;
      setRoomStatus(status.message, status.type === 'error');
    },
    onLobby(lobby) { if (online === session) renderRoomLobby(lobby); },
    onConnected(connection) {
      if (online !== session) return;
      pendingOnline = false;
      onlineConnection = connection;
      session.startRound();
      sound('spin');
      startMatch(connection.role === 'host' ? 'online' : 'guest', connection);
    },
    onRematchStatus(status) { if (online === session) updateRematchStatus(status); },
    onRematchReady() {
      if (online !== session || !onlineConnection || !session.startRound()) return;
      startMatch(session.role === 'host' ? 'online' : 'guest', onlineConnection);
    },
    onInput(input, playerId = 1) { if (online === session && game && session.role === 'host') game.setInput(playerId, input); },
    onState(state) { if (online === session && game && session.role === 'guest') game.importState(state); },
    onDisconnect(event) {
      if (online !== session) return;
      if (currentScreen === 'game') {
        game?.stop();
        openModal(`<span class="modal-eyebrow">CONNECTION / FINAL WHISTLE</span><h2 class="modal-title" id="modal-title">RIVAL<br>DISCONNECTED.</h2><p class="modal-description">${esc(event.message || 'The connection to your rival ended. Create a new room to play again.')}</p><button class="button primary full-button" data-action="leave">Back to the menu ${icon('arrow')}</button>`);
      } else {
        pendingOnline = false;
        setRoomStatus(event.message || 'Connection closed. You can create a new room or try joining again.', true);
        const joinButton = $('#join-room-button');
        if (joinButton) { joinButton.disabled = false; joinButton.innerHTML = `Join room ${icon('arrow')}`; }
        const createButton = $('#create-room-button');
        if (createButton) { createButton.disabled = false; createButton.innerHTML = `Create room ${icon('arrow')}`; }
        const panel = $('#online-panel');
        if (queueFormat) {
          panel.innerHTML = `<button class="button primary full-button" data-action="queue-online" data-format="${queueFormat}">Search again ${icon('arrow')}</button>`;
        } else if ($('#joined-room-code')) panel.innerHTML = `<p class="modal-description">The room closed.</p><button class="button primary full-button" data-action="join-online">Join another room ${icon('arrow')}</button>`;
        else if ($('#created-room-code')) panel.innerHTML = `<p class="modal-description">The room closed.</p><button class="button primary full-button" data-action="create-room" id="create-room-button">Create a new room ${icon('arrow')}</button>`;
      }
    },
  });
  online = session;
  return session;
}
async function createRoom() {
  const button = $('#create-room-button'); if (button) { button.disabled = true; button.innerHTML = 'Opening your room…'; }
  const session = newOnlineSession(); setRoomStatus('Connecting to the room service…');
  try {
    const code = await session.create(profile.name, profile.equipped, 'custom', { ...customConfig, slots: [...customConfig.slots] });
    if (online !== session || currentScreen === 'game') return;
    $('#online-panel').innerHTML = `<span class="field-label">YOUR ROOM CODE</span><div class="room-code" id="created-room-code">${esc(code)}</div><div class="online-actions"><button class="button outline" data-action="copy-room" data-code="${esc(code)}">Copy code ${icon('check')}</button><button class="button outline" data-action="cancel-room">Cancel room ${icon('close')}</button></div>`;
    if (roomLobby) renderRoomLobby(roomLobby);
    const waiting = Math.max(0, customConfig.slots.filter(kind => kind === 'human').length - 1);
    setRoomStatus(`Room is live. Waiting for ${waiting} more player${waiting === 1 ? '' : 's'}…`);
  } catch (error) {
    if (online !== session) return;
    setRoomStatus(error.message || 'The room service is unavailable. Try again in a moment.', true);
    if (button?.isConnected) { button.disabled = false; button.innerHTML = `Try again ${icon('arrow')}`; }
  }
}
async function joinRoom(code) {
  const button = $('#join-room-button'); if (button) { button.disabled = true; button.innerHTML = 'Finding your rival…'; }
  const session = newOnlineSession(); setRoomStatus('Connecting to your rival’s room…');
  try {
    await session.join(code, profile.name, profile.equipped);
    if (online === session && currentScreen !== 'game') {
      $('#online-panel').innerHTML = `<span class="field-label">YOU JOINED ROOM</span><div class="room-code" id="joined-room-code">${esc(session.roomCode || code)}</div><p class="modal-description">Waiting for everyone to join. The match starts automatically.</p><button class="button outline full-button" data-action="cancel-room">Leave room ${icon('close')}</button>`;
      if (roomLobby) renderRoomLobby(roomLobby);
    }
  }
  catch (error) {
    if (online !== session) return;
    setRoomStatus(error.message || 'Could not join this room. Check the code and try again.', true);
    if (button?.isConnected) { button.disabled = false; button.innerHTML = `Join match ${icon('arrow')}`; }
  }
}

function spinRarity(lucky, roll = Math.random() * 100) {
  let total = 0; const odds = SPIN_ODDS[lucky ? 'lucky' : 'normal'];
  return odds.find(([, chance]) => { total += chance; return roll < total; })?.[0] || odds.at(-1)[0];
}
function spin(lucky = false) {
  if ((!UNLIMITED_SPINS && profile.spins <= 0) || spinning) return;
  const rarity = spinRarity(lucky);
  const pool = ROSTER.filter(character => character.rarity === rarity);
  const result = pool[Math.floor(Math.random() * pool.length)];
  const duplicate = profile.unlocked.includes(result.id);
  if (!UNLIMITED_SPINS) profile.spins -= 1;
  if (!duplicate) profile.unlocked.push(result.id);
  save(); renderCharacters();
  openModal(`<div class="spin-reveal"><span class="modal-eyebrow">A NEW POSSIBILITY / LET IT ROLL</span><h2 class="modal-title" id="modal-title">FIND YOUR<br>GAME CHANGER.</h2><div class="spin-reel"><div id="spin-reel-name">MANMARKER</div><p>${lucky ? 'LUCKY SPIN · RARE OR BETTER' : 'NORMAL SPIN · EVERY STYLE POSSIBLE'}</p></div></div>`);
  spinning = true;
  $('#modal .modal-close').disabled = true;
  let tick = 0;
  const reveal = () => {
    clearInterval(spinTimer); spinTimer = null; spinning = false;
    $('#modal .modal-close').disabled = false;
    selected = result.id; renderCharacters(); sound('spin');
    $('#modal-content').innerHTML = `<div class="spin-reveal" style="--reveal-color:${rarityColors[result.rarity]}40"><span class="modal-eyebrow">${duplicate ? 'A FAMILIAR FACE / ALREADY UNLOCKED' : 'NEW CHARACTER / A NEW WAY TO PLAY'}</span><h2 class="modal-title" id="modal-title">${esc(result.name).toUpperCase()}</h2><span class="rarity-tag" style="color:${rarityColors[result.rarity]};background:${rarityColors[result.rarity]}20">${esc(result.rarity).toUpperCase()}</span><div class="reveal-art">${footballer(result)}</div><p class="modal-description">${esc(result.tip)}<br>${UNLIMITED_SPINS ? lucky ? 'Unlimited lucky spins available' : 'Unlimited spins available' : `${profile.spins} ${profile.spins === 1 ? 'spin' : 'spins'} remaining`}${duplicate ? ' · Duplicate character' : ''}</p><div class="spin-result-actions">${UNLIMITED_SPINS || profile.spins > 0 ? `<button class="button primary" data-action="spin-again" data-spin="${lucky ? 'lucky' : 'normal'}">Spin again ${icon('arrow')}</button>` : ''}<button class="button outline" data-action="equip-reveal" data-character="${esc(result.id)}">Equip ${esc(result.name)} ${icon('check')}</button></div><button class="text-button" style="margin:7px auto 0" data-action="close-modal">Back to the roster</button></div>`;
    $('#modal-content .button')?.focus();
  };
  if (profile.reducedMotion) { setTimeout(reveal, 200); return; }
  spinTimer = setInterval(() => {
    $('#spin-reel-name').textContent = ROSTER[1 + tick % (ROSTER.length - 1)].name.toUpperCase();
    if (tick % 2 === 0) sound();
    tick += 1;
    if (tick >= 15) reveal();
  }, 105);
}

function startMatch(mode = 'bot', connection = null) {
  if (mode === 'bot') closeOnline();
  closeModal({ keepOnline: true, resume: false });
  game?.stop(); gameMode = mode; localTeam = connection?.localTeam || 0; localPlayerId = connection?.localPlayerId ?? localTeam; hudSignature = null; lastNetworkState = 0; lastState = null;
  showScreen('game');
  const character = characterOf(profile.equipped), remote = connection?.remoteProfile;
  $('#hud-character').textContent = character.name.toUpperCase(); $('#hud-name').textContent = profile.name;
  $('#hud-rarity').textContent = character.rarity.toUpperCase(); $('#hud-rarity').style.color = rarityColors[character.rarity]; $('#hud-rarity').style.background = `${rarityColors[character.rarity]}25`;
  const format = connection?.gameFormat || (mode === 'bot' ? offlineFormat : 'standard-1v1');
  const teamMatch = connection?.players ? connection.players.filter(player => player.team === localTeam).length > 1 : ['bot-2v2', 'standard-2v2'].includes(format);
  $('#blue-name').textContent = localTeam === 0 ? teamMatch ? 'YOUR TEAM' : 'YOU' : 'RIVALS'; $('#red-name').textContent = localTeam === 1 ? teamMatch ? 'YOUR TEAM' : 'YOU' : mode === 'bot' || format === 'bot-team' ? 'RIVAL AI' : 'RIVALS';
  $('#phase-banner').hidden = true; $('#cutscene-caption').hidden = true; $('#replay-label').hidden = true;
  $('#skip-replay').hidden = true;
  $('#awakening-status').hidden = true; $('#awakening-announcement').hidden = true;
  game = new Game($('#game-canvas'), {
    mode, gameFormat: format, players: connection?.players, settings: connection?.settings, character: profile.equipped, username: profile.name, localTeam, localPlayerId,
    opponentCharacter: remote?.character,
    opponentUsername: remote?.username || 'RIVAL AI',
    onState: updateHUD,
    onInput(input) { if (mode === 'guest') online?.sendInput(input); },
    onEvent(event) { if (['kick', 'goal', 'save'].includes(event.type)) sound(event.type); },
    onEnd: matchEnded,
  });
  game.start(); $('#game-canvas').focus(); updateHUD(game.getState());
}

function skillRequirement(player, slot, hasBall) {
  const id = characterOf(player.character).id, awakened = player.awakened;
  const teamAvailable = lastState?.players?.some(other => other.id !== player.id && other.team === player.team);
  const teamOnly = teamAvailable ? 'Needs a teammate' : 'Team mode only';
  if (id === 'manmarker') return slot === 0 ? 'Dash to steal' : slot === 1 ? 'Near an opponent' : 'Off ball · near carrier';
  if (id === 'powershooter') return slot === 0 && awakened ? 'Loose ball only' : slot === 1 ? 'Dash to steal' : 'Needs the ball';
  if (id === 'ninja') return slot === 0 ? 'Without the ball' : 'Needs the ball';
  if (id === 'ice') return slot === 1 ? 'Ball · opponent ahead' : teamAvailable ? 'Ball · aim at teammate' : teamOnly;
  if (id === 'falcon') return slot === 0 ? awakened ? 'Needs the ball' : 'Airborne ball · nearby' : slot === 1 ? 'Off ball · within ⅓ pitch' : 'Needs the ball';
  if (id === 'magician') {
    if (awakened) return slot === 0 ? 'Ball · in your own half' : slot === 1 ? hasBall ? 'Team · 10s possession' : 'Team · loose ball' : 'Needs the ball';
    if (slot >= 3) return 'Reaction · both press 4';
    return slot === 0 && !(player.ability?.placementFollowup > 0) ? 'Needs the ball' : teamOnly;
  }
  if (id === 'trapper') {
    if (awakened) return slot === 0 ? hasBall ? 'Ball · opponent ahead' : 'Loose ball only' : slot === 1 ? hasBall ? 'Needs the ball' : 'After a rival shot' : 'After a rival shot';
    return slot === 0 ? hasBall ? 'Needs the ball' : 'Intercept any height' : slot === 2 && !(player.ability?.fakeVolleyStreak >= 3) ? 'Ball · counter a tackle' : 'Needs the ball';
  }
  if (id === 'playmaker') return slot === 0 ? 'Speed boost' : slot === 2 ? teamOnly : awakened ? 'Ball · opponent ahead' : 'Needs the ball';
  if (id === 'serpent') return slot === 0 ? awakened ? 'Loose ball / rival shot' : 'Without the ball' : slot === 1 ? awakened ? 'Own keeper throw · landed' : 'Carrier directly ahead' : teamOnly;
  if (id === 'butterflydancer') return !hasBall && slot === 1 ? 'Loose / airborne ball' : awakened && slot === 0 ? hasBall ? 'Own half · 5 seconds' : 'Opponent has the ball' : 'Needs the ball';
  if (id === 'emperor') return slot === (awakened ? 4 : 3) ? `Reaction · both confirm` : slot === 1 ? hasBall ? 'Ball · follow-up ready' : 'Without the ball' : slot === 2 ? 'Airborne ball / teammate' : 'Needs the ball';
  if (id === 'streetdribbler') return 'Needs the ball';
  if (id === 'supersonic') {
    if (awakened) return ['Ball · halfway to box', 'Without the ball', 'After a rival kick', 'Any time'][slot];
    if (slot === 0) return 'Needs the ball';
    if (slot === 1) return player.ability?.pinpointFollowup > 0 ? teamOnly : 'Opponent has the ball';
    return hasBall ? 'Counter a tackle' : 'Loose ball only';
  }
  return '';
}
function updateHUD(state) {
  if (!game || currentScreen !== 'game') return;
  lastState = state;
  if (online?.role === 'host' && performance.now() - lastNetworkState >= 48) { lastNetworkState = performance.now(); online.sendState(game.exportState()); }
  $('#blue-score').textContent = state.score?.[0] || 0; $('#red-score').textContent = state.score?.[1] || 0;
  const seconds = Math.max(0, Math.ceil(state.time || 0)); $('#match-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  updateAwakeningStatus(state);
  const player = state.players?.find(item => item.id === localPlayerId); if (!player) return;
  const hasTeammate = state.players.some(other => other.id !== player.id && other.team === player.team);
  for (const selector of ['#pass-button', '#touch-pass-button']) {
    const button = $(selector); button.hidden = false; button.disabled = !hasTeammate;
    button.title = hasTeammate ? 'Q: pass to your teammate. Each successful kick adds 1 Ultrashot charge.' : 'Passing needs a teammate. Choose a team mode to pass.';
  }
  const reactionNotice = $('#chemical-notice');
  reactionNotice.hidden = !((player.ability?.reactionReady > 0 || player.ability?.reactionPromptLeft > 0) && player.ability?.reactionPrompt);
  reactionNotice.textContent = reactionNotice.hidden ? '' : player.ability.reactionPrompt;
  const character = characterOf(player.character), owner = typeof state.ball?.owner === 'object' ? state.ball.owner?.id : state.ball?.owner;
  const hasBall = owner === player.id;
  const shotMeter = game?.shotMeter?.(player);
  const power = Math.max(5, Math.min(100, Math.round(shotMeter?.power ?? player.charge ?? 5)));
  $('#charge-value').textContent = `${power} / 100`; $('#charge-fill').style.width = `${power}%`;
  $('.shot-charge').classList.toggle('is-charging', !!player.charging || !!player.shotWindup);
  const skills = getSkills(player, player.awakened, hasBall);
  const signature = `${character.id}:${skills.map((skill, index) => `${skill.name}:${skill.used}:${skillRequirement(player, index, hasBall)}`).join('|')}`;
  if (signature !== hudSignature) {
    hudSignature = signature;
    const universalShot = `<div class="kick-controls"><button class="ability-button normal-shot-button" data-action="shoot" id="normal-shot-button" title="Hold to charge a normal shot, then release. Each kick adds 1 Ultrashot charge."><b>Shoot</b><small>Click / hold · release</small></button><button class="ability-button universal-shot-button" data-action="ultrashot" id="ultra-shot-button" title="After 3 kicks, hold F or this button to charge, then release for an Ultrashot. Normal clicks never spend the charge."><kbd>F</kbd><b>Ultrashot</b><small id="ultra-shot-status">3 KICKS TO ULTRA</small><small>Hold F · release to use</small><div class="ultra-cycle" aria-hidden="true"><i id="ultra-pip-1"></i><i id="ultra-pip-2"></i><i id="ultra-pip-3"></i></div></button><button class="ability-button team-pass-button" data-action="pass" id="pass-action-button"><kbd>Q</kbd><b>Pass</b><small id="pass-action-status">Team modes</small></button></div>`;
    const characterMoves = skills.length ? skills.map((skill, index) => `<button class="ability-button" data-action="use-skill" data-key="${index + 1}" title="${esc(skill.description)}" aria-label="${index + 1}: ${esc(skill.name)}. ${esc(skillRequirement(player, index, hasBall))}"><div class="cooldown-wipe" hidden></div><kbd>${index + 1}</kbd><b>${esc(skill.name)}</b><small>${esc(skillRequirement(player, index, hasBall))}</small><small>${skill.once ? 'Once per awakening' : `${skill.cooldown}s cooldown`}</small><em hidden></em></button>`).join('') : `<div class="ability-button" role="status" style="padding-left:12px"><b>No character abilities</b><small>Spin & equip in Characters</small></div><button class="ability-button" data-action="tackle" title="C: slide tackle without the ball, dribble while carrying it"><kbd>C</kbd><b>Tackle / dribble</b><small>2s cooldown</small><div class="cooldown-wipe" hidden></div><em hidden></em></button>`;
    $('#ability-list').innerHTML = characterMoves;
    $('#ultra-shot-control').innerHTML = universalShot;
  }
  const cycle = Math.max(0, Math.min(3, Math.floor(player.ultraCharge || 0)));
  const ultraReady = cycle >= 3, shotButton = $('#ultra-shot-button');
  $('#ultra-shot-status').textContent = ultraReady ? 'ULTRA READY · F' : `${3 - cycle} KICKS TO ULTRA`;
  shotButton.classList.toggle('ultra-ready', ultraReady);
  const canPlay = state.phase === undefined || state.phase === 'play';
  shotButton.disabled = !canPlay || !ultraReady;
  $('#normal-shot-button').disabled = !canPlay;
  $('#pass-action-button').disabled = !canPlay || !hasTeammate;
  $('#pass-action-button').title = hasTeammate ? 'Q: pass to a teammate' : 'A teammate is needed to pass';
  $('#pass-action-status').textContent = hasTeammate ? 'Pass to teammate' : 'Needs a teammate';
  $('#touch-ultra-button').disabled = !canPlay || !ultraReady;
  shotButton.setAttribute('aria-label', `F: Ultrashot. ${ultraReady ? 'Ready. Hold F or this button and release to use.' : `${3 - cycle} more kicks to charge.`}`);
  for (let pip = 1; pip <= 3; pip++) $(`#ultra-pip-${pip}`).classList.toggle('filled', pip <= cycle);
  $$('button.ability-button:not([data-action="shoot"])', $('#ability-list')).forEach((button, index) => {
    const skill = skills[index], cooldown = skill ? skill.followup ? 0 : player.cooldowns?.[index] || 0 : hasBall ? player.dribbleCd || 0 : player.slideCd || 0, used = !!skill?.used;
    const wipe = $('.cooldown-wipe', button), number = $('em', button);
    button.classList.toggle('on-cooldown', cooldown > .05 || used); wipe.hidden = cooldown <= .05 && !used;
    wipe.style.transform = `scaleY(${used ? 1 : Math.min(1, cooldown / (skill?.cooldown || 2))})`;
    number.hidden = cooldown <= .05 && !used; number.textContent = used ? '✓' : Math.ceil(cooldown);
  });
  const available = !!character.awakening, charge = Math.min(100, player.awakeningCharge || 0), active = player.awakened && player.awakeningLeft > 0;
  const awakeningButton = $('#awakening-button'); awakeningButton.classList.toggle('ready', available && charge >= 100 && !active); awakeningButton.classList.toggle('active', active);
  $('#awakening-fill').style.width = `${active ? player.awakeningLeft / (character.awakening?.duration || 45) * 100 : charge}%`;
  const requirement = character.awakening?.requires;
  const waiting = state.lastAwakeningRecipient === player.id && !active && charge < 100;
  const condition = requirement === 'off-ball' ? 'WITHOUT BALL' : requirement === 'on-ball' ? 'WITH BALL' : 'ANY TIME';
  $('#awakening-label').textContent = !available ? 'NO AWAKENING' : active ? `ACTIVE · ${Math.ceil(player.awakeningLeft)}s` : charge >= 100 ? `READY · ${condition} · E` : waiting ? 'WAITING FOR RIVAL' : `BUILDING · ${Math.floor(charge)}%`;
  awakeningButton.title = !available ? `${character.name} has no awakening.` : waiting ? 'Another player must receive awakening before you can get it again.' : `Press E ${requirement === 'off-ball' ? 'without the ball' : requirement === 'on-ball' ? 'while carrying the ball' : 'with or without the ball'} when awakening is ready.`;
  $('#game-status').textContent = state.message || '';
  updateReplayControl(state);
  // The game renderer owns celebrations, replay labels, and cutscenes so all camera effects stay synchronized.
}
function updateReplayControl(state) {
  const button = $('#skip-replay');
  button.hidden = !['celebrate', 'replay'].includes(state.phase) || (state.scorer != null ? state.scorer !== localPlayerId : state.scorerTeam !== localTeam);
}
function updateAwakeningStatus(state) {
  const players = state.players || [];
  const isActive = player => player.awakened && player.awakeningLeft > 0;
  const hasAwakening = player => !!characterOf(player.character).awakening && (isActive(player) || player.awakeningCharge >= 100);
  const assigned = state.awakeningOwner == null ? null : players.find(player => player.id === state.awakeningOwner);
  const owner = assigned && hasAwakening(assigned) ? assigned : players.find(player => hasAwakening(player) && isActive(player)) || players.find(hasAwakening);
  const status = $('#awakening-status');
  status.hidden = !owner;
  status.textContent = owner ? `${owner.name || owner.username || (owner.team === localTeam ? profile.name : 'Rival')} · AWAKENING ${isActive(owner) ? `ACTIVE · ${Math.ceil(owner.awakeningLeft)}s` : 'READY'}` : '';
  status.dataset.team = owner ? String(owner.team) : '';
  status.dataset.state = owner && isActive(owner) ? 'active' : 'ready';
  const notice = state.awakeningNotice;
  const announcement = $('#awakening-announcement');
  const recipient = notice && players.find(player => player.id === notice.playerId);
  const message = notice?.left > 0 ? `${notice.name || recipient?.name || 'A player'} gets awakening!` : '';
  announcement.hidden = !message;
  announcement.dataset.team = String(notice?.team ?? recipient?.team ?? '');
  if (announcement.textContent !== message) announcement.textContent = message;
}
function matchEnded(result) {
  // Send the final frame before stopping the host so the rival also reaches full time.
  if (online?.role === 'host' && game?.exportState) online.sendState(game.exportState());
  game?.stop();
  const score = result.score || [0, 0], player = result.players?.find(item => item.id === localPlayerId), myScore = score[localTeam], theirScore = score[1 - localTeam];
  openModal(`<span class="modal-eyebrow">FULL TIME / LEAVE IT ALL ON THE PITCH</span><h2 class="modal-title" id="modal-title">${myScore > theirScore ? 'THAT’S YOUR<br>GAME.' : myScore < theirScore ? 'EVERY RIVALRY<br>NEEDS A REMATCH.' : 'NOTHING<br>BETWEEN YOU.'}</h2><div class="result-score">${score[0]} <span style="color:#b8c4ac;font-size:50px">:</span> ${score[1]}</div><div class="result-stats"><b>${player?.stats?.goals || 0}<small>YOUR GOALS</small></b><b>${player?.stats?.assists || 0}<small>YOUR ASSISTS</small></b></div><button class="button primary full-button" id="rematch-button" data-action="rematch">Rematch ${icon('arrow')}</button><p id="rematch-status" class="rematch-status" role="status" aria-live="polite">${gameMode === 'bot' ? 'Play another match right away.' : 'Same rival. Same room. No code needed.'}</p><button class="button outline full-button" data-action="leave">Back to menu ${icon('arrow')}</button>`);
  online?.markRoundEnded();
}
function updateRematchStatus({ localReady = false, remoteReady = false, readyCount = 0, requiredCount = 2 } = {}) {
  if (game?.getState?.().phase !== 'ended') return;
  const button = $('#rematch-button'), status = $('#rematch-status');
  if (!button || !status) return;
  button.disabled = localReady;
  button.innerHTML = localReady ? `Rematch requested ${icon('check')}` : `Rematch ${icon('arrow')}`;
  status.textContent = requiredCount > 2 ? readyCount >= requiredCount ? 'Everyone is ready. Starting the next match…' : `${readyCount} / ${requiredCount} ready. Everyone chooses Rematch to stay in this room.` : localReady && remoteReady ? 'Both ready. Starting the next match…' : localReady ? 'Waiting for your rival. You’re staying in the same room.' : remoteReady ? 'Your rival wants a rematch. Ready for another?' : 'Same rival. Same room. No code needed.';
}
function requestRematch() {
  if (gameMode === 'bot') { startMatch('bot'); return; }
  if (!online?.requestRematch()) toast('The room is no longer connected. Return to the menu to start a new match.');
}
function leaveMatch() {
  game?.stop(); game = null; gameMode = null; lastState = null; closeOnline(); modalPausedGame = false;
  closeModal({ resume: false }); showScreen('home');
}
function pressKey(key, down = true) { if (!game || currentScreen !== 'game') return; window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key, bubbles: true, cancelable: true })); }

document.addEventListener('pointerdown', event => {
  const button = event.target.closest('[data-action="shoot"], [data-action="ultrashot"]');
  if (!button || button.disabled || shotPointer !== null || event.button > 0) return;
  event.preventDefault();
  const ultra = button.dataset.action === 'ultrashot';
  if (!(ultra ? game?.startUltrashot?.() : game?.startShot?.())) return;
  shotPointer = { id: event.pointerId ?? 0, ultra };
  button.setPointerCapture?.(shotPointer.id);
});
const releaseShotPointer = event => {
  if (shotPointer === null || (event.pointerId ?? 0) !== shotPointer.id) return;
  const ultra = shotPointer.ultra; shotPointer = null; event.preventDefault();
  if (ultra) game?.releaseUltrashot?.(); else game?.releaseShot?.();
};
document.addEventListener('pointerup', releaseShotPointer);
document.addEventListener('pointercancel', releaseShotPointer);
document.addEventListener('lostpointercapture', releaseShotPointer);
window.addEventListener('blur', () => { shotPointer = null; if (game?.suspendControls) game.suspendControls(); else game?.releaseShot?.(); });

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action !== 'sound') sound();
  if (action === 'home') { if (currentScreen !== 'game') { closeModal(); showScreen('home'); } }
  else if (action === 'characters') { closeModal(); selected = profile.equipped; showScreen('characters'); }
  else if (action === 'match') matchModal();
  else if (action === 'help' || action === 'game-help') helpModal();
  else if (action === 'settings') settingsModal();
  else if (action === 'profile') profileModal();
  else if (action === 'sound') { profile.sound = !profile.sound; syncProfile(); if (profile.sound) sound(); toast(profile.sound ? 'Sound on. Hear the game.' : 'Sound muted.'); }
  else if (action === 'close-modal') closeModal();
  else if (action === 'select-character') { selected = button.dataset.character; renderCharacters(); characterGuide(); }
  else if (action === 'character-guide') characterGuide();
  else if (action === 'equip' || action === 'equip-reveal') { const id = button.dataset.character || selected; if (profile.unlocked.includes(id)) { profile.equipped = id; selected = id; save(); renderCharacters(); if (action === 'equip-reveal') closeModal(); toast(`${characterOf(id).name} equipped. Your move.`); } }
  else if (action === 'spin' || action === 'spin-again' || action === 'lucky-spin') spin(action === 'lucky-spin' || button.dataset.spin === 'lucky');
  else if (action === 'play-bot') { offlineFormat = button.dataset.format === 'bot-2v2' ? 'bot-2v2' : 'bot-standard'; startMatch('bot'); }
  else if (action === 'online') { closeOnline(); onlineModal(); }
  else if (action === 'queue-online' || action === 'online-mode') startQueue(button.dataset.format);
  else if (action === 'cancel-queue') { closeOnline(); queueFormat = null; matchModal(); }
  else if (action === 'join-online') { closeOnline(); onlineModal('join'); }
  else if (action === 'online-create-tab') { closeOnline(); onlineModal('create'); }
  else if (action === 'online-join-tab') { closeOnline(); onlineModal('join'); }
  else if (action === 'create-room') createRoom();
  else if (action === 'cancel-room') { closeOnline(); onlineModal('create'); }
  else if (action === 'copy-room') {
    const code = button.dataset.code;
    navigator.clipboard?.writeText(code).then(() => toast('Room code copied. Send it to your rival.')).catch(() => { const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents($('#created-room-code')); selection.removeAllRanges(); selection.addRange(range); toast('Room code selected. Copy it to share.'); });
    if (!navigator.clipboard) toast(`Your room code: ${code}`);
  }
  else if (action === 'leave') leaveMatch();
  else if (action === 'rematch') requestRematch();
  else if (action === 'skip-replay') { game?.skipReplay(localPlayerId); $('#game-canvas').focus(); }
  else if (action === 'use-skill') { game?.useSkill(Number(button.dataset.key)); $('#game-canvas').focus(); }
  else if (action === 'shoot') { if (event.detail === 0 && game?.startShot?.()) game?.releaseShot?.(); $('#game-canvas').focus(); }
  else if (action === 'ultrashot') { if (event.detail === 0 && game?.startUltrashot?.()) game?.releaseUltrashot?.(); $('#game-canvas').focus(); }
  else if (action === 'tackle') { game?.useAction(); $('#game-canvas').focus(); }
  else if (action === 'pass') { game?.usePass?.(); $('#game-canvas').focus(); }
  else if (action === 'awaken') { game?.useAwakening(); $('#game-canvas').focus(); }
  else if (action === 'fullscreen') { if (document.fullscreenElement) document.exitFullscreen?.(); else $('#game-screen').requestFullscreen?.().catch(() => toast('Fullscreen is not available in this browser.')); }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'profile-form') { event.preventDefault(); const name = $('#username-input').value.trim().replace(/[<>]/g, '').slice(0, 18); if (!name) { $('#username-input').setCustomValidity('Choose a player name.'); $('#username-input').reportValidity(); return; } profile.name = name; syncProfile(); closeModal(); toast('Player name saved. Make it known.'); }
  if (event.target.id === 'join-form') { event.preventDefault(); joinRoom($('#room-code-input').value.trim()); }
});
document.addEventListener('input', event => { if (event.target.id === 'username-input') event.target.setCustomValidity(''); if (event.target.id === 'room-code-input') event.target.value = event.target.value.toUpperCase(); });
document.addEventListener('change', event => {
  if (event.target.id === 'sound-setting') { profile.sound = event.target.checked; syncProfile(); sound(); }
  if (event.target.id === 'motion-setting') { profile.reducedMotion = event.target.checked; syncProfile(); }
  if (/^room-slot-[123]$/.test(event.target.id)) customConfig.slots[Number(event.target.id.at(-1))] = event.target.value;
  if (event.target.id === 'room-duration') customConfig.duration = Number(event.target.value);
  if (event.target.id === 'room-score-limit') customConfig.scoreLimit = Number(event.target.value);
  if (/^room-(slot-|duration|score-limit)/.test(event.target.id)) {
    const valid = customConfig.slots.some((kind, id) => id % 2 === 1 && kind !== 'empty');
    $('#create-room-button').disabled = !valid;
    $('#custom-room-summary').textContent = valid ? customRoomSummary() : 'Add a friend or bot to the red team.';
  }
});
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) closeModal(); });
window.addEventListener('keydown', event => {
  if ($('#modal').hidden) { if (event.key === 'Escape' && currentScreen === 'game') { event.preventDefault(); helpModal(); } return; }
  if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
  if (event.key === 'Tab') {
    const focusable = $$('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]', $('#modal')), first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && event.key !== 'Tab' && event.key !== 'Enter' && event.key !== ' ') event.stopImmediatePropagation();
}, true);
const touchKeys = { up: 'w', left: 'a', down: 's', right: 'd', c: 'c' };
$$('[data-touch]').forEach(button => {
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); pressKey(touchKeys[button.dataset.touch]); });
  const release = event => { event.preventDefault(); pressKey(touchKeys[button.dataset.touch], false); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
});
window.addEventListener('pagehide', () => { game?.stop(); online?.close(); });
syncProfile(); renderPitch(); renderCharacters(); showScreen('home');
