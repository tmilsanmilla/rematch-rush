import {FLOW_ROSTER,flowOf,remainingMoveSeconds} from './flow.js?v=2';
import {createGameAccount} from './game-account.js?v=6';
import {accountSettings,AVATAR_COLORS,AVATAR_FONTS,normaliseProgress,levelProgress,buyFlowSpin,equipFlow,chooseFlow,FLOW_SPIN_PRICES,settleProgress,buySpin,toggleVariant,selectedVariants,variantUnlocks,moveQuests,QUESTS,SPIN_PRICES} from './progression.js?v=6';
import { MATCH_RULES, ONLINE_FORMATS, rulesFor } from './match-rules.js?v=2';
import { Game, ACTION_COOLDOWNS } from './game.js?v=27';
import { ROSTER, getSkills } from './characters.js?v=12';
import { OnlineSession } from './online.js?v=17';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const icon = name => `<svg aria-hidden="true"><use href="#icon-${name}"/></svg>`;
function initialAvatar(name,font){
 const letter=Array.from(String(name||'P').trim())[0]?.toUpperCase()||'P';
 const glyph={A:'0e11111f111111',B:'1e11111e11111e',C:'0f10101010100f',D:'1e11111111111e',E:'1f10101e10101f',F:'1f10101e101010',G:'0f10101711110f',H:'1111111f111111',I:'1f04040404041f',J:'0101010111110e',K:'11121418141211',L:'1010101010101f',M:'111b1515111111',N:'11191513111111',O:'0e11111111110e',P:'1e11111e101010',Q:'0e11111115120d',R:'1e11111e141211',S:'0f10100e01011e',T:'1f040404040404',U:'1111111111110e',V:'11111111110a04',W:'11111115151b11',X:'11110a040a1111',Y:'11110a04040404',Z:'1f01020408101f'}[letter];
 if(font!=='pixel'||!glyph)return `<span>${esc(letter)}</span>`;
 const rows=glyph.match(/../g);return `<svg viewBox="0 0 7 9" shape-rendering="crispEdges" aria-hidden="true">${rows.flatMap((row,y)=>Array.from({length:5},(_,x)=>parseInt(row,16)&(1<<(4-x))?`<rect x="${x+1}" y="${y+1}" width="1" height="1"/>`:'')).join('')}</svg>`;
}
const storageKey = 'rematch-rush-profile-v1';
const UNLIMITED_SPINS = false;
const ids = new Set(ROSTER.map(character => character.id));
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* A fresh local profile also works with restricted storage. */ }
const profile = {
  name: typeof saved.name === 'string' ? saved.name.slice(0, 18) : 'Player',
  unlocked: [...new Set(['none', ...(Array.isArray(saved.unlocked) ? saved.unlocked.filter(id => ids.has(id)) : [])])],
  equipped: ids.has(saved.equipped) ? saved.equipped : 'none',
  ...normaliseProgress(saved),
  spins: Number.isInteger(saved.spins) ? Math.max(0, Math.min(saved.spins, 3)) : 3,
  sound: saved.sound !== false,
  reducedMotion: saved.reducedMotion === true,
};
profile.settings=accountSettings({...profile.settings,name:saved.settings?.name??profile.name,sound:saved.settings?.sound??profile.sound,reducedMotion:saved.settings?.reducedMotion??profile.reducedMotion});
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
let customConfig = { slots: ['human', 'human', 'bot', 'bot','empty','empty'], duration: 300, scoreLimit: 0, botCharacters:{} };
let roomLobby = null;
const GAME_FORMATS = Object.fromEntries(Object.entries(MATCH_RULES).map(([id,r])=>[id,{...r,name:id==='custom'?'Custom Room':id==='bot-team'?'Co-op vs Bots':id==='bot-penalty'?'Bot Penalty Practice':id==='penalties-1v1'?'1v1 Penalties Online':`${r.size}v${r.size} ${id.startsWith('bot-')?'Bot':'Online'} ${r.variant==='raw'?'Raw Skill':'Standard'}`,detail:r.variant==='raw'?'Characterless only · fixed 3-minute match':r.variant.startsWith('penalt')?'Penalty shots · no Destruction League points':id.startsWith('bot-')?'Play instantly with AI goalkeepers':'Queue for real players with AI goalkeepers'}]));
let offlineBots={};
function renderModes(){
 const section=(title,formats)=>`<div class="mode-heading"><h2>${title}</h2><span>Every standard team has a goalkeeper</span></div><div class="mode-grid">${formats.map(format=>{const r=GAME_FORMATS[format],bot=format.startsWith('bot-');return `<button class="mode-card ${bot?'offline-mode':''}" data-action="${bot?'play-bot':'queue-online'}" data-format="${format}"><span class="mode-tag">${bot?'OFFLINE · PLAY NOW':'ONLINE · MATCHMAKING'}</span><strong>${esc(r.name)}</strong><small>${esc(r.detail)}</small><span class="mode-arrow">↗</span></button>`;}).join('')}</div>`;
 $('#mode-grid').innerHTML=section('OFFLINE',Object.keys(GAME_FORMATS).filter(f=>f.startsWith('bot-')&&f!=='bot-team'))+`<button class="button outline bot-setup-button" data-action="configure-bots">Choose bot characters ↗</button>`+section('ONLINE',ONLINE_FORMATS)+`<div class="room-mode-actions"><button class="button primary" data-action="online">Create a room</button><button class="button outline" data-action="join-online">Join a room</button></div>`;
}
function configureBots(){
 const slots=Array.from({length:(MATCH_RULES[offlineFormat]?.size||1)*2},(_,id)=>id).filter(id=>id!==0);
 openModal(`<span class="modal-eyebrow">BOT SETUP</span><h2 class="modal-title" id="modal-title">YOUR PRACTICE.</h2><p class="modal-description">Automatic bots match your character’s rarity. Choose any explicit style instead.</p><label class="field-label">Mode<select id="bot-mode" class="text-input">${Object.entries(GAME_FORMATS).filter(([id])=>id.startsWith('bot-')&&id!=='bot-team').map(([id,r])=>`<option value="${id}"${id===offlineFormat?' selected':''}>${r.name}</option>`).join('')}</select></label>${slots.map(id=>`<label class="field-label">${id%2?'Opponent':'Teammate'} ${Math.floor(id/2)+1}<select id="bot-character-${id}" class="text-input"><option value="">Automatic · same rarity</option>${orderedRoster.map(c=>`<option value="${c.id}"${offlineBots[id]===c.id?' selected':''}>${esc(c.name)}</option>`).join('')}</select></label>`).join('')}<button class="button primary full-button" data-action="start-configured-bots">Kick off</button>`);
}

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
const titles = { malicia:'THE PRAYER.',raven:'THE HEART.',none: 'THE GAME.', manmarker: 'THE DEFENSE.', ice: 'THE FREEZE.', powershooter: 'THE FINISH.', ninja: 'THE SHADOWS.', playmaker: 'THE VISION.', falcon: 'THE SKY.', streetdribbler: 'THE RHYTHM.', magician: 'THE MAGIC.', supersonic: 'THE SPEED.', trapper: 'THE CONTROL.', serpent: 'THE HUNT.', butterflydancer: 'THE SHOW.', emperor: 'THE THRONE.' };
const stageWords = { malicia:'AMEN',raven:'EUPHONY',none: 'ROOKIE', manmarker: 'DEFEND', ice: 'ICE COLD', powershooter: 'POWER', ninja: 'UNSEEN', playmaker: 'VISION', falcon: 'SOAR', streetdribbler: 'GINGA', magician: 'SPELLBOUND', supersonic: 'VELOCITY', trapper: 'TRAP', serpent: 'UNSTOPPABLE', butterflydancer: 'SHOWTIME', emperor: 'BOW BEFORE ME' };

