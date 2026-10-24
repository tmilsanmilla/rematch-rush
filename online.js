import { selectBotCharacter } from './bot-brain.js?v=1';

/**
 * Host-authoritative one- and two-player teams over PeerJS 1.5.5 / WebRTC.
 * PeerServer Cloud only introduces the browsers; the host owns the simulation.
 * https://peerjs.com/client/api/peer and https://peerjs.com/server/cloud
 * Direct connections can fail on restrictive networks without a TURN relay.
 */
const PROTOCOL = 'rematch-rush-v4';
const PREFIX = `${PROTOCOL}-`;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CREATE_ATTEMPTS = 6;
const FORMATS = new Set(['standard-1v1', 'standard-2v2', 'bot-team', 'custom']);
const humanSlots = (format, config) => format === 'custom' ? config.slots.flatMap((kind, id) => kind === 'human' ? [id] : []) : format === 'standard-2v2' ? [0, 1, 2, 3] : format === 'bot-team' ? [0, 2] : [0, 1];
const playerSlots = (format, config) => format === 'custom' ? config.slots.flatMap((kind, id) => kind !== 'empty' ? [id] : []) : format === 'standard-1v1' ? [0, 1] : [0, 1, 2, 3];
export function normalizeRoomConfig(value = {}) {
  const slots = value.slots === undefined ? ['human', 'human', 'bot', 'bot'] : value.slots;
  if (!Array.isArray(slots) || slots.length !== 4 || slots[0] !== 'human' || slots.some(kind => !['human', 'bot', 'empty'].includes(kind)) || !slots.some((kind, id) => id % 2 === 1 && kind !== 'empty')) throw new Error('Choose one or two players per team. The host must stay in the blue team.');
  const duration = value.duration ?? 300, scoreLimit = value.scoreLimit ?? 0;
  if (![120, 300, 600].includes(duration) || ![0, 3, 5, 10].includes(scoreLimit)) throw new Error('Choose a supported match length and goal limit.');
  return { slots: [...slots], duration, scoreLimit };
}
const randomToken = () => Array.from(globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(24)) : Array.from({ length: 24 }, () => Math.floor(Math.random() * 256)), n => n.toString(16).padStart(2, '0')).join('');
const OPEN_TIMEOUT = 15000;
const CONNECT_TIMEOUT = 22000;
const HEARTBEAT_INTERVAL = 2500;
const HEARTBEAT_TIMEOUT = 20000;
let peerLibraryPromise;

function loadPeerLibrary() {
  if (typeof globalThis.Peer === 'function') return Promise.resolve(globalThis.Peer);
  if (peerLibraryPromise) return peerLibraryPromise;
  peerLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => finish(new Error('The online library did not load. Refresh and try again.')), OPEN_TIMEOUT);
    const finish = (error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        peerLibraryPromise = null;
        reject(error);
      } else resolve(globalThis.Peer);
    };
    script.src = new URL('./vendor/peerjs.min.js', import.meta.url).href;
    script.async = true;
    script.onload = () => finish(typeof globalThis.Peer === 'function' ? null : new Error('The online library could not start. Refresh and try again.'));
    script.onerror = () => finish(new Error('The online library could not load. Refresh and try again.'));
    document.head.appendChild(script);
  });
  return peerLibraryPromise;
}

function profile(username, character) {
  return {
    username: String(username || 'Player').trim().slice(0, 24) || 'Player',
    character: String(character || 'none').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'none',
  };
}

function randomCode() {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, value => ALPHABET[value % ALPHABET.length]).join('');
}

