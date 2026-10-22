/**
 * Host-authoritative one- and two-player teams over PeerJS 1.5.5 / WebRTC.
 * PeerServer Cloud only introduces the browsers; the host owns the simulation.
 * https://peerjs.com/client/api/peer and https://peerjs.com/server/cloud
 * Direct connections can fail on restrictive networks without a TURN relay.
 */
const PROTOCOL = 'rematch-rush-v3';
const PREFIX = `${PROTOCOL}-`;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CREATE_ATTEMPTS = 6;
const FORMATS = new Set(['standard-1v1', 'standard-2v2', 'bot-team']);
const humanSlots = format => format === 'standard-2v2' ? [0, 1, 2, 3] : format === 'bot-team' ? [0, 2] : [0, 1];
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

  async create(username, character, gameFormat = 'standard-1v1') {
    if (!FORMATS.has(gameFormat)) throw new Error('Choose a supported online game mode.');
    const generation = this._begin('host', username, character, gameFormat);
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

  async join(code, username, character) {
    // A mistyped code must not close an existing game.
    const cleanCode = parseCode(code);
    const generation = this._begin('guest', username, character);
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

  _begin(role, username, character, gameFormat = 'standard-1v1') {
    this._dispose(new Error('The online session was replaced.'));
    this._closed = false;
    this.role = role;
    this.gameFormat = gameFormat;
    this.localPlayerId = role === 'host' ? 0 : null;
    this.localTeam = role === 'host' ? 0 : 1;
    this.localProfile = profile(username, character);
    this.remoteProfile = null;
    this.roomCode = null;
    this.roundId = 1;
    this.players = role === 'host' ? [{ id: 0, team: 0, name: this.localProfile.username, character: this.localProfile.character, isBot: false }] : [];
    if (role === 'host' && gameFormat === 'bot-team') this.players.push(
      { id: 1, team: 1, name: 'CPU 1', character: 'manmarker', isBot: true },
      { id: 3, team: 1, name: 'CPU 2', character: 'powershooter', isBot: true },
    );
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
    const humans = humanSlots(this.gameFormat);
    this._remoteRematchReady = humans.filter(id => id !== this.localPlayerId).every(id => this._rematchVotes.has(id));
    const status = { localReady: this._localRematchReady, remoteReady: this._remoteRematchReady };
    if (humans.length > 2) Object.assign(status, { readyCount: this._rematchVotes.size, requiredCount: humans.length });
    this.onRematchStatus(status);
  }

  _broadcastRematchStatus() {
    this._send({ type: 'rematch-status', roundId: this.roundId, ready: [...this._rematchVotes] });
  }

  _maybeRematchReady() {
    if (this.role !== 'host' || !this.connected || !this._roundEnded || !this._localRematchReady || this._rematchReady || !humanSlots(this.gameFormat).every(id => this._rematchVotes.has(id))) return;
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
          if (!current() || this.role !== 'host' || this.connected || this._connections.size >= humanSlots(this.gameFormat).length - 1) {
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
      if (this.role === 'guest') this._sendTo(connection, { type: 'hello', profile: this.localProfile });
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
      const playerId = humanSlots(this.gameFormat).find(id => !this.players.some(player => player.id === id));
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
      if (!Array.isArray(data.ready) || data.ready.some(id => !humanSlots(this.gameFormat).includes(id))) return;
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
      requiredHumans: humanSlots(this.gameFormat).length, localPlayerId: this.localPlayerId,
      localTeam: this.localTeam, roomCode: this.roomCode,
    };
  }

  _publishLobby() {
    if (this.role !== 'host' || this._closed) return;
    const lobby = this._lobbyPayload();
    const ready = lobby.connectedHumans === lobby.requiredHumans;
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
    const slots = humanSlots(data.gameFormat), expectedIds = data.gameFormat === 'standard-1v1' ? [0, 1] : [0, 1, 2, 3];
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
    if (this.localPlayerId !== null && (this.localPlayerId !== data.localPlayerId || this.gameFormat !== data.gameFormat)) return false;
    this.gameFormat = data.gameFormat;
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

  _status(type, message) { this.onStatus({ type, message, roomCode: this.roomCode }); }

  _fail(error) {
    if (this._closed) return;
    const wasConnected = this.connected;
    const message = error?.message || 'The online connection failed.';
    this._dispose(error);
    this._status('error', message);
    this.onDisconnect({ reason: 'connection-error', message, wasConnected });
  }

  _dispose(error) {
    this._closed = true;
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