let guestProgress=normaliseProgress(profile),usingAccount=false,roundReceipt=null;
const gameAccount=createGameAccount({onChange({account,pending,pendingAction,lastReward,lastError}){
 const status=$('#account-save-status'),message=$('#account-save-message');
 if(status&&message){status.hidden=!pending&&!lastReward&&!lastError;status.classList.toggle('error',!!lastError);status.setAttribute('role',lastError?'alert':'status');message.textContent=pending?(pendingAction==='finish'?'Match result waiting to save. ':'Account operation waiting. ')+(account?'Retry the saved operation.':'Sign in on the live game to resume it.')+(lastError?' '+lastError:''):lastError|| (lastReward?`Saved to account: +$${lastReward.money} · +${lastReward.points} GLOBAL DLSI points · +${lastReward.xp||0} XP.`:'');const retry=$('[data-action="retry-account"]',status);if(retry){retry.hidden=!pending&&!lastError;retry.textContent=pending?'Retry saved operation':'Retry account sync';}}
 if(account){if(!usingAccount)guestProgress={...normaliseProgress(profile),settings:accountSettings({...profile.settings,name:profile.name,sound:profile.sound,reducedMotion:profile.reducedMotion})};usingAccount=true;Object.assign(profile,account.profile);applyPreferences(account.profile.settings);}
 else if(usingAccount){Object.assign(profile,guestProgress);usingAccount=false;applyPreferences(guestProgress.settings);}
 const nav=$('#nav-admin');if(nav)nav.hidden=!account?.admin;syncProfile();if(currentScreen==='characters')renderCharacters();
}});
function applyPreferences(settings){profile.settings=accountSettings(settings);profile.name=profile.settings.name;profile.sound=profile.settings.sound;profile.reducedMotion=profile.settings.reducedMotion;}
async function savePreferences(settings){const next=accountSettings(settings);try{if(usingAccount){await gameAccount.mutate('preferences',{settings:next});toast('Preferences saved to your account.');}else{applyPreferences(next);syncProfile();toast('Preferences saved on this device.');}return true;}catch(error){toast(error.message);$('#sound-setting').checked=profile.sound;$('#motion-setting').checked=profile.reducedMotion;return false;}}