function parseCode(value) {
  const raw = String(value || '').trim().replace(new RegExp(`^${PREFIX}`, 'i'), '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(raw)) throw new Error('Enter a 4-letter or number room code, like AB12.');
  return raw;
}

function displayCode(code) { return code; }

// Copy every input event separately. In particular, never coalesce key releases
// or skills into the next frame: a press and release may share a render frame.
function normalizeInput(input) {
  if (!input || typeof input !== 'object') return null;
  const keys = input.keys || input;
  const normalized = {
    keys: { w: !!keys.w, a: !!keys.a, s: !!keys.s, d: !!keys.d },
    shootHeld: !!input.shootHeld,
    shootRelease: !!input.shootRelease,
    cancelShot: !!input.cancelShot,
    ultraShot: !!input.ultraShot,
    action: !!input.action,
    pass: !!input.pass,
    skill: Number.isInteger(input.skill) && input.skill >= 0 && input.skill <= 9 ? input.skill : null,
    awaken: !!input.awaken,
    skipReplay: !!input.skipReplay,
  };
  if (input.aim && Number.isFinite(input.aim.x) && Number.isFinite(input.aim.y)) {
    normalized.aim = { x: Math.max(-100000, Math.min(100000, input.aim.x)), y: Math.max(-100000, Math.min(100000, input.aim.y)) };
  }
  return normalized;
}

function peerError(error) {
  const messages = {
    'peer-unavailable': 'That room is unavailable. Check the code and ask the host to keep their room open.',
    'unavailable-id': 'That room code is already in use. Create a new room.',
    'browser-incompatible': 'This browser does not support online play. Use a current Chrome, Firefox, Edge, or Safari.',
    'network': 'The room service could not be reached. Check your internet connection and try again.',
    'server-error': 'The room service is unavailable. Try again in a moment.',
    'socket-error': 'The room service connection failed. Check your internet connection and try again.',
    'socket-closed': 'The room service connection closed. Create or join a new room.',
    'webrtc': 'A direct connection could not be made. Try a different network; some school, work, or mobile networks block peer-to-peer play.',
  };
  return new Error(messages[error?.type] || error?.message || 'Online connection failed. Please try again.');
}

// A transient rendezvous elects one waiting browser as queue coordinator. Its
// peer is separate from the actual match peer, so freeing a full queue never
// closes a running game. No fake opponent or code-entry fallback is inserted.
const QUEUE_PROTOCOL = `${PROTOCOL}-queue`;
class MatchmakingQueue {
  constructor({ onProgress, onAbort }) {
    Object.assign(this, { onProgress, onAbort, records: new Map(), epoch: 0, closed: false, assigned: false, settled: false, completed: false });
  }

  async enter(format, roomCode, admissionToken) {
    this.format = format;
    this.required = humanSlots(format).length;
    this.roomCode = roomCode;
    this.admissionToken = admissionToken;
    this.queueId = `${QUEUE_PROTOCOL}-${format}`;
    this.Peer = await loadPeerLibrary();
    if (this.closed) throw new Error('Matchmaking was canceled.');
    return new Promise((resolve, reject) => {
      this.resolve = resolve; this.reject = reject;
      this.onProgress(1);
      this._claim();
    });
  }

  _claim() { this._open(this.queueId, true); }

  _open(id, claiming) {
    if (this.closed || this.assigned) return;
    const epoch = ++this.epoch;
    this._clearTransport();
    const peer = this.peer = new this.Peer(id, { secure: true, debug: 0 });
    const current = () => !this.closed && this.epoch === epoch && this.peer === peer;
    let opened = false;
    this.openTimer = setTimeout(() => { if (current()) this._abort(new Error('Matchmaking could not reach the room service. Please try again.')); }, OPEN_TIMEOUT);
    peer.on('open', () => {
      if (!current()) return;
      opened = true; clearTimeout(this.openTimer);
      this.leader = claiming;
      if (claiming) { this.onProgress(1); this._heartbeat(); }
      else {
        try { this._attach(peer.connect(this.queueId, { label: QUEUE_PROTOCOL, serialization: 'binary', reliable: true, metadata: { protocol: QUEUE_PROTOCOL, format: this.format } }), false); }
        catch (_) { this._retry(); }
      }
    });
    peer.on('connection', connection => {
      if (!current()) { connection.close(); return; }
      if (!this.leader || this.records.size >= this.required + 2 || connection.metadata?.protocol !== QUEUE_PROTOCOL || connection.metadata?.format !== this.format) { if (connection.open) connection.close(); else connection.on('open', () => connection.close()); return; }
      this._attach(connection, true);
    });
    peer.on('error', error => {
      if (!current()) return;
      if (!opened && claiming && error?.type === 'unavailable-id') { this._open(undefined, false); return; }
      if (['peer-unavailable', 'unavailable-id'].includes(error?.type)) { this._retry(); return; }
      this._abort(peerError(error));
    });
    peer.on('close', () => { if (current()) this._retry(); });
    peer.on('disconnected', () => { if (current()) this._retry(); });
  }

  _attach(connection, incoming) {
    const epoch = this.epoch, record = { connection, joined: false, ack: false, lastReceived: Date.now() };
    this.records.set(connection, record);
    const current = () => !this.closed && epoch === this.epoch && this.records.get(connection) === record;
    connection.on('open', () => {
      if (!current()) return;
      if (incoming && this.assigned) { this._send(connection, { type: 'retry' }); return; }
      if (!incoming) this._send(connection, { type: 'join' });
      this._heartbeat();
    });
    connection.on('data', data => {
      if (!current() || !data || data.protocol !== QUEUE_PROTOCOL || data.format !== this.format) return;
      record.lastReceived = Date.now();
      if (data.type === 'ping') { this._send(connection, { type: 'pong' }); return; }
      if (data.type === 'pong') return;
      if (incoming) {
        if (data.type === 'cancel') { this._drop(record); return; }
        if (data.type === 'ack' && this.assigned && data.roomCode === this.roomCode && data.admissionToken === this.admissionToken) {
          record.ack = true;
          if ([...this.records.values()].filter(item => item.joined).every(item => item.ack)) this._resolve({ roomCode: this.roomCode, admissionToken: this.admissionToken });
          return;
        }
        if (data.type !== 'join' || record.joined) return;
        if (this.assigned || [...this.records.values()].filter(item => item.joined).length >= this.required - 1) { this._send(connection, { type: 'retry' }); return; }
        record.joined = true;
        const count = 1 + [...this.records.values()].filter(item => item.joined).length;
        this.onProgress(count);
        for (const item of this.records.values()) if (item.joined) this._send(item.connection, { type: 'waiting', count });
        if (count === this.required) this._assign();
      } else {
        if (data.type === 'waiting' && Number.isInteger(data.count) && data.count >= 1 && data.count <= this.required) this.onProgress(data.count);
        else if (data.type === 'retry' && !this.assigned) this._retry();
        else if (data.type === 'abort') this._abort(new Error('A matched player left before the game connected. Join the queue again.'));
        else if (data.type === 'assignment' && !this.assigned && /^[A-Z0-9]{4}$/.test(data.roomCode || '') && /^[a-f0-9]{48}$/.test(data.admissionToken || '')) {
          this.assigned = true;
          this._send(connection, { type: 'ack', roomCode: data.roomCode, admissionToken: data.admissionToken });
          this._resolve({ roomCode: data.roomCode, admissionToken: data.admissionToken });
        }
      }
    });
    connection.on('close', () => { if (current()) this._drop(record); });
    connection.on('error', () => { if (current()) this._drop(record); });
  }

  _assign() {
    this.assigned = true;
    for (const record of this.records.values()) if (record.joined) this._send(record.connection, { type: 'assignment', roomCode: this.roomCode, admissionToken: this.admissionToken });
    this.assignmentTimer = setTimeout(() => { if (!this.closed && !this.settled) this._abort(new Error('A matched player could not confirm the connection. Join the queue again.')); }, CONNECT_TIMEOUT);
  }

  _drop(record) {
    this.records.delete(record.connection);
    try { record.connection.close(); } catch (_) { /* Already gone. */ }
    if (this.closed || this.completed) return;
    if (this.leader) {
      if (this.assigned && record.joined) this._abort(new Error('A matched player left before the game connected. Join the queue again.'));
      else {
        const count = 1 + [...this.records.values()].filter(item => item.joined).length;
        this.onProgress(count);
        for (const item of this.records.values()) if (item.joined) this._send(item.connection, { type: 'waiting', count });
      }
    } else if (!this.assigned) this._retry();
    // After assignment, the game channel supplies connection/timeout failure.
    // A full coordinator intentionally closes the rendezvous when game is ready.
  }

  _send(connection, data) {
    if (this.closed || !connection?.open) return false;
    try { connection.send({ protocol: QUEUE_PROTOCOL, format: this.format, ...data }); return true; }
    catch (_) { return false; }
  }

  _heartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const record of [...this.records.values()]) {
        if (Date.now() - record.lastReceived > HEARTBEAT_TIMEOUT) this._drop(record);
        else this._send(record.connection, { type: 'ping' });
      }
    }, HEARTBEAT_INTERVAL);
  }

  _retry() {
    if (this.closed || this.assigned) return;
    ++this.epoch; this._clearTransport();
    clearTimeout(this.retryTimer);
    this.onProgress(1);
    this.retryTimer = setTimeout(() => this._claim(), 100 + Math.random() * 250);
  }

  _resolve(assignment) {
    if (this.settled || this.closed) return;
    this.settled = true; clearTimeout(this.assignmentTimer);
    this.resolve(assignment);
  }

  _clearTransport() {
    clearTimeout(this.openTimer); clearInterval(this.heartbeat); this.heartbeat = null;
    const peer = this.peer; this.peer = null;
    this.records.clear();
    try { peer?.destroy(); } catch (_) { /* No other browser's peer is touched. */ }
  }

  _abort(error) {
    if (this.closed) return;
    this.close(error);
    this.onAbort(error);
  }

  finish() { this.completed = true; this.close(null); }

  close(error = new Error('Matchmaking was canceled.')) {
    if (this.closed) return;
    if (!this.completed) for (const record of this.records.values()) this._send(record.connection, { type: this.leader ? this.assigned ? 'abort' : 'retry' : 'cancel' });
    this.closed = true; ++this.epoch;
    clearTimeout(this.retryTimer); clearTimeout(this.assignmentTimer);
    this._clearTransport();
    if (!this.settled) { this.settled = true; this.reject?.(error || new Error('Matchmaking ended.')); }
  }
}

export class OnlineSession {
  constructor({ onStatus, onConnected, onLobby, onInput, onState, onDisconnect, onRematchStatus, onRematchReady } = {}) {
    Object.assign(this, {
      onStatus: onStatus || (() => {}), onConnected: onConnected || (() => {}),
      onLobby: onLobby || (() => {}), onInput: onInput || (() => {}),
      onState: onState || (() => {}), onDisconnect: onDisconnect || (() => {}),
      onRematchStatus: onRematchStatus || (() => {}), onRematchReady: onRematchReady || (() => {}),
      role: null, localTeam: null, localPlayerId: null, gameFormat: 'standard-1v1',
      remoteProfile: null, roomCode: null, connected: false, roundId: 1,
      players: [], peers: new Map(), _connections: new Map(), _closed: true, _generation: 0,
    });
    this._resetRound();
  }

  async create(username, character, gameFormat = 'standard-1v1', config = {}) {
    return this._createRoom(username, character, gameFormat, config, 'room');
  }

  async _createRoom(username, character, gameFormat, config, entryMode) {
    if (!FORMATS.has(gameFormat)) throw new Error('Choose a supported online game mode.');
    const settings = gameFormat === 'custom' ? normalizeRoomConfig(config) : null;
    const generation = this._begin('host', username, character, gameFormat, settings);
    this.entryMode = entryMode;
    this._status('connecting', 'Creating your online room…');
    try {
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
        const code = randomCode();
        this.roomCode = displayCode(code);
        try {
          await this._openPeer(`${PREFIX}${code.toLowerCase()}`, generation);
          this._assertCurrent(generation);
          this._publishLobby();
          return this.roomCode;
        } catch (error) {
          this._assertCurrent(generation);
          if (error?.type !== 'unavailable-id' || attempt === CREATE_ATTEMPTS - 1) throw error;
          const peer = this.peer;
          this.peer = null;
          try { peer?.destroy(); } catch (_) { /* A collided ID owns no room. */ }
        }
      }
    } catch (error) {
      if (generation === this._generation && !this._closed) this._fail(peerError(error));
      throw peerError(error);
    }
  }

  async join(code, username, character, queueTransfer = null) {
    // A mistyped code must not close an existing game.
    const cleanCode = parseCode(code);
    const keepQueue = queueTransfer !== null && queueTransfer === this._queueToken;
    const generation = this._begin('guest', username, character, keepQueue ? this.gameFormat : 'standard-1v1', null, keepQueue);
    this.roomCode = displayCode(cleanCode);
    this._status('connecting', `Connecting to room ${this.roomCode}…`);
    try {
      await this._openPeer(undefined, generation);
      this._assertCurrent(generation);
      return await new Promise((resolve, reject) => {
        this._pendingJoin = { resolve, reject };
        this._connectionTimer = setTimeout(() => this._fail(new Error('The room could not be reached. Check the code, keep both tabs open, or try another network.')), CONNECT_TIMEOUT);
        try {
          this._attachConnection(this.peer.connect(`${PREFIX}${cleanCode.toLowerCase()}`, {
            label: PROTOCOL, serialization: 'binary', reliable: true, metadata: { protocol: PROTOCOL },
          }));
        } catch (error) { this._fail(peerError(error)); }
      });
    } catch (error) {
      if (generation === this._generation && !this._closed) this._fail(peerError(error));
      throw peerError(error);
    }
  }

  async queue(username, character, gameFormat = 'standard-1v1') {
    if (!['standard-1v1', 'standard-2v2'].includes(gameFormat)) throw new Error('Choose the 1v1 or 2v2 online queue.');
    const roomCode = await this._createRoom(username, character, gameFormat, {}, 'queue');
    const generation = this._generation, token = this._queueToken = {};
    this.entryMode = 'queue';
    this._queueAdmissionToken = randomToken();
    const matchmaker = this._matchmaker = new MatchmakingQueue({
      onProgress: count => { if (!this._closed && this._queueToken === token) this._status('queue', `Searching for ${gameFormat === 'standard-1v1' ? '1v1' : '2v2'} players… ${count}/${humanSlots(gameFormat).length} ready.`); },
      onAbort: error => { if (!this._closed && this._queueToken === token && !this.connected) this._fail(error); },
    });
    try {
      const assignment = await matchmaker.enter(gameFormat, roomCode, this._queueAdmissionToken);
      this._assertCurrent(generation);
      if (this._queueToken !== token) throw new Error('Matchmaking was canceled.');
      if (assignment.roomCode !== roomCode) {
        this._queueAdmissionToken = assignment.admissionToken;
        await this.join(assignment.roomCode, username, character, token);
      } else this._status('queue', 'Match found. Connecting everyone…');
      return this.roomCode;
    } catch (error) {
      if (!this._closed && this._queueToken === token) this._fail(peerError(error));
      throw peerError(error);
    }
  }

  sendInput(input) {
    if (this.role !== 'guest' || !this.connected || !this._roundStarted) return false;
    const clean = normalizeInput(input);
    return clean ? this._send({ type: 'input', roundId: this.roundId, sequence: ++this._inputSequence, input: clean }) : false;
  }

  sendState(state) {
    if (this.role !== 'host' || !this.connected || !this._roundStarted || !state || typeof state !== 'object') return false;
    const sequence = ++this._stateSequence;
    let sent = false;
    for (const record of this._connections.values()) {
      // Congestion on one connection cannot starve another teammate. The final
      // whistle and replay still arrive even when ordinary snapshots are skipped.
      if (record.connection.bufferSize > 8 && !state.replay && state.phase !== 'ended') continue;
      sent = this._sendTo(record.connection, { type: 'state', roundId: this.roundId, sequence, gameFormat: this.gameFormat, state }) || sent;
    }
    return sent;
  }

  startRound() {
    if (!this.connected || this._closed || (this._roundStarted && !this._rematchReady)) return false;
    if (this._roundStarted) this.roundId++;
    this._resetRound();
    this._roundStarted = true;
    this._notifyRematchStatus();
    return true;
  }

  markRoundEnded() {
    if (!this.connected || !this._roundStarted || this._closed) return false;
    this._roundEnded = true;
    this._maybeRematchReady();
    return true;
  }

  requestRematch() {
    if (!this.connected || !this._roundStarted || !this._roundEnded || this._closed) return false;
    if (this._localRematchReady) return true;
    this._localRematchReady = true;
    if (this.role === 'host') {
      this._rematchVotes.add(this.localPlayerId);
      this._broadcastRematchStatus();
    } else if (!this._send({ type: 'rematch', roundId: this.roundId, ready: true })) return false;
    this._notifyRematchStatus();
    this._maybeRematchReady();
    return true;
  }

  close() { this._dispose(new Error('The online session was closed.')); }

  _begin(role, username, character, gameFormat = 'standard-1v1', config = null, keepQueue = false) {
    this._dispose(new Error('The online session was replaced.'), keepQueue);
    this._closed = false;
    this.role = role;
    this.gameFormat = gameFormat;
    this.roomConfig = config;
    this.settings = { duration: config?.duration ?? 300, scoreLimit: config?.scoreLimit ?? 0 };
    if (!keepQueue) this.entryMode = 'room';
    this.localPlayerId = role === 'host' ? 0 : null;
    this.localTeam = role === 'host' ? 0 : 1;
    this.localProfile = profile(username, character);
    this.remoteProfile = null;
    this.roomCode = null;
    this.roundId = 1;
    this.players = role === 'host' ? [{ id: 0, team: 0, name: this.localProfile.username, character: this.localProfile.character, isBot: false }] : [];
    if (role === 'host' && gameFormat === 'bot-team') this.players.push(
      { id: 1, team: 1, name: 'CPU 1', character: selectBotCharacter(), isBot: true },
      { id: 3, team: 1, name: 'CPU 2', character: selectBotCharacter(), isBot: true },
    );
    if (role === 'host' && gameFormat === 'custom') for (const id of playerSlots(gameFormat, config)) if (config.slots[id] === 'bot') this.players.push({ id, team: id % 2, name: `CPU ${id + 1}`, character: selectBotCharacter(), isBot: true });
    this.players.sort((a, b) => a.id - b.id);
    this._resetRound();
    return this._generation;
  }

  _resetRound() {
    this._roundStarted = this._roundEnded = false;
    this._localRematchReady = this._remoteRematchReady = this._rematchReady = false;
    this._rematchVotes = new Set();
    this._inputSequence = this._stateSequence = 0;
    this._lastInputSequence = this._lastStateSequence = -1;
    for (const record of this._connections?.values() || []) record.lastInputSequence = -1;
  }

  _notifyRematchStatus() {
    const humans = humanSlots(this.gameFormat, this.roomConfig);
    this._remoteRematchReady = humans.filter(id => id !== this.localPlayerId).every(id => this._rematchVotes.has(id));
    const status = { localReady: this._localRematchReady, remoteReady: this._remoteRematchReady };
    if (humans.length > 2) Object.assign(status, { readyCount: this._rematchVotes.size, requiredCount: humans.length });
    this.onRematchStatus(status);
  }

  _broadcastRematchStatus() {
    this._send({ type: 'rematch-status', roundId: this.roundId, ready: [...this._rematchVotes] });
  }

  _maybeRematchReady() {
    if (this.role !== 'host' || !this.connected || !this._roundEnded || !this._localRematchReady || this._rematchReady || !humanSlots(this.gameFormat, this.roomConfig).every(id => this._rematchVotes.has(id))) return;
    this._rematchReady = true;
    // Reliable ordering puts this handshake before all new-round snapshots on
    // each channel, including when app callbacks immediately start the match.
    if (this._send({ type: 'rematch-ready', roundId: this.roundId }) && this.connected && !this._closed) this.onRematchReady();
  }

  _assertCurrent(generation) {
    if (this._closed || generation !== this._generation) throw new Error('The online session was closed.');
  }

  async _openPeer(id, generation) {
    const Peer = await loadPeerLibrary();
    this._assertCurrent(generation);
    return new Promise((resolve, reject) => {
      let opened = false;
      const pending = this._pendingOpen = { resolve, reject };
      const failOpen = error => {
        if (this._pendingOpen !== pending) return;
        clearTimeout(this._openTimer);
        this._pendingOpen = null;
        reject(error);
      };
      this._openTimer = setTimeout(() => failOpen(new Error('The room service did not respond. Check your internet connection and try again.')), OPEN_TIMEOUT);
      try {
        const peer = this.peer = new Peer(id, { secure: true, debug: 0 });
        const current = () => !this._closed && generation === this._generation && this.peer === peer;
        peer.on('open', () => {
          if (!current() || this._pendingOpen !== pending) return;
          opened = true;
          clearTimeout(this._openTimer);
          this._pendingOpen = null;
          resolve(peer);
        });
        peer.on('connection', connection => {
          if (!current() || this.role !== 'host' || this.connected || this._connections.size >= humanSlots(this.gameFormat, this.roomConfig).length - 1) {
            this._rejectConnection(connection, 'This room is full.');
          } else if (connection.metadata?.protocol !== PROTOCOL) {
            this._rejectConnection(connection, 'This game version is incompatible. Refresh every player’s tab.');
          } else this._attachConnection(connection);
        });
        peer.on('error', error => {
          if (!current()) return;
          if (!opened) { failOpen(error); return; }
          // An established WebRTC match survives a signaling interruption.
          if (this.connected && ['network', 'socket-error', 'socket-closed', 'disconnected', 'unavailable-id'].includes(error?.type)) return;
          this._fail(peerError(error));
        });
        peer.on('disconnected', () => {
          if (!current() || this.connected) return;
          const error = new Error('The room service disconnected. Create or join a new room.');
          if (!opened) failOpen(error); else this._fail(error);
        });
        peer.on('close', () => {
          if (!current()) return;
          const error = new Error('The online connection closed. Create or join a new room.');
          if (!opened) failOpen(error); else this._fail(error);
        });
      } catch (error) { failOpen(error); }
    });
  }

  _attachConnection(connection) {
    const generation = this._generation;
    const record = { connection, playerId: null, profile: null, lastReceived: Date.now(), lastInputSequence: -1 };
    this._connections.set(connection, record);
    this.connection ||= connection; // Compatibility for the two-player app/tests.
    const current = () => !this._closed && generation === this._generation && this._connections.get(connection) === record;
    record.timer = setTimeout(() => this._dropConnection(connection, new Error('A player could not connect. Try another network.')), CONNECT_TIMEOUT);
    connection.on('open', () => {
      if (!current()) return;
      record.lastReceived = Date.now();
      this._ensureHeartbeat();
      if (this.role === 'guest') this._sendTo(connection, { type: 'hello', profile: this.localProfile, queueToken: this._queueAdmissionToken });
    });
    connection.on('data', data => { if (current()) this._receive(data, connection); });
    connection.on('close', () => { if (current()) this._dropConnection(connection, new Error('A player disconnected. Create or join a new room to play again.')); });
    connection.on('error', error => { if (current()) this._dropConnection(connection, peerError(error)); });
  }

  _receive(data, connection = this.connection) {
    const record = this._connections.get(connection);
    if (!record || !data || typeof data !== 'object' || data.protocol !== PROTOCOL) return;
    record.lastReceived = Date.now();
    if (data.type === 'reject' && this.role === 'guest') {
      this._fail(new Error(typeof data.message === 'string' ? data.message.slice(0, 250) : 'This room is unavailable.'));
      return;
    }
    if (data.type === 'ping') { this._sendTo(connection, { type: 'pong' }); return; }
    if (data.type === 'pong') return;
    if (data.type === 'hello' && this.role === 'host' && !this.connected && record.playerId === null && data.profile) {
      if (this._queueAdmissionToken && data.queueToken !== this._queueAdmissionToken) { this._rejectConnection(connection, 'This match is reserved for queued players.'); return; }
      const playerId = humanSlots(this.gameFormat, this.roomConfig).find(id => !this.players.some(player => player.id === id));
      if (playerId === undefined) { this._rejectConnection(connection, 'This room is full.'); return; }
      record.playerId = playerId;
      record.profile = profile(data.profile.username, data.profile.character);
      clearTimeout(record.timer);
      this.peers.set(playerId, connection);
      this.players.push({ id: playerId, team: playerId % 2, name: record.profile.username, character: record.profile.character, isBot: false });
      this.players.sort((a, b) => a.id - b.id);
      this.remoteProfile ||= record.profile;
      this._publishLobby();
      return;
    }
    if (data.type === 'welcome' && this.role === 'guest' && !this.connected) {
      if (!this._acceptLobby(data)) return;
      clearTimeout(record.timer);
      clearTimeout(this._connectionTimer);
      record.playerId = 0;
      this.peers.set(0, connection);
      const pending = this._pendingJoin;
      this._pendingJoin = null;
      pending?.resolve(this.roomCode);
      if (data.ready === true) this._markConnected();
      return;
    }
    if (!this.connected || !this._roundStarted || data.roundId !== this.roundId) return;
    if (data.type === 'rematch' && this.role === 'host') {
      if (data.ready !== true || record.playerId === null || this._rematchVotes.has(record.playerId)) return;
      this._rematchVotes.add(record.playerId);
      this._broadcastRematchStatus();
      this._notifyRematchStatus();
      this._maybeRematchReady();
      return;
    }
    if (data.type === 'rematch-status' && this.role === 'guest') {
      if (!Array.isArray(data.ready) || data.ready.some(id => !humanSlots(this.gameFormat, this.roomConfig).includes(id))) return;
      this._rematchVotes = new Set(data.ready);
      this._notifyRematchStatus();
      return;
    }
    if (data.type === 'rematch-ready') {
      if (this.role !== 'guest' || !this._roundEnded || !this._localRematchReady || !this._remoteRematchReady || this._rematchReady) return;
      this._rematchReady = true;
      this.onRematchReady();
      return;
    }
    if (!Number.isSafeInteger(data.sequence) || data.sequence < 0) return;
    if (data.type === 'input' && this.role === 'host' && record.playerId !== null && data.sequence > record.lastInputSequence) {
      const clean = normalizeInput(data.input);
      if (!clean) return;
      record.lastInputSequence = data.sequence;
      this._lastInputSequence = data.sequence;
      // Identity always comes from the host-assigned channel, never a packet.
      this.onInput(clean, record.playerId);
    } else if (data.type === 'state' && this.role === 'guest' && data.sequence > this._lastStateSequence && data.state && typeof data.state === 'object') {
      this._lastStateSequence = data.sequence;
      this.onState(data.state);
    }
  }

  _lobbyPayload() {
    return {
      gameFormat: this.gameFormat, players: this.players.map(player => ({ ...player })),
      connectedHumans: this.players.filter(player => !player.isBot).length,
      requiredHumans: humanSlots(this.gameFormat, this.roomConfig).length, localPlayerId: this.localPlayerId,
      localTeam: this.localTeam, roomCode: this.roomCode, settings: { ...this.settings },
      roomConfig: this.roomConfig ? { ...this.roomConfig, slots: [...this.roomConfig.slots] } : null, entryMode: this.entryMode,
    };
  }

  _publishLobby() {
    if (this.role !== 'host' || this._closed) return;
    const lobby = this._lobbyPayload();
    const ready = lobby.connectedHumans === lobby.requiredHumans;
    if (ready) this._matchmaker?.finish();
    this._startingLobby = ready;
    for (const record of this._connections.values()) {
      if (record.playerId === null) continue;
      this._sendTo(record.connection, { type: 'welcome', ...lobby, localPlayerId: record.playerId, localTeam: record.playerId % 2, roundId: this.roundId, ready });
    }
    this._startingLobby = false;
    if (this._closed) return;
    this.onLobby(lobby);
    if (ready) this._markConnected();
    else this._status('waiting', `Room ${this.roomCode}: ${lobby.connectedHumans}/${lobby.requiredHumans} players. Share the code with your friends.`);
  }

  _acceptLobby(data) {
    if (data.roomCode !== this.roomCode || data.roundId !== this.roundId || !FORMATS.has(data.gameFormat) || !Array.isArray(data.players)) return false;
    let roomConfig = null;
    try { if (data.gameFormat === 'custom') roomConfig = normalizeRoomConfig(data.roomConfig); } catch (_) { return false; }
    const slots = humanSlots(data.gameFormat, roomConfig), expectedIds = playerSlots(data.gameFormat, roomConfig);
    const settings = { duration: roomConfig?.duration ?? 300, scoreLimit: roomConfig?.scoreLimit ?? 0 };
    if (data.settings?.duration !== settings.duration || data.settings?.scoreLimit !== settings.scoreLimit) return false;
    if (!slots.includes(data.localPlayerId) || data.localPlayerId === 0 || data.players.length > expectedIds.length) return false;
    const ids = new Set();
    const players = [];
    for (const raw of data.players) {
      if (!raw || !expectedIds.includes(raw.id) || ids.has(raw.id) || raw.team !== raw.id % 2 || !!raw.isBot !== !slots.includes(raw.id)) return false;
      ids.add(raw.id);
      const clean = profile(raw.name, raw.character);
      players.push({ id: raw.id, team: raw.team, name: clean.username, character: clean.character, isBot: !!raw.isBot });
    }
    if (!ids.has(0) || !ids.has(data.localPlayerId) || (data.ready === true && !expectedIds.every(id => ids.has(id)))) return false;
    // The assigned identity and room format cannot change in a later welcome.
    if (this.localPlayerId !== null && (this.localPlayerId !== data.localPlayerId || this.gameFormat !== data.gameFormat || JSON.stringify(this.roomConfig) !== JSON.stringify(roomConfig))) return false;
    this.gameFormat = data.gameFormat;
    this.roomConfig = roomConfig;
    this.settings = settings;
    this.localPlayerId = data.localPlayerId;
    this.localTeam = this.localPlayerId % 2;
    this.players = players.sort((a, b) => a.id - b.id);
    const host = players.find(player => player.id === 0);
    this.remoteProfile = { username: host.name, character: host.character };
    const lobby = this._lobbyPayload();
    this.onLobby(lobby);
    if (data.ready !== true) this._status('waiting', `Room ${this.roomCode}: ${lobby.connectedHumans}/${lobby.requiredHumans} players. Waiting for everyone…`);
    return true;
  }

  _markConnected() {
    if (this.connected || this._closed) return;
    this.connected = true;
    this._matchmaker?.finish();
    this._matchmaker = null;
    clearTimeout(this._connectionTimer);
    this._status('connected', this.gameFormat === 'standard-1v1' ? `Connected to ${this.remoteProfile?.username || 'your opponent'}.` : 'Everyone is connected. Starting the match…');
    const pending = this._pendingJoin;
    this._pendingJoin = null;
    pending?.resolve(this.roomCode);
    this.onConnected({ ...this._lobbyPayload(), role: this.role, remoteProfile: this.remoteProfile });
  }

  _ensureHeartbeat() {
    if (this._heartbeat) return;
    this._heartbeat = setInterval(() => {
      for (const record of [...this._connections.values()]) {
        if (Date.now() - record.lastReceived > HEARTBEAT_TIMEOUT) this._dropConnection(record.connection, new Error('A player’s connection timed out. Check everyone’s internet connection and create a new room.'));
        else this._sendTo(record.connection, { type: 'ping' });
      }
    }, HEARTBEAT_INTERVAL);
  }

  _dropConnection(connection, error) {
    const record = this._connections.get(connection);
    if (!record) return;
    if (this.role !== 'host' || this.connected || this._startingLobby) { this._fail(error); return; }
    this._connections.delete(connection);
    clearTimeout(record.timer);
    this.peers.delete(record.playerId);
    this.players = this.players.filter(player => player.id !== record.playerId);
    this.connection = this._connections.keys().next().value || null;
    try { connection.close(); } catch (_) { /* Already closed. */ }
    this.remoteProfile = [...this._connections.values()].find(item => item.profile)?.profile || null;
    this._publishLobby();
  }

  _sendTo(connection, message) {
    if (this._closed || !connection?.open) return false;
    try { connection.send({ protocol: PROTOCOL, ...message }); return true; }
    catch (error) { this._dropConnection(connection, peerError(error)); return false; }
  }

  _send(message) {
    if (this._closed) return false;
    let sent = false;
    for (const record of this._connections.values()) sent = this._sendTo(record.connection, message) || sent;
    return sent;
  }

  _rejectConnection(connection, message) {
    const reject = () => {
      try { connection.send({ protocol: PROTOCOL, type: 'reject', message }); }
      catch (_) { /* The joining tab may already be closed. */ }
      finally { setTimeout(() => connection.close(), 200); }
    };
    connection.on('error', () => connection.close());
    if (connection.open) reject(); else connection.on('open', reject);
  }

  _status(type, message) {
    if (this.entryMode === 'queue' && ['connecting', 'waiting'].includes(type)) {
      type = 'queue';
      message = `Searching for ${this.gameFormat === 'standard-1v1' ? '1v1' : '2v2'} players…`;
    }
    this.onStatus({ type, message, roomCode: this.entryMode === 'queue' ? null : this.roomCode });
  }

  _fail(error) {
    if (this._closed) return;
    const wasConnected = this.connected;
    const message = error?.message || 'The online connection failed.';
    this._dispose(error);
    this._status('error', message);
    this.onDisconnect({ reason: 'connection-error', message, wasConnected });
  }

  _dispose(error, keepQueue = false) {
    this._closed = true;
    if (!keepQueue) {
      const matchmaker = this._matchmaker; this._matchmaker = this._queueToken = null;
      this._queueAdmissionToken = null;
      matchmaker?.close(error);
    }
    this._generation++;
    this.connected = false;
    this._resetRound();
    clearTimeout(this._openTimer);
    clearTimeout(this._connectionTimer);
    clearInterval(this._heartbeat);
    this._heartbeat = null;
    this._startingLobby = false;
    const open = this._pendingOpen, join = this._pendingJoin;
    this._pendingOpen = this._pendingJoin = null;
    open?.reject(error); join?.reject(error);
    const records = [...this._connections.values()], peer = this.peer;
    this._connections.clear(); this.peers.clear();
    this.connection = this.peer = null;
    for (const record of records) {
      clearTimeout(record.timer);
      try { record.connection.close(); } catch (_) { /* Already closed. */ }
    }
    try { peer?.destroy(); } catch (_) { /* Already destroyed. */ }
  }
}