function updateWallet(){const level=$('#level-progress'),xp=levelProgress(profile.xp);if(level)level.textContent=`LVL ${xp.level} · ${xp.earned} / ${xp.required} XP`;const wallet=$('#wallet-balance');if(wallet){wallet.hidden=!usingAccount;wallet.textContent=usingAccount?`$${profile.money||0} · ACCOUNT`:'';}}
function save() { if(usingAccount)return;try { const guest=usingAccount?guestProgress:normaliseProgress(profile);localStorage.setItem(storageKey, JSON.stringify({...profile,...guest})); } catch { /* Play remains available without storage. */ } }
function syncProfile() {
  $('#profile-name').textContent = profile.name;const avatar=$('#profile-avatar');if(avatar){avatar.innerHTML=initialAvatar(profile.name,profile.settings.avatarFont);avatar.style.backgroundColor=profile.settings.avatarColor;avatar.dataset.font=profile.settings.avatarFont;}$('.profile-button')?.setAttribute('aria-label',`${profile.name} · Account settings`);
  document.body.classList.toggle('no-motion', profile.reducedMotion);
  $$('.sound-button').forEach(button => { button.innerHTML = icon(profile.sound ? 'sound' : 'muted'); button.setAttribute('aria-label', profile.sound ? 'Mute sound' : 'Enable sound'); button.setAttribute('aria-pressed', String(profile.sound)); });
  updateWallet();save();
}
function sound(type = 'click') {
  if (!profile.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    const notes = type==='crow-chirp'?[1600,950,1850,850]:type === 'dlsi-shot' ? [65,35,22] : type==='dlsi-typing'?[940,1100,820,1200]:type==='dlsi-hum'?[90,95,100,105]:type === 'goal' ? [392, 494, 587, 784] : type === 'spin' ? [440, 554, 659] : type === 'kick' ? [100, 65] : type === 'save' ? [210, 145] : [560];
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
  const id = character.id, color = shirtOverride || ({ malicia:'#e6c756',raven:'#9d6dff',none: '#e8e9d5', manmarker: '#e6c756', ice: '#9fdde1', powershooter: '#f47b40', ninja: '#62a969', playmaker: '#69bfca', falcon: '#b8c2c9', streetdribbler: '#a778bf', magician: '#ed8aba', supersonic: '#e85d50', trapper: '#6b9ae1', serpent: '#65bd71', butterflydancer: '#ebd46d', emperor: '#608dde' }[id] || '#e8e9d5');
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
  $('#spins-count').textContent = usingAccount?`$${profile.money||0}`:'Account only';
  $('#spin-button').disabled = !usingAccount||profile.money < 35;const lucky=$('[data-action="lucky-spin"]');if(lucky)lucky.disabled=!usingAccount||profile.money<95||levelProgress(profile.xp).level<15;
  $('#spin-button').innerHTML = usingAccount?`Normal spin · $35 ${icon('arrow')}`:'Sign in to spin';
  for (const type of ['normal', 'lucky']) $(`#${type}-spin-odds`).innerHTML = SPIN_ODDS[type].map(([rarity, chance]) => `<div><i style="--rarity:${rarityColors[rarity]}"></i>${esc(rarity)}<b>${chance}%</b></div>`).join('');
  $('#character-skill-list').innerHTML = renderPlaybook(character)+variantPanel(character);
  $('#roster-grid').innerHTML = orderedRoster.map(item => `<button class="roster-card ${item.id === selected ? 'selected' : ''} ${profile.unlocked.includes(item.id) ? '' : 'locked'}" data-action="select-character" data-character="${esc(item.id)}" style="--card-color:${rarityColors[item.rarity]}" aria-label="View ${esc(item.name)} moves${profile.unlocked.includes(item.id) ? '' : ', locked'}" aria-haspopup="dialog" aria-pressed="${item.id === selected}"><i class="card-rarity"></i>${profile.equipped === item.id ? '<span class="card-equipped">✓</span>' : profile.unlocked.includes(item.id) ? '' : '<svg class="card-lock" aria-hidden="true"><use href="#icon-lock"/></svg>'}<span class="card-art">${footballer(item, { small: true })}</span><span class="card-info"><b>${esc(item.name).toUpperCase()}</b><small>${esc(item.rarity)} · View moves ↗</small></span></button>`).join('');
}


function renderPlaybook(character) {
  const move = (skill, key) => `<div class="preview-skill" title="${esc(skill.description)}"><kbd>${key}</kbd><span>${esc(skill.name)}</span><small>${skill.once ? 'ONCE' : `${skill.cooldown}s`}</small></div>`;
  const base = '<div class="preview-skill"><kbd>F</kbd><span>Ultrashot<small>On-target shots that force a save or score add charge. After 3 qualifying shots, hold F and release for a boosted Curve Shot or Quick Shot.</small></span></div>';
  const skills = character.skills.length ? character.skills.map((skill, index) => move(skill, index + 1)).join('') : '<p class="empty-skills">A clean slate. Master movement, shooting, and the art of a perfect tackle.</p>';
  const passive = character.passive ? `<div class="preview-skill passive-preview" title="${esc(character.passive.description)}"><kbd>✦</kbd><span>${esc(character.passive.name)}<small>${esc(character.passive.description)}</small></span></div>` : '';
  const awakeWithBall = getSkills({character: character.id, ability: {}}, true, true);
  const alternateMoves = getSkills({character: character.id, ability: {}}, true, false).map((skill, index) => ({skill, index})).filter(({skill, index}) => skill.name !== awakeWithBall[index]?.name);
  const awakened = character.awakening ? `<details class="awakening-preview"><summary><kbd>E</kbd><span>${esc(character.awakening.name)}</span><small>${character.awakening.duration}s</small></summary><p>${esc(character.awakening.description)}</p>${awakeWithBall.map((skill, index) => move(skill, index + 1)).join('')}${alternateMoves.length ? '<p>Without the ball:</p>' + alternateMoves.map(({skill, index}) => move(skill, index + 1)).join('') : ''}</details>` : '';
  return skills + base + passive + awakened + '<button class="button outline playbook-guide-button" data-action="character-guide" aria-haspopup="dialog">See what every move does ↗</button>';
}

function guideVariants(character, awakened = false, ability = {}, previewDlsi=false) {
  const player = { character: character.id,dlsi:previewDlsi?{moves:moveQuests(character.id).map(()=>true),awakening:true}:selectedVariants(profile,character.id),overtimeAwakening:previewDlsi,awakened,awakeningLeft:awakened?1:0, ability: ['emperor', 'magician'].includes(character.id) ? { chemicalPartnerId: -1, ...ability } : ability };
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
  const dlSkills=QUESTS[character.id]?[...guideVariants(character,false,{},true),...guideVariants(character,true,{dlChemicalAvailable:true,dlOpponentEmperorPresent:true},true),...guideVariants(character,false,{dlCalculated:1,dlLefty:0,dlFade:1,dlAccel:1,dlBlast:1,dlAssist:2},true),...guideVariants(character,false,{dlLefty:1,dlAccel:2},true)].filter((s,i,list)=>list.findIndex(t=>t.name===s.name)===i):[];
  const awakening = character.awakening;
  const awakeningRequirement = awakening?.requires === 'on-ball' ? 'Activate with the ball.' : awakening?.requires === 'off-ball' ? 'Activate without the ball.' : 'Activate with or without the ball.';
  openModal(`<div class="character-guide"><div class="character-guide-heading"><div class="guide-portrait" aria-hidden="true">${footballer(character, { small: true })}</div><div><span class="modal-eyebrow">THE PLAYBOOK / MOVE GUIDE</span><h2 class="modal-title" id="modal-title" tabindex="-1" autofocus>${esc(character.name)}</h2><span class="guide-rarity">${esc(character.rarity)}</span></div></div><p class="modal-description">${esc(character.description)}</p>${unlocked ? '' : '<p class="guide-note">You can explore every move before unlocking this character.</p>'}<section class="guide-section"><h3>Moves</h3><div class="guide-moves">${moves.length ? moveCards(moves) : '<p class="modal-description">Characterless has no special moves. Use movement, tackle / dribble, and Ultrashot to play.</p>'}</div></section>${followups.length ? `<section class="guide-section"><h3>Unlocked follow-ups</h3><p class="guide-note">Use the same move key again when its follow-up appears.</p><div class="guide-moves">${moveCards(followups)}</div></section>` : ''}<section class="guide-section guide-ultrashot"><h3>Ultrashot · every character</h3><p>Only on-target shots that force a save or score add Ultrashot charge. Passes, misses, own goals and automatic-goal specials do not count. After 3 qualifying shots, hold F or the Ultrashot button and release for a boosted Curve Shot or Quick Shot. Normal mouse shots keep your earned charge until you choose to use it. Long shots can miss, and keepers can still save it.</p></section>${character.passive ? `<section class="guide-section guide-passive"><h3>Passive · ${esc(character.passive.name)}</h3><p>${esc(character.passive.description)}</p></section>` : ''}${awakening ? `<section class="guide-section guide-awakening"><h3>Awakening · ${esc(awakening.name)}</h3><p>Press E when ready. ${awakeningRequirement} Lasts ${awakening.duration} seconds.</p><p>${esc(awakening.description)}</p><div class="guide-moves">${moveCards(awakened)}</div></section>` : '<p class="guide-note">This character has no awakening.</p>'}${dlSkills.length?`<section class="guide-section"><h3>Destruction League I variants</h3><p>Preview every unlock. Each quest unlocks its own move; 300 league points unlock the awakening. Enable unlocked variants in the character menu.</p>${moveCards(dlSkills)}</section>`:''}<p class="guide-note">Moves that need a teammate are unavailable in 1v1.</p><footer class="guide-actions">${unlocked && profile.equipped !== character.id ? `<button class="button primary" data-action="equip-reveal" data-character="${esc(character.id)}">Equip ${esc(character.name)} ${icon('check')}</button>` : ''}<button class="button outline" data-action="close-modal">Back to characters</button></footer></div>`, true);
  previousFocus = $(`.roster-card[data-character="${character.id}"]`);
}

function matchModal() {
  queueFormat = null;
  const option = (format, action, badge) => `<button class="opponent-option" data-action="${action}" data-format="${format}"><span class="opponent-icon">${badge}</span><span><strong>${GAME_FORMATS[format].name}</strong><small>${GAME_FORMATS[format].detail}</small></span>${icon('arrow')}</button>`;
  openModal(`<span class="modal-eyebrow">CHOOSE YOUR MATCH</span><h2 class="modal-title" id="modal-title">THE PITCH<br>IS YOURS.</h2><p class="modal-description">Play instantly against bots, find an online match, or build your own teams.</p><section class="match-section" aria-labelledby="offline-matches"><h3 id="offline-matches">Offline <span>PLAY INSTANTLY</span></h3>${Object.entries(MATCH_RULES).filter(([id])=>id.startsWith('bot-')&&id!=='bot-team').map(([id,r])=>option(id,'play-bot',`${r.size}v${r.size}`)).join('')}</section><section class="match-section" aria-labelledby="online-matches"><h3 id="online-matches">Online <span>PLAY WITH PEOPLE</span></h3>${ONLINE_FORMATS.map(id=>option(id,'queue-online',`${MATCH_RULES[id].size}v${MATCH_RULES[id].size}`)).join('')}<button class="opponent-option" data-action="online"><span class="opponent-icon">＋</span><span><strong>Create a room</strong><small>Customize human and bot teams, match length, and the goal target.</small></span>${icon('arrow')}</button><button class="button outline full-button" data-action="join-online">Join a room with a code ${icon('arrow')}</button></section><p class="modal-footnote">Playing as ${esc(profile.name)} · ${esc(characterOf(profile.equipped).name)}<br>Every team has an AI goalkeeper.</p>`);
}
const PROBLEM_REPORT_URL='https://pixel-pulse-websites.vercel.app/report?site=rematch-rush';
function reportProblemControl(){return `<a class="button outline full-button report-problem-link" href="${PROBLEM_REPORT_URL}" target="_blank" rel="noopener noreferrer">Report a problem ↗</a>`;}
function helpModal() {
  openModal(`<span class="modal-eyebrow">THE BASICS / A LITTLE KNOW-HOW</span><h2 class="modal-title" id="modal-title">LET YOUR FEET<br>DO THE TALKING.</h2><p class="modal-description">First to the ball. Last to give up. Outscore your opponent before the five-minute whistle.</p><div class="controls-grid"><div class="control-row"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span><strong>Move around the pitch</strong><small>Arrow keys work too. Carrying the ball slows you 20%.</small></span></div><div class="control-row"><span><kbd>⌖</kbd></span><span><strong>Aim with your mouse</strong><small>Point at the pitch to choose your shot direction. Optional Ctrl lock keeps the pointer in the game; Ctrl or Escape releases it. Long shots have more spread and can miss the goal.</small></span></div><div class="control-row"><span><kbd>CLICK</kbd></span><span><strong>Normal shot</strong><small>Hold the left mouse button or Shoot button to charge, then release. Power starts at 5 and rises by 36 each second, including fractional seconds. Only on-target shots that force a save or score add Ultrashot charge. Normal shots never spend it.</small></span></div><div class="control-row"><span><kbd>F</kbd></span><span><strong>Ultrashot · 3 on-target shots</strong><small>When all 3 soccer balls are filled, hold F or the Ultrashot button, then release. This spends the charge on a Curve Shot or Quick Shot. An empty attempt adds no charge.</small></span></div><div class="control-row"><span><kbd>C</kbd></span><span><strong>Tackle or dribble</strong><small>Off-ball: slide to steal. On-ball: evade a tackle. Dribble recovers in ${ACTION_COOLDOWNS.dribble}s; tackle takes ${ACTION_COOLDOWNS.tackle}s.</small></span></div><div class="control-row"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><kbd>5</kbd></span><span><strong>Character abilities</strong><small>Unlock a character to bring their moves to the pitch. Emperor’s chemical reaction moves to key 5 during awakening.</small></span></div><div class="control-row"><span><kbd>Q</kbd></span><span><strong>Pass to your teammate</strong><small>Use Q in team modes. Passing does not charge Ultrashot. Ground passes can be intercepted.</small></span></div><div class="control-row"><span><kbd>X</kbd></span><span><strong>Enter Flow</strong><small>Equip a Flow in the Flows tab. Activate at 20% or more; duration is half the meter in seconds. Flow cannot be cancelled.</small></span></div><div class="control-row"><span><kbd>E</kbd></span><span><strong>Awaken your full potential</strong><small>Charges in 100 seconds. Some styles need possession.</small></span></div></div><p class="help-detail"><b>Pick your shooting spot.</b> Close, well-aimed shots are stronger chances. Normal and Ultra shots can still be saved. Earned instant-goal specials are the exceptions. Very distant shots and shots toward your own goal are unlikely to score.<br><b>Play the rebound.</b> The ball stays in play and bounces off the walls. Max-power shots and goalkeeper throws travel through the air. Dribble into a tackle to stun your rival. Teammate passing abilities require a team mode; trying them in 1v1 never spends their cooldown. Replays show up to the last 25 seconds, including cinematics, at 2× speed. Press R to vote to skip; all human players must agree. Bots agree automatically. After online matches, everyone can choose Rematch in the same room.<br><b>On touch screens:</b> use the direction pad and action buttons. Drag on the pitch to aim.</p>${reportProblemControl()}<button class="button primary full-button" data-action="close-modal">Got it. Game on. ${icon('arrow')}</button>`, true);
}
function pixelLinkControl(){return `${usingAccount?'<button class="button outline full-button" data-action="account-logout">Log out</button>':''}<button class="button outline full-button" data-action="pixel-link">Link account to Pixel Pulse <small>Highly recommended</small></button><p class="modal-footnote">${usingAccount?'Connected through Pixel Pulse. Your account progress stays with this account.':'Rematch uses Pixel Pulse accounts. Device progress stays separate; linking never imports it automatically.'}</p>`;}
function profileModal() {
 const prefs=accountSettings({...profile.settings,name:profile.name,sound:profile.sound,reducedMotion:profile.reducedMotion});
 openModal(`<span class="modal-eyebrow">${usingAccount?'YOUR ACCOUNT':'DEVICE PLAYER'}</span><h2 class="modal-title" id="modal-title">ACCOUNT SETTINGS</h2><form id="profile-form"><label class="field-label" for="username-input">Player name</label><input id="username-input" class="text-input" name="username" maxlength="18" value="${esc(profile.name)}" required autofocus autocomplete="nickname"><label class="field-label" for="avatar-color">Circle color</label><select class="text-input" id="avatar-color">${AVATAR_COLORS.map((color,i)=>`<option value="${color}"${color===prefs.avatarColor?' selected':''}>${['Gray','Green','Blue','Purple','Orange','Gold'][i]}</option>`).join('')}</select><label class="field-label" for="avatar-font">Initial font</label><select class="text-input" id="avatar-font">${AVATAR_FONTS.map(font=>`<option value="${font}"${font===prefs.avatarFont?' selected':''}>${font}</option>`).join('')}</select><button class="button primary" type="submit">${usingAccount?'Save to account':'Save on this device'} ${icon('check')}</button></form>${pixelLinkControl()}`);
}

function settingsModal() {
  openModal(`<span class="modal-eyebrow">OFF THE PITCH / PREFERENCES</span><h2 class="modal-title" id="modal-title">YOUR GAME.<br>YOUR RULES.</h2><p class="modal-description">Settle in before you settle the score.</p><div class="settings-row"><div><strong>Match sounds</strong><small>Kicks, saves, goals, and interface sounds.</small></div><label class="toggle"><input id="sound-setting" type="checkbox" ${profile.sound ? 'checked' : ''} aria-label="Match sounds"><span></span></label></div><div class="settings-row"><div><strong>Reduced interface motion</strong><small>Keep menu transitions and spin effects simple.</small></div><label class="toggle"><input id="motion-setting" type="checkbox" ${profile.reducedMotion ? 'checked' : ''} aria-label="Reduced interface motion"><span></span></label></div><button class="button outline full-button" data-action="help">View controls & playbook ${icon('arrow')}</button>${pixelLinkControl()}${reportProblemControl()}<p class="modal-footnote">${usingAccount?'Progress and preferences save to your authenticated account.':'Guest progress and preferences are saved only on this device.'}</p>`);
}

function customRoomControls() {
 const select=(id,options,value,disabled=false)=>`<select id="${id}" class="text-input"${disabled?' disabled':''}>${options.map(([key,label])=>`<option value="${key}"${String(key)===String(value)?' selected':''}>${esc(label)}</option>`).join('')}</select>`;
 const slot=(id,label)=>`<label class="team-slot">${label}${id===0?`<strong>You · ${esc(profile.name)}</strong>`:select(`room-slot-${id}`,[['human','Friend'],['bot','Bot'],['empty','Empty']],customConfig.slots[id]||'empty')}${customConfig.slots[id]==='bot'?select(`room-bot-${id}`,[['','Automatic · balanced rarity'],...orderedRoster.map(c=>[c.id,c.name])],customConfig.botCharacters?.[id]||''):''}</label>`;
 return `<div class="custom-teams"><fieldset><legend>Blue team</legend>${slot(0,'Player 1')}${slot(2,'Player 2')}${slot(4,'Player 3')}</fieldset><fieldset><legend>Red team</legend>${slot(1,'Player 1')}${slot(3,'Player 2')}${slot(5,'Player 3')}</fieldset></div><div class="custom-settings"><label>Rules${select('room-variant',[['standard','Standard'],['raw','Raw Skill'],['penalties','Penalties']],customConfig.variant||'standard')}</label><label>Match length${select('room-duration',[[120,'2 minutes'],[180,'3 minutes'],[300,'5 minutes'],[600,'10 minutes']],customConfig.variant==='raw'?180:customConfig.duration,customConfig.variant==='raw')}</label><label>Goal target${select('room-score-limit',[[0,'No goal target'],[3,'First to 3'],[5,'First to 5'],[10,'First to 10']],customConfig.scoreLimit,customConfig.variant&&customConfig.variant!=='standard')}</label></div><p id="custom-room-summary" class="guide-note">${customConfig.slots.some((k,id)=>id%2===1&&k!=='empty')?customRoomSummary():'Add a friend or bot to the red team.'}</p><p class="guide-note">Up to three per side. Penalties allows one per side. Raw Skill is characterless and always three minutes.</p><button class="button primary full-button" data-action="create-room" id="create-room-button"${customConfig.slots.some((k,id)=>id%2===1&&k!=='empty')?'':' disabled'}>Create custom room ↗</button>`;
}

function customRoomSummary() {
  const describe = team => customConfig.slots.map((kind, id) => ({kind, id})).filter(item => item.id % 2 === team && item.kind !== 'empty').map(item => item.id === 0 ? 'You' : item.kind === 'bot' ? 'Bot' : 'Friend').join(' + ') || 'Empty team';
  return `${describe(0)} vs ${describe(1)} · ${customConfig.duration / 60} minutes${customConfig.scoreLimit ? ` · First to ${customConfig.scoreLimit}` : ''}`;
}
function onlineModal(tab = 'create') {
  roomLobby = null; queueFormat = null; onlineFormat = 'custom';
  openModal(`<span class="modal-eyebrow">ONLINE / CUSTOM ROOMS</span><h2 class="modal-title" id="modal-title">YOUR ROOM.<br>YOUR RULES.</h2><p class="modal-description">Choose your teams and share a 4-character code. For public matchmaking, choose a queue in Online.</p><div class="modal-tabs"><button class="modal-tab ${tab === 'create' ? 'active' : ''}" data-action="online-create-tab">Create a room</button><button class="modal-tab ${tab === 'join' ? 'active' : ''}" data-action="online-join-tab">Join a room</button></div><div id="online-panel">${tab === 'create' ? customRoomControls() : `<form id="join-form"><label class="field-label" for="room-code-input">Room code</label><input class="text-input" id="room-code-input" name="code" placeholder="A7B2" maxlength="4" minlength="4" pattern="[A-Za-z0-9]{4}" autocomplete="off" autocapitalize="characters" spellcheck="false" required autofocus><button class="button primary" type="submit" id="join-room-button">Join room ${icon('arrow')}</button></form>`}</div><div id="room-lobby" class="room-lobby" aria-live="polite"></div><div class="room-status" id="room-status" role="status"><span class="live-dot"></span><span>Keep this page open while your friends join.</span></div>`);
}
function renderRoomLobby(lobby) {
  roomLobby = lobby;
  const element = $('#room-lobby'); if (!element || !lobby) return;
  const queued = queueFormat !== null;
  element.innerHTML = `<b>${GAME_FORMATS[lobby.gameFormat]?.name || 'Online match'} · ${lobby.connectedHumans} / ${lobby.requiredHumans} players</b><div class="lobby-players">${(lobby.players || []).map(player => `<div data-team="${player.team}"><span>${player.team === 0 ? 'BLUE' : 'RED'}${player.isBot ? ' · BOT' : ''}</span><strong>${esc(player.name)}</strong><small>${esc(characterOf(player.character).name)}</small></div>`).join('')}</div><p>${lobby.connectedHumans < lobby.requiredHumans ? queued ? 'Searching for more players. You can cancel at any time.' : 'Waiting for the rest of the players. Share this room code with your friends.' : 'Everyone is here. Starting the match…'}</p>${lobby.settings ? `<p>${Math.round(lobby.settings.duration / 60)} minutes${lobby.settings.scoreLimit ? ` · First to ${lobby.settings.scoreLimit}` : ''}</p>` : ''}`;
}
async function startQueue(format) {
  if (!ONLINE_FORMATS.includes(format)) return;
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
    onState(state, acknowledge) { if (online === session && game && session.role === 'guest') return game.receiveState(state, acknowledge); },
    onDisconnect(event) {
      if (online !== session) return;
      if (currentScreen === 'game') {
        game?.stop();if(game)void settleRound({score:game.state.score,players:game.state.players},{opponentAbandoned:true});
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
  session.selectedFlow=profile.flow;session.selectedVariants=selectedVariants(profile,profile.equipped);online = session;
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
async function spin(lucky = false) {
  if (spinning) return;if(!usingAccount){toast('Sign in to earn and spend game money.');return;}let purchase;spinning=true;
  try {purchase=await gameAccount.mutate('spin',{type:lucky?'lucky':'normal'});}
  catch(e){spinning=false;toast(e.message);return;}
  const result=characterOf(purchase.id),duplicate=purchase.duplicate;updateWallet();renderCharacters();
  openModal(`<div class="spin-reveal"><span class="modal-eyebrow">A NEW POSSIBILITY / LET IT ROLL</span><h2 class="modal-title" id="modal-title">FIND YOUR<br>GAME CHANGER.</h2><div class="spin-reel"><div id="spin-reel-name">MANMARKER</div><p>${lucky ? 'LUCKY SPIN · RARE OR BETTER' : 'NORMAL SPIN · EVERY STYLE POSSIBLE'}</p></div></div>`);
  spinning = true;
  $('#modal .modal-close').disabled = true;
  let tick = 0;
  const reveal = () => {
    clearInterval(spinTimer); spinTimer = null; spinning = false;
    $('#modal .modal-close').disabled = false;
    selected = result.id; renderCharacters(); sound('spin');
    $('#modal-content').innerHTML = `<div class="spin-reveal" style="--reveal-color:${rarityColors[result.rarity]}40"><span class="modal-eyebrow">${duplicate ? 'A FAMILIAR FACE / ALREADY UNLOCKED' : 'NEW CHARACTER / A NEW WAY TO PLAY'}</span><h2 class="modal-title" id="modal-title">${esc(result.name).toUpperCase()}</h2><span class="rarity-tag" style="color:${rarityColors[result.rarity]};background:${rarityColors[result.rarity]}20">${esc(result.rarity).toUpperCase()}</span><div class="reveal-art">${footballer(result)}</div><p class="modal-description">${esc(result.tip)}<br>${usingAccount?`$${profile.money} remaining`:'Sign in to use game money'}${duplicate ? ' · Duplicate character' : ''}</p><div class="spin-result-actions">${usingAccount&&profile.money >= (lucky?95:35) ? `<button class="button primary" data-action="spin-again" data-spin="${lucky ? 'lucky' : 'normal'}">Spin again ${icon('arrow')}</button>` : ''}<button class="button outline" data-action="equip-reveal" data-character="${esc(result.id)}">Equip ${esc(result.name)} ${icon('check')}</button></div><button class="text-button" style="margin:7px auto 0" data-action="close-modal">Back to the roster</button></div>`;
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

async function startMatch(mode = 'bot', connection = null) {
  if(gameAccount.current?.banned){banModal();return;}
  if(gameAccount.pending){toast('Resolve your pending account operation before another match.');return;}
  if (mode === 'bot') closeOnline();
  closeModal({ keepOnline: true, resume: false });
  game?.stop(); gameMode = mode; localTeam = connection?.localTeam || 0; localPlayerId = connection?.localPlayerId ?? localTeam; hudSignature = null; lastNetworkState = 0; lastState = null;
  showScreen('game');
  const character = characterOf(profile.equipped), remote = connection?.remoteProfile;
  $('#hud-character').textContent = character.name.toUpperCase(); $('#hud-name').textContent = profile.name;
  $('#hud-rarity').textContent = character.rarity.toUpperCase(); $('#hud-rarity').style.color = rarityColors[character.rarity]; $('#hud-rarity').style.background = `${rarityColors[character.rarity]}25`;
  const format = connection?.gameFormat || (mode === 'bot' ? offlineFormat : 'standard-1v1');
  const rule=rulesFor(format,connection?.settings||{});roundReceipt={id:crypto.randomUUID(),character:['raw','penalties','penalty-practice'].includes(rule.variant)?'none':profile.equipped,format,settled:false,account:usingAccount};

  const teamMatch = connection?.players ? connection.players.filter(player => player.team === localTeam).length > 1 : rule.size>1;
  $('#blue-name').textContent = localTeam === 0 ? teamMatch ? 'YOUR TEAM' : 'YOU' : 'RIVALS'; $('#red-name').textContent = localTeam === 1 ? teamMatch ? 'YOUR TEAM' : 'YOU' : mode === 'bot' || format === 'bot-team' ? 'RIVAL AI' : 'RIVALS';
  $('#phase-banner').hidden = true; $('#cutscene-caption').hidden = true; $('#replay-label').hidden = true;
  $('#skip-replay').hidden = true;
  $('#awakening-status').hidden = true; $('#awakening-announcement').hidden = true;
  const seed=connection?.seed||crypto.randomUUID().replaceAll('-','');
  game = new Game($('#game-canvas'), {
    mode,seed,recordAudit:mode!=='guest',dlsi:selectedVariants(profile,profile.equipped),flow:profile.flow, gameFormat: format, players: connection?.players, settings: connection?.settings, character: profile.equipped, username: profile.name, localTeam, localPlayerId,
    opponentCharacter: remote?.character,botCharacters:offlineBots,
    opponentUsername: remote?.username || 'RIVAL AI',
    onState: updateHUD,
    onInput(input) { if (mode === 'guest') online?.sendInput(input); },
    onEvent(event) { if (['kick', 'goal', 'save','dlsi-shot','dlsi-typing','dlsi-hum','crow-chirp'].includes(event.type)) sound(event.type); },
    onEnd: matchEnded,
  });
  if(usingAccount){try{const players=game.state.players.map(p=>({id:p.id,team:p.team,character:p.character,name:p.name,isBot:p.isBot,dlsi:p.dlsi,flow:p.flow}));await gameAccount.mutate('start',{matchId:roundReceipt.id,engine:game.engineVersion,format,settings:connection?.settings||{},character:roundReceipt.character,seed,players,localPlayerId});}catch(e){toast(e.message);showScreen('home');return;}}
  game.start(); $('#game-canvas').focus(); updateHUD(game.getState());
}

function skillRequirement(player, slot, hasBall) {
  const id = characterOf(player.character).id, awakened = player.awakened;
  const teamAvailable = lastState?.players?.some(other => other.id !== player.id && other.team === player.team);
  const teamOnly = teamAvailable ? 'Needs a teammate' : 'Team mode only';
  if(id==='malicia')return slot===0?teamOnly:slot===1?hasBall?'Needs the ball':'Off ball · face the ball':'Opponent carries';if(id==='raven')return slot===0?'Needs the ball':slot===1?awakened?'Airborne ball':'Any time':'Needs the ball';
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
  const cursorButton=$('#cursor-lock-button'),cursorLocked=!!game?.isCursorLocked?.();
  cursorButton.textContent=cursorLocked?'UNLOCK':'CTRL LOCK';cursorButton.setAttribute('aria-pressed',String(cursorLocked));cursorButton.setAttribute('aria-label',cursorLocked?'Unlock cursor (Ctrl or Escape)':'Lock cursor (Ctrl)');

  if (!game || currentScreen !== 'game') return;
  lastState = state;
  if (online?.role === 'host' && performance.now() - lastNetworkState >= 48) { lastNetworkState = performance.now(); online.sendState(game.exportState()); }
  $('#blue-score').textContent = state.score?.[0] || 0; $('#red-score').textContent = state.score?.[1] || 0;
  const seconds = Math.max(0, Math.ceil(state.time || 0)); $('#match-time').textContent = state.penalty?(state.penalty.phase==='tiebreak'?'SUDDEN DEATH':`PK ${Math.min(state.penalty.max,(state.penalty.attempts[state.penalty.turnTeam]||0)+1)}/${state.penalty.max}`):state.overtime?'OT':`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  updateAwakeningStatus(state);
  const player = state.players?.find(item => item.id === localPlayerId); if (!player) return;
  const reactionNotice = $('#chemical-notice');
  reactionNotice.hidden = !((player.ability?.reactionReady > 0 || player.ability?.reactionPromptLeft > 0) && player.ability?.reactionPrompt);
  reactionNotice.textContent = reactionNotice.hidden ? '' : player.ability.reactionPrompt;
  const character = characterOf(player.character), owner = typeof state.ball?.owner === 'object' ? state.ball.owner?.id : state.ball?.owner;
  const hasBall = owner === player.id;
  const matchXp=$('#match-xp');if(matchXp)matchXp.textContent=`+${Math.floor((player.stats?.xp||0)+1e-6)} MATCH XP`;const xpHud=$('#hud-xp');if(xpHud)xpHud.textContent=`+${Math.floor((player.stats?.xp||0)+1e-6)} MATCH XP`;
  const shotMeter = game?.shotMeter?.(player);
  const power = Math.max(5, Math.min(100, Math.round(shotMeter?.power ?? player.charge ?? 5)));
  $('#charge-value').textContent = `${power} / 100`; $('#charge-fill').style.width = `${power}%`;
  $('.shot-charge').classList.toggle('is-charging', !!player.charging || !!player.shotWindup);
  const skills = getSkills(player, player.awakened, hasBall);
  const signature = `${character.id}:${skills.map((skill, index) => `${skill.name}:${skill.used}:${skillRequirement(player, index, hasBall)}`).join('|')}`;
  if (signature !== hudSignature) {
    hudSignature = signature;
    const universalShot = `<button class="ability-button universal-shot-button" data-action="ultrashot" id="ultra-shot-button" title="F: earn charge with three on-target shots that force a save or score."><kbd>F</kbd><b>Ultrashot</b><span class="ultra-cycle" aria-hidden="true"><i id="ultra-pip-1">⚽</i><i id="ultra-pip-2">⚽</i><i id="ultra-pip-3">⚽</i></span><span id="ultra-shot-status" class="sr-only"></span></button>`;
    const characterMoves = skills.length ? skills.map((skill, index) => `<button class="ability-button move-chip" data-action="use-skill" data-key="${index + 1}" title="${index + 1}: ${esc(skill.name)}. ${esc(skill.description)} ${esc(skillRequirement(player, index, hasBall))}" aria-label="${index + 1}: ${esc(skill.name)}. ${esc(skillRequirement(player, index, hasBall))}"><div class="cooldown-wipe" hidden></div><kbd>${index + 1}</kbd><b>${esc(skill.name)}</b><em hidden aria-hidden="true"></em></button>`).join('') : `<div class="ability-button empty-moves" role="status">No character abilities</div>`;
    $('#ability-list').innerHTML = characterMoves;
    $('#ultra-shot-control').innerHTML = universalShot;
  }
  const cycle = Math.max(0, Math.min(3, Math.floor(player.ultraCharge || 0)));
  const ultraReady = cycle >= 3, shotButton = $('#ultra-shot-button');
  $('#ultra-shot-status').textContent = ultraReady ? 'ULTRA READY · F' : `${3 - cycle} ON-TARGET SHOTS TO ULTRA`;
  shotButton.classList.toggle('ultra-ready', ultraReady);
  const canPlay = state.phase === undefined || state.phase === 'play';
  shotButton.disabled = !canPlay || !ultraReady;
  $('#touch-ultra-button').disabled = !canPlay || !ultraReady;
  shotButton.setAttribute('aria-label', `F: Ultrashot. ${ultraReady ? 'Ready. Hold F or this button and release to use.' : `${3 - cycle} more on-target shots to charge.`}`);
  for (let pip = 1; pip <= 3; pip++) $(`#ultra-pip-${pip}`).classList.toggle('filled', pip <= cycle);
  $$('button.ability-button:not([data-action="shoot"])', $('#ability-list')).forEach((button, index) => {
    const skill = skills[index], cooldown = skill ? skill.followup ? 0 : remainingMoveSeconds(player,player.cooldowns?.[index]||0) : hasBall ? player.dribbleCd || 0 : player.slideCd || 0, used = !!skill?.used;
    const wipe = $('.cooldown-wipe', button), number = $('em', button);
    button.classList.toggle('on-cooldown', cooldown > .05 || used); wipe.hidden = cooldown <= .05 && !used;
    wipe.style.transform = `scaleY(${used ? 1 : Math.min(1, cooldown / (skill?.cooldown || (hasBall ? ACTION_COOLDOWNS.dribble : ACTION_COOLDOWNS.tackle)))})`;
    number.hidden = cooldown <= .05 && !used; number.textContent = used ? 'USED' : `${Math.max(0, cooldown).toFixed(1)}s`;
    button.setAttribute('aria-label', `${index + 1}: ${skill.name}. ${used ? 'Used' : cooldown > .05 ? `${cooldown.toFixed(1)} seconds remaining` : skillRequirement(player, index, hasBall) || 'Ready'}`);
  });
  const flowButton=$('#flow-button'),flow=flowOf(player.flow);if(flowButton){flowButton.disabled=!canPlay||!flow||player.flowLeft>0||(player.flowMeter||0)<20;flowButton.classList.toggle('flow-active',player.flowLeft>0);$('#flow-name').textContent=flow?.name||'No Flow';$('#flow-status').textContent=player.flowLeft>0?`${player.flowLeft.toFixed(1)}s`:`${Math.floor(player.flowMeter||0)}% · needs 20%`;}
  const available = !!character.awakening, charge = Math.min(100, player.awakeningCharge || 0), active = player.awakened && player.awakeningLeft > 0;
  const awakeningButton = $('#awakening-button'); awakeningButton.classList.toggle('ready', available && charge >= 100 && !active); awakeningButton.classList.toggle('active', active);
  $('#awakening-fill').style.width = `${active ? player.awakeningLeft / (character.awakening?.duration || 45) * 100 : charge}%`;
  const requirement = character.awakening?.requires;
  const waiting = state.lastAwakeningRecipient === player.id && !active && charge < 100;
  const condition = requirement === 'off-ball' ? 'WITHOUT BALL' : requirement === 'on-ball' ? 'WITH BALL' : 'ANY TIME';
  $('#awakening-label').textContent = !available ? 'NO AWAKENING' : active ? `ACTIVE · ${player.awakeningLeft.toFixed(1)}s` : charge >= 100 ? `READY · ${condition} · E` : waiting ? 'WAITING FOR RIVAL' : `BUILDING · ${Math.floor(charge)}%`;
  awakeningButton.title = !available ? `${character.name} has no awakening.` : waiting ? 'Another player must receive awakening before you can get it again.' : `Press E ${requirement === 'off-ball' ? 'without the ball' : requirement === 'on-ball' ? 'while carrying the ball' : 'with or without the ball'} when awakening is ready.`;
  $('#game-status').textContent = state.message || '';
  updateReplayControl(state);
  // The game renderer owns celebrations, replay labels, and cutscenes so all camera effects stay synchronized.
}
function updateReplayControl(state) {
  const button = $('#skip-replay');
  const votes=state.replayVotes||[],required=state.players?.filter(p=>!p.isBot).length||1;button.disabled=votes.includes(localPlayerId);button.innerHTML=`<kbd>R</kbd> Skip replay${votes.length?` · ${votes.length}/${required}`:''}`;
  button.hidden = game?.canSkipReplay ? !game.canSkipReplay(localPlayerId) : !['celebrate', 'replay'].includes(state.phase) || (state.scorer != null ? state.scorer !== localPlayerId : state.scorerTeam !== localTeam);
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
  const score = result.score || [0, 0], player = result.players?.find(item => item.id === localPlayerId), myScore = score[localTeam], theirScore = score[1 - localTeam],won=result.winnerTeam==null?myScore>theirScore:result.winnerTeam===localTeam,lost=result.winnerTeam==null?myScore<theirScore:!won;
  openModal(`<span class="modal-eyebrow">FULL TIME / LEAVE IT ALL ON THE PITCH</span><h2 class="modal-title" id="modal-title">${result.practice?'PRACTICE<br>COMPLETE.':won ? 'THAT’S YOUR<br>GAME.' : lost ? 'EVERY RIVALRY<br>NEEDS A REMATCH.' : 'NOTHING<br>BETWEEN YOU.'}</h2><div class="result-score">${score[0]} <span style="color:#b8c4ac;font-size:50px">:</span> ${score[1]}</div><p id="match-earnings" role="status">Settling match…</p><div class="result-stats"><b>${player?.stats?.goals || 0}<small>YOUR GOALS</small></b><b>${player?.stats?.assists || 0}<small>YOUR ASSISTS</small></b></div><button class="button primary full-button" id="rematch-button" data-action="rematch">Rematch ${icon('arrow')}</button><p id="rematch-status" class="rematch-status" role="status" aria-live="polite">${gameMode === 'bot' ? 'Play another match right away.' : 'Same rival. Same room. No code needed.'}</p><button class="button outline full-button" data-action="leave">Back to menu ${icon('arrow')}</button>`);
  void settleRound(result);online?.markRoundEnded();
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
  if(roundReceipt&&!roundReceipt.settled&&game)void settleRound({score:game.state.score,players:game.state.players},{abandoned:true});
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
  if(action==='flows')void flowsModal();else if(action==='flow-spin')void spinFlow(button.dataset.type);else if(action==='equip-flow')void selectFlow(button.dataset.flow);else if(action==='flow')game?.useFlow();else if (action === 'home') { if (currentScreen !== 'game') { closeModal(); showScreen('home'); } }
  else if (action === 'characters') { closeModal(); selected = profile.equipped; showScreen('characters'); }
  else if (action === 'match') matchModal();
  else if (action === 'help' || action === 'game-help') helpModal();
  else if (action === 'settings') settingsModal();
  else if(action==='pixel-link'){closeModal();if(usingAccount)toast('This Rematch account is already linked to Pixel Pulse.');else if($('#pixel-account').hidden)toast('Pixel sign-in is unavailable right now. Your device progress is kept.');else{$('#pixel-account').scrollIntoView?.({block:'center'});$('#pixel-account-sign-in').click?.();}}
  else if(action==='account-logout'){closeModal();$('#header-sign-out')?.click?.();}
  else if (action === 'profile') profileModal();
  else if (action === 'sound') { void savePreferences({...profile.settings,sound:!profile.sound}); }
  else if (action === 'close-modal') closeModal();
  else if (action === 'select-character') { selected = button.dataset.character; renderCharacters(); characterGuide(); }
  else if (action === 'character-guide') characterGuide();
  else if (action === 'equip' || action === 'equip-reveal') {void equipStyle(button.dataset.character||selected,action==='equip-reveal');}
  else if (action === 'spin' || action === 'spin-again' || action === 'lucky-spin') spin(action === 'lucky-spin' || button.dataset.spin === 'lucky');
  else if (action === 'play-bot') { offlineFormat = button.dataset.format?.startsWith('bot-')&&MATCH_RULES[button.dataset.format]?button.dataset.format:'bot-standard'; startMatch('bot'); }
  else if (action === 'configure-bots') configureBots();
  else if (action === 'start-configured-bots') startMatch('bot');
  else if (action === 'update-log') showUpdateLog();
  else if(action==='dlsi'||action==='refresh-league')void leagueModal();
  else if(action==='admin')void adminModal();
  else if(action==='dismiss-appeal')void dismissAppeal(button.dataset.id);
  else if(action==='retry-account')void retryAccount();
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
  else if (action === 'cursor-lock') { game?.toggleCursorLock?.(); $('#game-canvas').focus(); }
  else if (action === 'fullscreen') { if (document.fullscreenElement) document.exitFullscreen?.(); else $('#game-screen').requestFullscreen?.().catch(() => toast('Fullscreen is not available in this browser.')); }
});
document.addEventListener('submit', event => {
  if(event.target.id==='admin-command-form'){event.preventDefault();void submitAdmin();return;}
  if(event.target.id==='ban-reason-form'){event.preventDefault();void submitAdmin($('#ban-command').value,$('#ban-reason').value);return;}
  if(event.target.id==='appeal-form'){event.preventDefault();void sendAppeal();return;}
  if (event.target.id === 'profile-form') { event.preventDefault(); const name = $('#username-input').value.trim().replace(/[<>]/g, '').slice(0, 18); if (!name) { $('#username-input').setCustomValidity('Choose a player name.'); $('#username-input').reportValidity(); return; } void savePreferences({...profile.settings,name,avatarColor:$('#avatar-color').value,avatarFont:$('#avatar-font').value}).then(ok=>{if(ok)closeModal();}); }
  if (event.target.id === 'join-form') { event.preventDefault(); joinRoom($('#room-code-input').value.trim()); }
});
document.addEventListener('input', event => { if (event.target.id === 'username-input') event.target.setCustomValidity(''); if (event.target.id === 'room-code-input') event.target.value = event.target.value.toUpperCase(); });
document.addEventListener('change', event => {
  if(event.target.dataset.variant){void changeVariant(event.target.dataset.variant,event.target.dataset.slot,event.target.checked);return;}
  if(event.target.id==='room-variant'){customConfig.variant=event.target.value;if(customConfig.variant==='raw')customConfig.duration=180;if(customConfig.variant==='penalties'){customConfig.slots=customConfig.slots.map((k,id)=>id<2?k:'empty');for(const id of Object.keys(customConfig.botCharacters||{}))if(customConfig.slots[id]!=='bot')delete customConfig.botCharacters[id];}customConfig.scoreLimit=0;$('#online-panel').innerHTML=customRoomControls();return;}
  if(event.target.id?.startsWith('room-bot-')){customConfig.botCharacters||={};const id=Number(event.target.id.slice(9));if(event.target.value)customConfig.botCharacters[id]=event.target.value;else delete customConfig.botCharacters[id];return;}
  if(event.target.id==='bot-mode'){offlineFormat=event.target.value;configureBots();return;}
  if(event.target.id?.startsWith('bot-character-')){const id=Number(event.target.id.slice(14));if(event.target.value)offlineBots[id]=event.target.value;else delete offlineBots[id];return;}
  if (event.target.id === 'sound-setting') { void savePreferences({...profile.settings,sound:event.target.checked}); }
  if (event.target.id === 'motion-setting') { void savePreferences({...profile.settings,reducedMotion:event.target.checked}); }
  if (/^room-slot-[12345]$/.test(event.target.id)){const id=Number(event.target.id.at(-1));customConfig.slots[id]=event.target.value;if(event.target.value!=='bot')delete customConfig.botCharacters[id];$('#online-panel').innerHTML=customRoomControls();}
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
  if ($('#modal').hidden) { if (event.key === 'Escape' && currentScreen === 'game') { event.preventDefault(); if (game?.isCursorLocked?.()) game.unlockCursor?.(); else helpModal(); } return; }
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
void gameAccount.refresh();window.addEventListener('rematch-account-changed',()=>{void gameAccount.refresh();});window.addEventListener('focus',()=>{if(currentScreen!=='game')void gameAccount.refresh();});

renderModes();

function showUpdateLog(){openModal(`<span class="modal-eyebrow">REMATCH RUSH / UPDATE LOG</span><h2 class="modal-title" id="modal-title">THE FLOW STATE</h2><div class="release-notes"><h3>Flow, XP & new styles</h3><p>Malicia and Raven join the roster. New rabona, roulette, knuckle-shot and curve-shot animations join character-specific awakening scenes. Matchmaking now recovers stalled handshakes. Twenty collectible Flows activate with X at 20% charge. Earn 1 XP per second of active play, 100 XP per goal and 50 XP per assist. XP is saved once when your match settles; replays and celebrations do not add time XP. Lucky spins unlock at level 15. Exact-goal-line curve shots now count for the correct team.</p></div><div class="release-notes"><h3>Football & presentation</h3><p>36 power per second · three times faster charging. Equal-power backward kicks. Cleaner light grass and larger controls below the field. Faster travel, shorter stuns, improved keeper throws and wide back-pass clearances.</p><h3>Matches & replays</h3><p>3v3, Raw Skill, penalties and configurable teams. Unambiguous room codes. Last 25 seconds at 2×, including cinematic moves. All players press R to skip. Tied matches enter golden-goal overtime.</p><h3>DLSI improvements</h3><p>One-second Ginga inputs. Street Dribbling Style beats defenders in live play before its knuckleball; Goal In Time has a new flow cinematic and protected charge. Supersonic’s first quest unlocks moves 1 and 2. Shared global standings show saved account points; device points remain separate.</p><h3>Your playing style</h3><p>Earn game money, buy spins, complete character quests and unlock optional Destruction League moves. Stage I lasts two weeks; the lowest five characters leave the league leaderboard after the stage.</p></div><button class="button primary full-button" data-action="close-modal">Back to the pitch</button>`,true);}

function variantPanel(character){
 const quests=moveQuests(character.id);if(!quests.length)return '';
 const unlocks=variantUnlocks(profile,character.id),data=profile.characters?.[character.id]||{},variants=selectedVariants(profile,character.id);
 return `<section class="variant-panel"><h3>Destruction League I</h3>${character.id==='supersonic'?'<p>First quest unlocks both moves 1 and 2.</p>':''}<p>${data.points||0} / 300 points for awakening</p>${quests.map(([key,target,label],i)=>`<label><input type="checkbox" data-variant="${character.id}" data-slot="${i}"${variants.moves[i]?' checked':''}${unlocks.moves[i]?'':' disabled'}><span>DLSI move ${i+1}<small>${esc(label)} · ${Math.min(target,Math.floor(data[key]||0))}/${target}</small></span></label>`).join('')}<label><input type="checkbox" data-variant="${character.id}" data-slot="awakening"${variants.awakening?' checked':''}${unlocks.awakening?'':' disabled'}><span>DLSI awakening<small>${unlocks.awakening?'Unlocked · choose either version':'Earn 300 league points'}</small></span></label></section>`;
}
async function changeVariant(character,slot,enabled){try{const key=slot==='awakening'?slot:Number(slot);if(usingAccount)await gameAccount.mutate('variant',{character,slot:key,enabled});else{Object.assign(profile,toggleVariant(profile,character,key,enabled));save();}renderCharacters();toast('Move variant updated. Applies next match.');}catch(e){toast(e.message);renderCharacters();}}
async function equipStyle(id,close){try{if(!profile.unlocked.includes(id))return;if(usingAccount)await gameAccount.mutate('equip',{character:id});else{profile.equipped=id;save();}selected=id;renderCharacters();if(close)closeModal();toast(`${characterOf(id).name} equipped.`);}catch(e){toast(e.message);}}
async function settleRound(result,{abandoned=false,opponentAbandoned=false}={}){
 const receipt=roundReceipt;if(!receipt||receipt.settled)return;receipt.settled=true;
 const p=result.players?.find(p=>p.id===localPlayerId),args={matchId:receipt.id,character:receipt.character,team:localTeam,score:result.score,stats:p?.stats||{},format:receipt.format,abandoned,opponentAbandoned};
 try{let reward;if(receipt.account){reward=await gameAccount.mutate('finish',{matchId:receipt.id,team:localTeam,score:result.score,audit:game?.audit||game?.state?.audit,stats:p?.stats||{},outcome:abandoned?'abandoned':opponentAbandoned?'opponent-left':'finished'});}else{reward=settleProgress(profile,{...args,earnMoney:false});Object.assign(profile,reward.progress);save();}updateWallet();const message=abandoned?'Match abandoned.':receipt.account?`+$${reward.money} · +${reward.points} league points · +${reward.xp||0} XP`:`+${reward.xp||0} XP on this device · Sign in to earn game money.`;const el=$('#match-earnings');if(el)el.textContent=message;else if(opponentAbandoned)toast(message);}
 catch(e){const el=$('#match-earnings');if(el){el.innerHTML=`${esc(e.message)} <button class="text-button" data-action="retry-account">Retry same operation</button>`;}else toast(e.message);}
}
async function retryAccount(){try{if(!gameAccount.pending){await gameAccount.refresh();toast(gameAccount.available?'Account refreshed.':'Account sync is unavailable; no save was confirmed.');return;}const r=await gameAccount.retry();if(r){updateWallet();const el=$('#match-earnings');if(el)el.textContent=r.money===undefined?'Account operation confirmed.':`+$${r.money} · +${r.points} league points · +${r.xp||0} XP`;toast('Account operation confirmed.');}}catch(e){toast(e.message);}}
async function leagueModal(){
 openModal('<span class="modal-eyebrow">DESTRUCTION LEAGUE / GLOBAL</span><h2 class="modal-title" id="modal-title">GLOBAL STANDINGS.</h2><p role="status" id="league-content">Loading shared standings…</p>',true);
 try{const {league}=await gameAccount.leaderboard();const el=$('#league-content');if(!el)return;const own=gameAccount.current?.profile,points=p=>Object.values(p?.characters||{}).reduce((n,c)=>n+(c.points||0),0);el.outerHTML=`<div id="league-content"><p>Stage I · ${league.ended?'Finished':'Ends '+new Date(league.endsAt).toLocaleDateString()} · shared by every signed-in player.</p><p class="league-account-note">${own?`Your account: <strong>${points(own)} saved DLSI points</strong>. Completed account matches contribute to these global style totals.`:`You are playing on this device. <strong>${points(profile)} device points</strong> stay here. Sign in at <a href="https://rematch-rush.vercel.app/">the live game</a> to earn global points; device progress is kept separate.`}</p><p>Points appear after the match result is saved. ${gameAccount.pending?'Your account has a pending save — use Retry saved operation.':''}</p><ol class="league-table">${league.rows.map(r=>`<li class="${r.eliminated?'eliminated':''}"><b>${r.rank}</b><span>${esc(characterOf(r.id).name)}${r.eliminated?' · eliminated':''}${own?`<small>You: ${own.characters?.[r.id]?.points||0}</small>`:''}</span><strong>${r.points} <small>PTS</small></strong></li>`).join('')}</ol><button class="button outline" data-action="refresh-league">Refresh global standings</button><p>Lowest five styles leave the standings at the end of the stage. All remain playable.</p></div>`;}
 catch{const el=$('#league-content');if(el)el.textContent='Global standings are unavailable. Your device quests and rewards remain saved separately.';}
}
async function adminModal(){if(!gameAccount.current?.admin){toast('Administrator access required.');return;}
 openModal(`<span class="modal-eyebrow">REMATCH / ADMINISTRATION</span><h2 class="modal-title" id="modal-title">ADMIN PANEL</h2><form id="admin-command-form"><label class="field-label" for="admin-command">Command</label><input id="admin-command" class="text-input" maxlength="500" placeholder="/query username" required autocomplete="off"><button class="button primary" type="submit">Run command</button></form><p class="guide-note">/grant, /revoke, /check character-id username · /ban minutes username · /unban, /query username · /admin, /unadmin username. Ban 0 is infinite. /unban accepts an appeal.</p><p id="admin-result" role="status"></p><h3>Ban appeals</h3><div id="admin-appeals" role="status">Loading…</div>`,true);
 try{const r=await gameAccount.mutate('appeals',{});const el=$('#admin-appeals');if(el)el.innerHTML=r.appeals.length?r.appeals.map(x=>`<article class="appeal"><h4>${esc(x.username)}</h4><p>${esc(x.message)}</p><button class="button outline" data-action="dismiss-appeal" data-id="${esc(x.id)}">Dismiss</button></article>`).join(''):'No unresolved appeals.';}catch(e){const el=$('#admin-appeals');if(el)el.textContent=e.message;}}
async function submitAdmin(command=$('#admin-command')?.value,reason){if(/^\/ban\s/.test(command||'')&&reason===undefined){openModal(`<h2 id="modal-title" class="modal-title">BAN REASON</h2><form id="ban-reason-form"><input id="ban-command" type="hidden" value="${esc(command)}"><label class="field-label" for="ban-reason">Reason shown to the player</label><textarea id="ban-reason" class="text-input" maxlength="400" required></textarea><button class="button primary" type="submit">Apply ban</button></form>`);return;}try{const r=await gameAccount.mutate('admin',{command,...(reason===undefined?{}:{reason})});toast(r.value===undefined?'Command completed.':String(r.value));await adminModal();}catch(e){toast(e.message);}}
async function dismissAppeal(appealId){try{await gameAccount.mutate('dismiss',{appealId});await adminModal();}catch(e){toast(e.message);}}
function banModal(){const b=gameAccount.current?.banned;if(!b)return;openModal(`<span class="modal-eyebrow">ACCOUNT / BAN</span><h2 id="modal-title" class="modal-title">ACCOUNT BANNED</h2><p class="modal-description">${esc(b.reason)}</p><p>${b.minutes===0?'Infinite ban':`${b.minutes} minutes remaining`}</p><form id="appeal-form"><label class="field-label" for="appeal-message">Appeal</label><textarea id="appeal-message" class="text-input" maxlength="1000" required></textarea><button class="button primary" type="submit">Submit appeal</button></form>`);}
async function sendAppeal(){try{await gameAccount.mutate('appeal',{message:$('#appeal-message').value});toast('Appeal submitted to the administrators.');closeModal();}catch(e){toast(e.message);}}

async function flowsModal(){const level=levelProgress(profile.xp).level;openModal(`<span class="modal-eyebrow">THE FLOW STATE · LEVEL ${level}</span><h2 class="modal-title" id="modal-title">FIND YOUR FLOW.</h2><p>Equipped: <strong>${esc(flowOf(profile.flow)?.name||'None')}</strong>. Press X in a match at 20% or more. Duration = meter ÷ 2 seconds. Earn 10% per ankle break, 5% per steal, 25% per assist and 45% per goal; lose 20% when stolen and 10% when ankle-broken.</p>${usingAccount?'':'<p class="account-currency-note">Sign in to earn game money and buy spins.</p><button class="button outline" data-action="pixel-link">Sign in with Pixel Pulse</button>'}<div class="flow-shop"><button class="button primary" data-action="flow-spin" data-type="normal"${!usingAccount||profile.money<26.25?' disabled':''}>Flow spin · $26.25</button><button class="button outline" data-action="flow-spin" data-type="lucky"${!usingAccount||profile.money<71.25||level<15?' disabled':''}>Lucky Flow · $71.25${level<15?' · level 15':''}</button><button class="text-button" data-action="equip-flow" data-flow="none">Unequip Flow</button></div><p>Flow spins cost 25% less than style spins. Undisputed: 0.01% normal / 0.1% lucky; other odds match styles with that space removed from the lowest rarity. Duplicate Flows remain owned.</p><div class="flow-grid">${FLOW_ROSTER.map(f=>`<article class="flow-card" style="--flow-color:${f.color}"><small>${esc(f.rarity).toUpperCase()}</small><h3>${esc(f.name)}</h3><p>${esc(f.description)}</p><button class="button outline" data-action="equip-flow" data-flow="${f.id}"${!profile.flows.includes(f.id)||profile.flow===f.id?' disabled':''}>${profile.flow===f.id?'Equipped':profile.flows.includes(f.id)?'Equip Flow':'Locked · spin to unlock'}</button></article>`).join('')}</div>`,true);}
async function spinFlow(type){if(!usingAccount){toast('Sign in to earn and spend game money.');return;}try{const r=await gameAccount.mutate('flow-spin',{type});updateWallet();await flowsModal();toast(`${flowOf(r.id).name}${r.duplicate?' · duplicate':' unlocked'} · $${profile.money} remaining`);}catch(e){toast(e.message);}}
async function selectFlow(id){try{if(usingAccount)await gameAccount.mutate('equip-flow',{flow:id});else{Object.assign(profile,equipFlow(profile,id));save();}updateWallet();await flowsModal();toast('Flow equipped. Applies next match.');}catch(e){toast(e.message);}}
