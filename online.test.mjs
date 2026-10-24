import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineSession, normalizeRoomConfig } from './online.js';
import { Game } from './game.js';

class Emitter {
  constructor() { this.listeners = new Map(); }
  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
    return this;
  }
  emit(type, value) { this.listeners.get(type)?.forEach(callback => callback(value)); }
}

function peerNetwork() {
  const peers = new Map(), instances = [], connections = [], messages = [];
  const delivery = { synchronous: false }, faults = { collisions: 0 };
  let generatedId = 0;
  class Connection extends Emitter {
    constructor(metadata) {
      super(); this.metadata = metadata; this.open = false; this.bufferSize = 0;
      connections.push(this);
    }
    send(message) {
      if (!this.open) throw new Error('Connection closed');
      const copy = structuredClone(message);
      messages.push({ connection: this, message: copy });
      const deliver = () => { if (this.other.open) this.other.emit('data', copy); };
      if (delivery.synchronous) deliver(); else queueMicrotask(deliver);
    }
    close() {
      if (!this.open) return;
      this.open = false;
      queueMicrotask(() => this.emit('close'));
      if (this.other.open) {
        this.other.open = false;
        queueMicrotask(() => this.other.emit('close'));
      }
    }
  }
  class Peer extends Emitter {
    constructor(id) {
      super(); this.id = id || `guest-${++generatedId}`; this.connections = [];
      instances.push(this);
      if (id && (faults.collisions-- > 0 || peers.has(this.id))) {
        queueMicrotask(() => this.emit('error', { type: 'unavailable-id' }));
        return;
      }
      peers.set(this.id, this);
      queueMicrotask(() => this.emit('open', this.id));
    }
    connect(id, options) {
      const host = peers.get(id);
      if (!host) throw new Error('Missing host');
      const outgoing = new Connection(options.metadata), incoming = new Connection(options.metadata);
      outgoing.other = incoming; incoming.other = outgoing;
      this.connections.push(outgoing); host.connections.push(incoming);
      queueMicrotask(() => {
        host.emit('connection', incoming);
        outgoing.open = incoming.open = true;
        incoming.emit('open'); outgoing.emit('open');
      });
      return outgoing;
    }
    destroy() {
      this.destroyed = true;
      if (peers.get(this.id) === this) peers.delete(this.id);
      this.connections.forEach(connection => connection.close());
    }
  }
  return { Peer, peers, instances, connections, messages, delivery, faults };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

async function connectedPair(t, { autoStartRematch = true, importEndedState = false } = {}) {
  const network = peerNetwork();
  const previousPeer = globalThis.Peer;
  globalThis.Peer = network.Peer;
  const hostEvents = { connected: [], status: [], ready: [], inputs: [], disconnected: [] };
  const guestEvents = { connected: [], status: [], ready: [], states: [], disconnected: [] };
  let host, guest;
  host = new OnlineSession({
    onConnected(connection) { hostEvents.connected.push(connection); assert.equal(host.startRound(), true); },
    onRematchStatus(status) { hostEvents.status.push(status); },
    onRematchReady() { hostEvents.ready.push(host.roundId); if (autoStartRematch) assert.equal(host.startRound(), true); },
    onInput(input) { hostEvents.inputs.push(input); },
    onDisconnect(event) { hostEvents.disconnected.push(event); },
  });
  guest = new OnlineSession({
    onConnected(connection) { guestEvents.connected.push(connection); assert.equal(guest.startRound(), true); },
    onRematchStatus(status) { guestEvents.status.push(status); },
    onRematchReady() { guestEvents.ready.push(guest.roundId); if (autoStartRematch) assert.equal(guest.startRound(), true); },
    onState(state) {
      guestEvents.states.push(state);
      // Game.importState calls the app's onEnd callback for this frame.
      if (importEndedState && state.phase === 'ended') guest.markRoundEnded();
    },
    onDisconnect(event) { guestEvents.disconnected.push(event); },
  });
  t.after(() => { host.close(); guest.close(); globalThis.Peer = previousPeer; });
  const roomCode = await host.create(' Host ', 'ice');
  assert.equal(await guest.join(roomCode, 'Guest', 'ninja'), roomCode);
  await flush();
  return { host, guest, hostEvents, guestEvents, network, roomCode };
}

test('initial room handshake starts one round and preserves authoritative state and every input edge', async t => {
  const { host, guest, hostEvents, guestEvents, network, roomCode } = await connectedPair(t);
  assert.match(roomCode, /^[A-Z0-9]{4}$/);
  assert.equal(hostEvents.connected.length, 1);
  assert.equal(guestEvents.connected.length, 1);
  assert.equal(hostEvents.connected[0].remoteProfile.username, 'Guest');
  assert.equal(guestEvents.connected[0].remoteProfile.username, 'Host');
  assert.equal(host.roundId, 1); assert.equal(guest.roundId, 1);
  assert.equal(host.startRound(), false, 'starting twice cannot reset an active match');
  assert.equal(guest.sendInput({ shootHeld: true, aim: { x: 2100, y: 700 } }), true);
  assert.equal(guest.sendInput({ shootRelease: true, skipReplay: true, cancelShot: true, pass: true }), true);
  assert.equal(host.sendState({ phase: 'playing', score: [1, 0] }), true);
  assert.equal(host.sendInput({ action: true }), false);
  assert.equal(guest.sendState({ score: [9, 0] }), false);
  await flush();
  assert.equal(hostEvents.inputs.length, 2);
  assert.equal(hostEvents.inputs[0].shootHeld, true);
  assert.deepEqual(hostEvents.inputs[0].aim, { x: 2100, y: 700 });
  assert.equal(hostEvents.inputs[1].shootRelease, true);
  assert.equal(hostEvents.inputs[1].skipReplay, true);
  assert.equal(hostEvents.inputs[1].cancelShot, true);
  assert.equal(hostEvents.inputs[1].pass, true);
  assert.equal(hostEvents.inputs[0].pass, false);
  assert.deepEqual(guestEvents.states, [{ phase: 'playing', score: [1, 0] }]);
  const inputMessages = network.messages.filter(({ message }) => message.type === 'input');
  assert.deepEqual(inputMessages.map(({ message }) => [message.roundId, message.sequence]), [[1, 1], [1, 2]]);
});

test('both players can rematch repeatedly in the same room without reconnecting', async t => {
  const { host, guest, hostEvents, guestEvents, network, roomCode } = await connectedPair(t);
  const hostPeer = host.peer, guestPeer = guest.peer;
  const hostConnection = host.connection, guestConnection = guest.connection;
  for (let round = 1; round <= 3; round++) {
    assert.equal(host.markRoundEnded(), true);
    assert.equal(guest.markRoundEnded(), true);
    const first = round % 2 ? host : guest, second = round % 2 ? guest : host;
    assert.equal(first.requestRematch(), true);
    assert.equal(first.requestRematch(), true, 'double clicks preserve one vote');
    await flush();
    assert.equal(hostEvents.ready.length, round - 1, 'one player cannot start the next match');
    assert.equal(guestEvents.ready.length, round - 1);
    assert.equal(second.requestRematch(), true);
    await flush();
    assert.equal(host.roundId, round + 1); assert.equal(guest.roundId, round + 1);
    assert.equal(hostEvents.ready.length, round); assert.equal(guestEvents.ready.length, round);
    assert.deepEqual(hostEvents.status.at(-1), { localReady: false, remoteReady: false });
    assert.deepEqual(guestEvents.status.at(-1), { localReady: false, remoteReady: false });
    assert.equal(host.requestRematch(), false, 'the next match must end before voting again');
    assert.equal(guest.sendInput({ action: true }), true);
    assert.equal(host.sendState({ round: round + 1 }), true);
    await flush();
  }
  assert.equal(host.peer, hostPeer); assert.equal(guest.peer, guestPeer);
  assert.equal(host.connection, hostConnection); assert.equal(guest.connection, guestConnection);
  assert.equal(host.roomCode, roomCode); assert.equal(guest.roomCode, roomCode);
  assert.equal(network.instances.length, 2); assert.equal(network.connections.length, 2);
  assert.equal(hostEvents.connected.length, 1); assert.equal(guestEvents.connected.length, 1);
  assert.equal(hostEvents.inputs.length, 3); assert.equal(guestEvents.states.length, 3);
});

test('rematch handshakes reject stale, duplicate, malformed and wrong-role packets', async t => {
  const { host, guest, hostEvents, guestEvents, network } = await connectedPair(t, { autoStartRematch: false });
  const protocol = network.messages[0].message.protocol;
  assert.equal(host.requestRematch(), false);
  assert.equal(guest.requestRematch(), false);
  host.markRoundEnded(); guest.markRoundEnded();
  host._receive({ protocol, type: 'rematch', roundId: 0, ready: true });
  host._receive({ protocol, type: 'rematch', roundId: 1, ready: 'yes' });
  host._receive({ protocol, type: 'rematch-ready', roundId: 1 });
  guest._receive({ protocol, type: 'rematch-ready', roundId: 1 });
  assert.equal(hostEvents.ready.length, 0); assert.equal(guestEvents.ready.length, 0);
  host.requestRematch(); guest.requestRematch(); await flush();
  assert.equal(hostEvents.ready.length, 1); assert.equal(guestEvents.ready.length, 1);
  for (let repeat = 0; repeat < 3; repeat++) {
    host._receive({ protocol, type: 'rematch', roundId: 1, ready: true });
    guest._receive({ protocol, type: 'rematch-ready', roundId: 1 });
  }
  assert.equal(hostEvents.ready.length, 1); assert.equal(guestEvents.ready.length, 1);
  assert.equal(host.startRound(), true); assert.equal(guest.startRound(), true);
  host._receive({ protocol, type: 'input', roundId: 1, sequence: 9999, input: { action: true } });
  guest._receive({ protocol, type: 'state', roundId: 1, sequence: 9999, state: { stale: true } });
  host._receive({ protocol, type: 'rematch', roundId: 1, ready: true });
  guest._receive({ protocol, type: 'rematch-ready', roundId: 1 });
  assert.deepEqual(hostEvents.inputs, []); assert.deepEqual(guestEvents.states, []);
  guest.sendInput({ action: true }); host.sendState({ fresh: true }); await flush();
  assert.equal(hostEvents.inputs.length, 1, 'old high sequence numbers cannot suppress the fresh round');
  assert.deepEqual(guestEvents.states, [{ fresh: true }]);
});

test('an early remote vote cannot reset or end the local match', async t => {
  const { host, guest, hostEvents, guestEvents } = await connectedPair(t);
  host.markRoundEnded(); host.requestRematch(); await flush();
  assert.equal(guest.requestRematch(), false, 'a running local game cannot consent');
  assert.equal(hostEvents.ready.length, 0); assert.equal(guestEvents.ready.length, 0);
  assert.equal(guest.roundId, 1);
  guest.markRoundEnded(); guest.requestRematch(); await flush();
  assert.equal(hostEvents.ready.length, 1); assert.equal(guestEvents.ready.length, 1);
  assert.equal(guest.roundId, 2);
});

test('the final whistle reaches a congested guest and permits rematch without another host frame', async t => {
  const { host, guest, hostEvents, guestEvents } = await connectedPair(t, { importEndedState: true });
  host.connection.bufferSize = 12;
  assert.equal(host.sendState({ phase: 'playing', time: .1 }), false, 'ordinary stale snapshots are skipped');
  // This is the host app's onEnd order: export the ended frame, stop the
  // simulation, show the results, then mark the round ended.
  assert.equal(host.sendState({ phase: 'ended', time: 0, score: [2, 1] }), true);
  host.markRoundEnded();
  host.requestRematch();
  await flush();
  assert.deepEqual(guestEvents.states, [{ phase: 'ended', time: 0, score: [2, 1] }]);
  assert.equal(guest.requestRematch(), true, 'importing full time made the guest eligible');
  await flush();
  assert.equal(hostEvents.ready.length, 1); assert.equal(guestEvents.ready.length, 1);
  assert.equal(host.roundId, 2); assert.equal(guest.roundId, 2);
});

test('immediate app callbacks start both rounds before accepting the host next-match snapshot', async t => {
  const { host, guest, hostEvents, guestEvents, network } = await connectedPair(t);
  const startHostRematch = host.onRematchReady;
  host.onRematchReady = () => {
    startHostRematch();
    // startMatch immediately calls updateHUD, which can send the first frame.
    host.sendState({ phase: 'playing', freshRound: host.roundId });
  };
  network.delivery.synchronous = true;
  for (let round = 1; round <= 2; round++) {
    host.markRoundEnded(); guest.markRoundEnded();
    const first = round % 2 ? guest : host, second = round % 2 ? host : guest;
    first.requestRematch(); second.requestRematch();
    assert.equal(host.roundId, round + 1); assert.equal(guest.roundId, round + 1);
    assert.deepEqual(guestEvents.states.at(-1), { phase: 'playing', freshRound: round + 1 });
    assert.equal(hostEvents.ready.length, round); assert.equal(guestEvents.ready.length, round);
  }
});

test('reordered and duplicate snapshots or input edges cannot overwrite a newer event', async t => {
  const { host, guest, hostEvents, guestEvents, network } = await connectedPair(t);
  const protocol = network.messages[0].message.protocol;
  for (const sequence of [4, 4, 2, 5]) {
    host._receive({ protocol, type: 'input', roundId: 1, sequence, input: { action: true, skill: sequence } });
    guest._receive({ protocol, type: 'state', roundId: 1, sequence, state: { sequence } });
  }
  assert.deepEqual(hostEvents.inputs.map(input => input.skill), [4, 5]);
  assert.deepEqual(guestEvents.states, [{ sequence: 4 }, { sequence: 5 }]);
});

test('a disconnected opponent cannot rematch and the surviving screen receives the disconnect', async t => {
  const { host, guest, hostEvents, guestEvents } = await connectedPair(t);
  host.markRoundEnded(); guest.markRoundEnded(); host.requestRematch(); await flush();
  guest.close(); await flush();
  assert.equal(host.connected, false); assert.equal(guest.connected, false);
  assert.equal(host.requestRematch(), false); assert.equal(host.startRound(), false);
  assert.equal(guest.requestRematch(), false); assert.equal(guest.startRound(), false);
  assert.equal(hostEvents.disconnected.length, 1);
  assert.equal(hostEvents.disconnected[0].wasConnected, true);
  assert.match(hostEvents.disconnected[0].message, /disconnected/i);
  assert.equal(hostEvents.ready.length, 0); assert.equal(guestEvents.ready.length, 0);
});

test('a high-polling guest keeps traffic bounded while its shot and ability reach the host without losing an edge', async t => {
  const {host,guest,hostEvents,guestEvents}=await connectedPair(t);
  const hostGame=new Game(null,{mode:'online',opponentCharacter:'manmarker'});
  hostGame.state.kickoff=null;hostGame.setOwner(hostGame.state.players[1]);
  const guestGame=new Game(null,{mode:'guest',localTeam:1,character:'manmarker',onInput:input=>guest.sendInput(input)});
  guestGame.importState(hostGame.exportState());
  const receive=host.onInput;host.onInput=input=>{receive(input);hostGame.setInput(1,input);};
  for(let i=0;i<1000;i++){guestGame.queueAim({x:140,y:700+i*.01});guestGame.flushAimInput(i);}
  guestGame.startShot();guestGame.releaseShot();guestGame.useSkill(1);
  await flush();
  assert.ok(hostEvents.inputs.length<=33,`${hostEvents.inputs.length} packets for 1,000 moves and three edges`);
  assert.equal(hostGame.pending[1].filter(([kind])=>kind==='shoot').length,1);
  hostGame.update(.01);
  assert.equal(hostGame.state.players[1].shotsTaken,1);
  assert.ok(hostGame.state.players[1].cooldowns[0]>25);
  assert.equal(hostGame.state.players[1].aim.y,709.99);
  host.sendState(hostGame.exportState());await flush();guestGame.importState(guestEvents.states.at(-1));
  assert.equal(guestGame.state.players[1].shotsTaken,1);
  assert.ok(guestGame.state.players[1].cooldowns[0]>25);
});


async function roomHarness(t, gameFormat) {
  const network = peerNetwork(), previousPeer = globalThis.Peer;
  globalThis.Peer = network.Peer;
  const sessions = [], events = [];
  const add = () => {
    const event = { connected: [], lobby: [], input: [], states: [], ready: [], disconnected: [], rematch: [] };
    let session;
    session = new OnlineSession({
      onConnected(payload) { event.connected.push(payload); session.startRound(); },
      onLobby(payload) { event.lobby.push(payload); },
      onInput(input, playerId) { event.input.push({ input, playerId }); },
      onState(state) { event.states.push(state); },
      onRematchStatus(status) { event.rematch.push(status); },
      onRematchReady() { event.ready.push(session.roundId); session.startRound(); },
      onDisconnect(payload) { event.disconnected.push(payload); },
    });
    sessions.push(session); events.push(event);
    return session;
  };
  t.after(() => { sessions.forEach(session => session.close()); globalThis.Peer = previousPeer; });
  const host = add(), code = await host.create('Host', 'emperor', gameFormat);
  return { host, code, add, sessions, events, network };
}

test('four-player standard assigns real opponents and teammates and starts only when the lobby is full', async t => {
  const { host, code, add, events, sessions } = await roomHarness(t, 'standard-2v2');
  assert.equal(events[0].lobby.at(-1).requiredHumans, 4);
  for (let id = 1; id <= 3; id++) {
    const guest = add();
    assert.equal(await guest.join(code.toLowerCase(), `Player ${id}`, id === 2 ? 'magician' : 'ice'), code);
    await flush();
    assert.equal(guest.localPlayerId, id);
    assert.equal(guest.localTeam, id % 2);
    assert.equal(events[0].lobby.at(-1).connectedHumans, id + 1);
    assert.equal(host.connected, id === 3);
    assert.equal(events[0].connected.length, id === 3 ? 1 : 0);
  }
  for (let id = 0; id < 4; id++) {
    assert.equal(events[id].connected.length, 1);
    assert.deepEqual(sessions[id].players.map(player => [player.id, player.team, player.isBot]), [[0, 0, false], [1, 1, false], [2, 0, false], [3, 1, false]]);
    assert.equal(sessions[id].gameFormat, 'standard-2v2');
    assert.equal(sessions[id].roundId, 1);
  }
  host.sendState({ players: ['all four'], score: [1, 0] });
  await flush();
  for (let id = 1; id < 4; id++) assert.deepEqual(events[id].states, [{ players: ['all four'], score: [1, 0] }]);
});

test('each team guest controls only its host-assigned slot with independent sequence numbers', async t => {
  const { host, code, add, events, sessions, network } = await roomHarness(t, 'standard-2v2');
  for (let id = 1; id < 4; id++) await add().join(code, `P${id}`, 'serpent');
  await flush();
  const protocol = network.messages[0].message.protocol;
  for (let id = 1; id < 4; id++) {
    sessions[id].sendInput({ action: true, pass: true, skill: id, aim: { x: 1e9, y: -1e9 } });
    sessions[id].connection.send({ protocol, type: 'input', roundId: 1, sequence: 2, playerId: 0, input: { skill: id + 3 } });
    sessions[id].connection.send({ protocol, type: 'state', roundId: 1, sequence: 900, state: { score: [99, 0] } });
  }
  await flush();
  assert.deepEqual(events[0].input.map(event => [event.playerId, event.input.skill]), [[1, 1], [1, 4], [2, 2], [2, 5], [3, 3], [3, 6]]);
  assert.deepEqual(events[0].input[0].input.aim, { x: 100000, y: -100000 });
  assert.deepEqual(events[0].input.filter(event => event.input.pass).map(event => event.playerId), [1, 2, 3], 'each guest pass edge keeps its assigned player identity');
  assert.deepEqual(events[0].states, []);
  for (let id = 1; id < 4; id++) {
    sessions[id].connection.send({ protocol, type: 'input', roundId: 1, sequence: 2, input: { action: true } });
    sessions[id].connection.send({ protocol, type: 'input', roundId: 0, sequence: 99999, input: { action: true } });
  }
  await flush();
  assert.equal(events[0].input.length, 6);
  host.sendState({ fresh: true }); await flush();
  assert.deepEqual(events[1].states, [{ fresh: true }]);
});

test('all four humans must consent to rematch and the same connections route new-round state', async t => {
  const { host, code, add, events, sessions, network } = await roomHarness(t, 'standard-2v2');
  for (let id = 1; id < 4; id++) await add().join(code, `P${id}`, 'none');
  await flush();
  const peers = sessions.map(session => session.peer), connections = sessions.map(session => session.connection);
  network.delivery.synchronous = true;
  host.onRematchReady = () => {
    events[0].ready.push(host.roundId); host.startRound(); host.sendState({ round: host.roundId });
  };
  for (let round = 1; round <= 2; round++) {
    sessions.forEach(session => session.markRoundEnded());
    for (const id of [2, 0, 1]) sessions[id].requestRematch();
    assert.equal(events[0].ready.length, round - 1);
    assert.equal(events[3].rematch.at(-1).readyCount, 3);
    sessions[3].requestRematch();
    sessions.forEach((session, id) => {
      assert.equal(session.roundId, round + 1);
      assert.equal(events[id].ready.length, round);
      assert.equal(session.peer, peers[id]); assert.equal(session.connection, connections[id]);
      if (id) assert.deepEqual(events[id].states.at(-1), { round: round + 1 });
    });
  }
  assert.equal(network.instances.length, 4);
});

test('bot-team admits two humans on the same side and reserves two CPU opponents', async t => {
  const { host, code, add, events } = await roomHarness(t, 'bot-team');
  const guest = add(); await guest.join(code, 'Teammate', 'magician'); await flush();
  assert.equal(guest.localPlayerId, 2); assert.equal(guest.localTeam, 0);
  assert.equal(events[0].connected.length, 1);
  assert.deepEqual(host.players.map(player => [player.id, player.team, player.isBot]), [[0, 0, false], [1, 1, true], [2, 0, false], [3, 1, true]]);
  assert.ok(host.players.filter(player => player.isBot).every(player => /^[a-z]+$/.test(player.character)));
  assert.deepEqual(guest.players.filter(player => player.isBot).map(player => player.character),host.players.filter(player => player.isBot).map(player => player.character),'the host chooses bot characters once and shares them with every guest');
  guest.sendInput({ action: true }); await flush();
  assert.equal(events[0].input[0].playerId, 2);
  host.markRoundEnded(); guest.markRoundEnded(); host.requestRematch(); guest.requestRematch(); await flush();
  assert.equal(host.roundId, 2); assert.equal(guest.roundId, 2);
});

test('a waiting player can leave and be replaced without destroying the host lobby', async t => {
  const { host, code, add, events } = await roomHarness(t, 'standard-2v2');
  const first = add(); await first.join(code, 'Leaving', 'ice');
  const second = add(); await second.join(code, 'Staying', 'emperor'); await flush();
  first.close(); await flush();
  assert.equal(host._closed, false); assert.equal(host.connected, false);
  assert.equal(events[0].lobby.at(-1).connectedHumans, 2);
  assert.equal(second.localPlayerId, 2);
  const replacement = add(); await replacement.join(code, 'Replacement', 'serpent');
  assert.equal(replacement.localPlayerId, 1);
  const final = add(); await final.join(code, 'Final', 'ninja'); await flush();
  assert.equal(host.connected, true); assert.equal(second.connected, true); assert.equal(replacement.connected, true);
  assert.deepEqual(host.players.map(player => player.name), ['Host', 'Replacement', 'Staying', 'Final']);
});

test('a mid-match disconnect closes all four sessions rather than leaving an uncontrolled player', async t => {
  const { code, add, events, sessions } = await roomHarness(t, 'standard-2v2');
  for (let id = 1; id < 4; id++) await add().join(code, `P${id}`, 'none');
  await flush();
  sessions[2].close(); await flush();
  sessions.forEach(session => { assert.equal(session.connected, false); assert.equal(session.peers.size, 0); });
  for (const id of [0, 1, 3]) assert.equal(events[id].disconnected.length, 1);
});

test('a fifth player is rejected without disturbing a full room', async t => {
  const { host, code, add, events } = await roomHarness(t, 'standard-2v2');
  for (let id = 1; id < 4; id++) await add().join(code, `P${id}`, 'none');
  await flush();
  const fifth = add();
  await assert.rejects(fifth.join(code, 'Extra', 'none'), /full/);
  assert.equal(host.connected, true); assert.equal(host.players.length, 4); assert.equal(events[0].disconnected.length, 0);
});

test('four-character room creation retries collisions, then stops after six attempts', async t => {
  const network = peerNetwork(), previousPeer = globalThis.Peer;
  globalThis.Peer = network.Peer;
  const host = new OnlineSession(), failingHost = new OnlineSession();
  t.after(() => { host.close(); failingHost.close(); globalThis.Peer = previousPeer; });
  network.faults.collisions = 2;
  assert.match(await host.create('Host', 'none'), /^[A-Z0-9]{4}$/);
  assert.equal(network.instances.length, 3);
  assert.equal(network.instances[0].destroyed, true); assert.equal(network.instances[1].destroyed, true);
  network.faults.collisions = 10;
  await assert.rejects(failingHost.create('Host', 'none'), /already in use/);
  assert.equal(network.instances.length, 9);
  assert.equal(failingHost._closed, true);
});

test('codes accept exactly four alphanumeric characters and invalid codes preserve an existing session', async t => {
  const { host, code, add } = await roomHarness(t, 'standard-1v1');
  const guest = add(); await guest.join(code, 'Guest', 'none'); await flush();
  const peer = guest.peer;
  for (const invalid of ['', 'ABC', 'ABCDE', 'AB!2', 'ABCD-EFGH']) await assert.rejects(guest.join(invalid, 'Guest', 'none'), /4-letter or number/);
  assert.equal(guest.peer, peer); assert.equal(guest.connected, true); assert.equal(host.connected, true);
});

test('four real game engines route guest movement, skills and Q passes through one authoritative match and rematch', async t => {
  const network = peerNetwork(), previousPeer = globalThis.Peer;
  globalThis.Peer = network.Peer;
  network.delivery.synchronous = true;
  const sessions = [], games = [], payloads = [], constructions = [0, 0, 0, 0], imports = [0, 0, 0, 0], events = [];
  const constructGame = (index, connection) => {
    assert.equal(sessions[index].startRound(), true);
    const game = games[index] = new Game(null, {
      mode: connection.role === 'host' ? 'online' : 'guest',
      gameFormat: connection.gameFormat, players: connection.players,
      localPlayerId: connection.localPlayerId, localTeam: connection.localTeam,
      onInput: input => sessions[index].sendInput(input),
      onState: () => { imports[index]++; },
      onEvent: event => { if (index === 0) events.push(event); },
    });
    constructions[index]++;
    if (index === 0) {
      game.state.kickoff = null;
      [[300, 200], [700, 250], [450, 500], [900, 500]].forEach(([x, y], id) => Object.assign(game.state.players[id], { x, y }));
      game.setOwner(game.state.players[2]);
      // The application may publish from its initial HUD callback before the
      // final guest's join() has resolved. Every guest must already have a game.
      assert.equal(sessions[0].sendState(game.exportState()), true);
    }
  };
  for (let index = 0; index < 4; index++) {
    const session = new OnlineSession({
      onConnected(connection) { payloads[index] = connection; constructGame(index, connection); },
      onInput(input, playerId) { games[0].setInput(playerId, input); },
      onState(state) { assert.ok(games[index], 'welcome constructs the engine before the first snapshot'); games[index].importState(state); },
      onRematchReady() { constructGame(index, payloads[index]); },
    });
    sessions.push(session);
  }
  t.after(() => { sessions.forEach(session => session.close()); globalThis.Peer = previousPeer; });
  const code = await sessions[0].create('Host', 'emperor', 'standard-2v2');
  for (const [index, character] of [[1, 'falcon'], [2, 'magician'], [3, 'ice']]) await sessions[index].join(code, `Guest ${index}`, character);
  await flush();
  assert.deepEqual(constructions, [1, 1, 1, 1]);
  const authoritative = games[0], originalHost = { x: authoritative.state.players[0].x, y: authoritative.state.players[0].y };
  for (const [index, key] of [[1, 'd'], [2, 'w'], [3, 'a']]) {
    games[index].localInput.keys = { [key]: true };
    games[index].sendLocal();
    assert.equal(authoritative.inputs[index].keys[key], true);
    assert.equal(games[index].localPlayer().id, index);
    assert.equal(games[index].localTeam, index % 2);
  }
  authoritative.update(.1);
  assert.deepEqual({ x: authoritative.state.players[0].x, y: authoritative.state.players[0].y }, originalHost, 'guest inputs never move the host');
  assert.ok(authoritative.state.players[1].x > 700);
  assert.ok(authoritative.state.players[2].y < 500);
  assert.ok(authoritative.state.players[3].x < 900);
  sessions[0].sendState(authoritative.exportState());
  assert.equal(games[1].useSkill(2), true);
  assert.equal(games[2].usePass(), true);
  assert.deepEqual(authoritative.pending[1], [['skill', 2]]);
  assert.deepEqual(authoritative.pending[2], [['pass']]);
  authoritative.update(.01);
  assert.equal(authoritative.state.players[1].cooldowns[1], 20, 'the first rival uses its own Falcon ability');
  assert.equal(authoritative.state.ball.owner, null);
  assert.equal(authoritative.state.ball.passTarget, 0, 'the second blue player passes to its own teammate');
  assert.ok(events.some(event => event.type === 'pass' && event.playerId === 2 && event.targetId === 0));
  sessions[0].sendState(authoritative.exportState());
  for (let index = 1; index < 4; index++) {
    assert.deepEqual(games[index].exportState(), authoritative.exportState());
    assert.equal(games[index].state.players.length, 4);
    assert.equal(games[index].state.gameFormat, 'standard-2v2');
    assert.ok(imports[index] >= 3);
  }
  const oldGames = [...games], peerInstances = [...sessions.map(session => session.peer)];
  sessions.forEach(session => session.markRoundEnded());
  for (const index of [2, 1, 0]) sessions[index].requestRematch();
  assert.deepEqual(constructions, [1, 1, 1, 1]);
  sessions[3].requestRematch();
  assert.deepEqual(constructions, [2, 2, 2, 2], 'every engine is replaced exactly once after unanimous consent');
  for (let index = 0; index < 4; index++) {
    assert.equal(sessions[index].roundId, 2);
    assert.equal(sessions[index].peer, peerInstances[index]);
    assert.notEqual(games[index], oldGames[index]);
    assert.equal(games[index].localPlayer().id, index);
    assert.deepEqual(games[index].exportState(), games[0].exportState());
  }
});


function queueHarness(t) {
  const network = peerNetwork(), previousPeer = globalThis.Peer;
  globalThis.Peer = network.Peer;
  const sessions = [], events = [];
  const add = () => {
    const event = { status: [], connected: [], lobby: [], input: [], disconnected: [] };
    const session = new OnlineSession({
      onStatus(payload) { event.status.push(payload); },
      onLobby(payload) { event.lobby.push(payload); },
      onConnected(payload) { event.connected.push(payload); session.startRound(); },
      onInput(input, id) { event.input.push({ input, id }); },
      onDisconnect(payload) { event.disconnected.push(payload); },
    });
    sessions.push(session); events.push(event);
    return session;
  };
  t.after(() => { sessions.forEach(session => session.close()); globalThis.Peer = previousPeer; });
  return { network, sessions, events, add };
}

async function settleQueue() { for (let i = 0; i < 8; i++) await flush(); }

test('custom mixed teams retain configured bot slots, game settings, assigned controls and rematch rules', async t => {
  const { add, events } = queueHarness(t), host = add(), guest = add();
  const config = { slots: ['human', 'human', 'bot', 'bot'], duration: 120, scoreLimit: 3 };
  const code = await host.create('You', 'emperor', 'custom', config);
  config.slots[2] = 'human';
  await guest.join(code, 'Friend', 'ice'); await flush();
  assert.deepEqual(host.players.map(p => [p.id, p.team, p.isBot]), [[0, 0, false], [1, 1, false], [2, 0, true], [3, 1, true]]);
  assert.deepEqual(guest.roomConfig.slots, ['human', 'human', 'bot', 'bot']);
  assert.deepEqual(events[0].connected[0].settings, { duration: 120, scoreLimit: 3 });
  assert.deepEqual(events[1].connected[0].settings, { duration: 120, scoreLimit: 3 });
  guest.sendInput({ pass: true, ultraShot: true, shootHeld: true }); await flush();
  assert.equal(events[0].input[0].id, 1);
  assert.equal(events[0].input[0].input.ultraShot, true);
  assert.equal(events[0].input[0].input.pass, true);
  host.markRoundEnded(); guest.markRoundEnded(); host.requestRematch(); guest.requestRematch(); await flush();
  assert.equal(host._rematchReady, true);
  assert.equal(guest._rematchReady, true);
  assert.deepEqual(host.settings, { duration: 120, scoreLimit: 3 });
});

test('a single-human custom bot room rematches repeatedly without a remote handshake', async t => {
  const network = peerNetwork(), previousPeer = globalThis.Peer, ready = [];
  globalThis.Peer = network.Peer;
  let host;
  host = new OnlineSession({
    onConnected() { assert.equal(host.startRound(), true); },
    onRematchReady() { ready.push(host.roundId); assert.equal(host.startRound(), true); },
  });
  t.after(() => { host.close(); globalThis.Peer = previousPeer; });
  const config = { slots: ['human', 'bot', 'bot', 'bot'], duration: 120, scoreLimit: 3 };
  const code = await host.create('You', 'ice', 'custom', config);
  const peer = host.peer, players = structuredClone(host.players);
  assert.equal(host.connected, true);
  assert.equal(host._connections.size, 0);
  for (let round = 1; round <= 3; round++) {
    assert.equal(host.markRoundEnded(), true);
    assert.equal(host.requestRematch(), true);
    await flush();
    assert.equal(ready.length, round);
    assert.equal(host.roundId, round + 1);
    assert.equal(host.requestRematch(), false, 'the restarted round must finish before another vote');
    assert.deepEqual(host.roomConfig, config);
    assert.deepEqual(host.settings, { duration: 120, scoreLimit: 3 });
    assert.deepEqual(host.players, players);
    assert.equal(host.roomCode, code);
    assert.equal(host.peer, peer);
  }
  assert.equal(network.instances.length, 1);
  assert.equal(network.connections.length, 0);
  assert.equal(network.messages.length, 0, 'a solo room needs no remote ready packet');
});

test('custom empty slots retain original team identity and only exact human slots can join', async t => {
  const { add } = queueHarness(t), host = add(), friend = add();
  const code = await host.create('Host', 'none', 'custom', { slots: ['human', 'bot', 'human', 'empty'], duration: 600, scoreLimit: 10 });
  await friend.join(code, 'Friend', 'ice'); await flush();
  assert.equal(friend.localPlayerId, 2); assert.equal(friend.localTeam, 0);
  assert.deepEqual(host.players.map(p => [p.id, p.team, p.isBot]), [[0, 0, false], [1, 1, true], [2, 0, false]]);
  assert.equal(host.connected, true);
  assert.equal(friend.players.some(p => p.id === 3), false);
  assert.equal(host._lobbyPayload().requiredHumans, 2);
  const extra = add(); await assert.rejects(extra.join(code, 'Extra', 'none'), /full/);
});

test('custom room config rejects invalid teams and settings before replacing an existing room', async t => {
  const { add } = queueHarness(t), host = add();
  await host.create('Host', 'ice'); const peer = host.peer;
  for (const config of [
    { slots: ['bot', 'human', 'bot', 'bot'] },
    { slots: ['human', 'empty', 'bot', 'empty'] },
    { slots: ['human', 'friend', 'bot', 'bot'] },
    { slots: ['human', 'human'] },
    { duration: 0 }, { duration: 60 }, { duration: 180 }, { scoreLimit: -1 }, { scoreLimit: 999 },
  ]) await assert.rejects(host.create('Host', 'ice', 'custom', config));
  assert.equal(host.peer, peer); assert.equal(host._closed, false);
  assert.deepEqual(normalizeRoomConfig({ duration: 120 }), { slots: ['human', 'human', 'bot', 'bot'], duration: 120, scoreLimit: 0 });
});

test('custom welcomes cannot change settings, bots, team assignments or empty slots after initial acceptance', async t => {
  const { add, network } = queueHarness(t), host = add(), guest = add();
  const code = await host.create('Host', 'none', 'custom', { slots: ['human', 'human', 'human', 'empty'], duration: 300, scoreLimit: 5 });
  await guest.join(code, 'Guest', 'ice'); await flush();
  const welcome = network.messages.find(({ message }) => message.type === 'welcome').message;
  for (const mutate of [
    data => { data.settings.duration = 600; },
    data => { data.roomConfig.slots[3] = 'bot'; },
    data => { data.players[1].team = 0; },
    data => { data.players[1].isBot = true; },
    data => { data.roomConfig.scoreLimit = 10; data.settings.scoreLimit = 10; },
  ]) { const data = structuredClone(welcome); mutate(data); assert.equal(guest._acceptLobby(data), false); }
  assert.deepEqual(guest.settings, { duration: 300, scoreLimit: 5 });
  assert.equal(guest.players.length, 2);
});

test('1v1 matchmaking pairs two real waiting players automatically with no join code or bots', async t => {
  const { add, events, sessions, network } = queueHarness(t);
  const host = add(), guest = add();
  const first = host.queue('First', 'ice', 'standard-1v1'); await settleQueue();
  assert.equal(host.connected, false); assert.equal(events[0].connected.length, 0);
  assert.match(events[0].status.at(-1).message, /Searching.*1\/2/);
  assert.equal(events[0].status.some(status => /share|room [A-Z0-9]{4}/i.test(status.message)), false);
  assert.equal(events[0].status.every(status => status.roomCode === null), true);
  const second = guest.queue('Second', 'ninja', 'standard-1v1');
  await Promise.all([first, second]); await settleQueue();
  assert.equal(host.connected, true); assert.equal(guest.connected, true);
  assert.equal(host.role, 'host'); assert.equal(guest.role, 'guest');
  assert.equal(host.roomCode, guest.roomCode);
  for (let i = 0; i < 2; i++) {
    assert.equal(events[i].connected.length, 1);
    assert.equal(sessions[i].players.length, 2);
    assert.equal(sessions[i].players.some(p => p.isBot), false);
    assert.equal(sessions[i].entryMode, 'queue');
  }
  assert.equal([...network.peers.keys()].some(id => id.includes('-queue-')), false, 'full queues release only their transient rendezvous');
  assert.ok(host.peer && !host.peer.destroyed); assert.ok(guest.peer && !guest.peer.destroyed);
});

test('2v2 queue waits for four true humans and assigns all four controls without converting to a room form', async t => {
  const { add, events, sessions } = queueHarness(t), pending = [];
  for (let i = 0; i < 3; i++) { pending.push(add().queue(`P${i}`, 'ice', 'standard-2v2')); await settleQueue(); }
  assert.equal(sessions.some(s => s.connected), false);
  assert.match(events[0].status.at(-1).message, /3\/4/);
  pending.push(add().queue('P3', 'falcon', 'standard-2v2'));
  await Promise.all(pending); await settleQueue();
  assert.deepEqual(sessions.map(s => s.localPlayerId).sort(), [0, 1, 2, 3]);
  for (const session of sessions) {
    assert.equal(session.connected, true);
    assert.equal(session.players.filter(p => !p.isBot).length, 4);
    assert.equal(session.gameFormat, 'standard-2v2');
  }
});

test('matchmaking queues isolate 1v1 and 2v2 and cancel releases both room and transient peers', async t => {
  const { add, network, events } = queueHarness(t), duel = add(), teams = add();
  const a = duel.queue('Duel', 'none', 'standard-1v1'), b = teams.queue('Team', 'none', 'standard-2v2');
  const rejectedA = assert.rejects(a, /closed|canceled/i), rejectedB = assert.rejects(b, /closed|canceled/i);
  await settleQueue();
  assert.equal(duel.connected, false); assert.equal(teams.connected, false);
  assert.match(events[0].status.at(-1).message, /1v1/); assert.match(events[1].status.at(-1).message, /2v2/);
  duel.close(); teams.close(); await Promise.all([rejectedA, rejectedB]); await settleQueue();
  assert.equal(network.peers.size, 0);
  assert.equal(events[0].connected.length, 0); assert.equal(events[1].connected.length, 0);
});

test('canceling a waiting queue participant does not occupy a ghost slot', async t => {
  const { add, events } = queueHarness(t), host = add(), leaving = add();
  const first = host.queue('Host', 'ice', 'standard-2v2');
  const cancelled = leaving.queue('Leaving', 'ice', 'standard-2v2'); const rejected = assert.rejects(cancelled, /closed|canceled/i);
  await settleQueue(); leaving.close(); await rejected; await settleQueue();
  assert.match(events[0].status.at(-1).message, /1\/4/);
  const replacements = [add(), add(), add()];
  await Promise.all([first, ...replacements.map((session, i) => session.queue(`New${i}`, 'ninja', 'standard-2v2'))]); await settleQueue();
  assert.deepEqual(host.players.map(p => p.name).sort(), ['Host', 'New0', 'New1', 'New2']);
});

test('canceling the waiting coordinator lets remaining entrants elect a new coordinator and match', async t => {
  const { add, events } = queueHarness(t), leaving = add(), staying = add();
  const cancelled = leaving.queue('Leaving', 'ice', 'standard-2v2'); const rejected = assert.rejects(cancelled, /closed|canceled/i);
  const first = staying.queue('Staying', 'ninja', 'standard-2v2');
  await settleQueue(); leaving.close(); await rejected;
  await new Promise(resolve => setTimeout(resolve, 400)); await settleQueue();
  assert.match(events[1].status.at(-1).message, /1\/4/);
  const others = [add(), add(), add()];
  await Promise.all([first, ...others.map((s, i) => s.queue(`Other${i}`, 'none', 'standard-2v2'))]); await settleQueue();
  assert.equal(staying.connected, true); assert.equal(staying.role, 'host');
  assert.equal(staying.players.some(p => p.name === 'Leaving'), false);
});

test('a full completed queue frees rendezvous for the next match without affecting the first game', async t => {
  const { add } = queueHarness(t), first = [add(), add()];
  await Promise.all(first.map((s, i) => s.queue(`A${i}`, 'ice', 'standard-1v1'))); await settleQueue();
  const code = first[0].roomCode, peer = first[0].peer;
  const second = [add(), add()]; await Promise.all(second.map((s, i) => s.queue(`B${i}`, 'ninja', 'standard-1v1'))); await settleQueue();
  assert.equal(first[0].roomCode, code); assert.equal(first[0].peer, peer); assert.equal(first[0].connected, true);
  assert.notEqual(second[0].roomCode, code);
  assert.equal(second.every(s => s.connected), true);
});

test('queue-only game room rejects an unrelated code join without stealing a selected slot', async t => {
  const { add, events } = queueHarness(t), host = add(), stranger = add(), selected = add();
  const pending = host.queue('Host', 'ice', 'standard-1v1'); await settleQueue();
  await assert.rejects(stranger.join(host.roomCode, 'Stranger', 'none'), /reserved/);
  assert.equal(host.players.length, 1); assert.equal(events[0].connected.length, 0);
  await Promise.all([pending, selected.queue('Selected', 'ninja', 'standard-1v1')]); await settleQueue();
  assert.equal(host.players[1].name, 'Selected'); assert.equal(host.connected, true);
});

test('queue cancellation before the first transport opens cannot later autojoin a stale assignment', async t => {
  const { add, network, events } = queueHarness(t), cancelled = add();
  const pending = cancelled.queue('Canceled', 'ice', 'standard-1v1'); const rejected = assert.rejects(pending, /closed|canceled/i);
  cancelled.close(); await rejected; await settleQueue();
  assert.equal(network.peers.size, 0); assert.equal(events[0].connected.length, 0);
});


test('canceling an assigned player before its room transfer refuses the whole incomplete batch', async t => {
  const { add, sessions, events, network } = queueHarness(t), host = add(), cancel = add();
  const hostPending = host.queue('Host', 'ice', 'standard-2v2');
  const cancelPending = cancel.queue('Cancel', 'ninja', 'standard-2v2');
  const hostRejected = assert.rejects(hostPending, /left|closed|canceled/i);
  const cancelRejected = assert.rejects(cancelPending, /closed|canceled/i);
  await settleQueue();
  const originalResolve = cancel._matchmaker._resolve;
  cancel._matchmaker._resolve = function (assignment) { originalResolve.call(this, assignment); cancel.close(); };
  const rest = [add(), add()];
  const restPending = rest.map((session, i) => session.queue(`Rest${i}`, 'none', 'standard-2v2'));
  const restRejected = restPending.map(pending => assert.rejects(pending, /left|closed|canceled|unavailable|Missing host/i));
  await Promise.all([hostRejected, cancelRejected, ...restRejected]); await settleQueue();
  assert.equal(sessions.some(session => session.connected), false);
  assert.equal(events.some(event => event.connected.length), false);
  assert.equal(network.peers.size, 0);
});

test('stale queue packets on the wrong role and wrong protocol cannot force assignment or consume a slot', async t => {
  const { add, network } = queueHarness(t), host = add(), waiting = add();
  const hostPending = host.queue('Host', 'ice', 'standard-2v2');
  const waitingPending = waiting.queue('Waiting', 'ninja', 'standard-2v2');
  const hostRejected = assert.rejects(hostPending, /closed|canceled/i), waitingRejected = assert.rejects(waitingPending, /closed|canceled/i);
  await settleQueue();
  const outgoing = [...waiting._matchmaker.records.values()][0].connection;
  const protocol = network.messages.find(({ message }) => message.type === 'join').message.protocol;
  outgoing.send({ protocol, format: 'standard-2v2', type: 'assignment', roomCode: 'AB12', admissionToken: '0'.repeat(48) });
  outgoing.send({ protocol: 'wrong', format: 'standard-2v2', type: 'join' });
  outgoing.send({ protocol, format: 'standard-1v1', type: 'join' });
  outgoing.send({ protocol, format: 'standard-2v2', type: 'join' });
  await settleQueue();
  assert.equal(host._matchmaker.assigned, false);
  assert.equal(host._matchmaker.records.size, 1);
  assert.equal(host.connected, false);
  host.close(); waiting.close(); await Promise.all([hostRejected, waitingRejected]);
});


test('concurrent entrants beyond a full queue survive handoff and form a separate next game', async t => {
  const { add, sessions } = queueHarness(t);
  const pending = [add().queue('A0', 'ice', 'standard-1v1'), add().queue('A1', 'ice', 'standard-1v1'), add().queue('B0', 'ninja', 'standard-1v1')];
  await Promise.all(pending.slice(0, 2)); await settleQueue();
  assert.equal(sessions[0].connected, true); assert.equal(sessions[1].connected, true);
  assert.equal(sessions[2].connected, false);
  await new Promise(resolve => setTimeout(resolve, 400)); await settleQueue();
  pending.push(add().queue('B1', 'ninja', 'standard-1v1'));
  await Promise.all(pending); await settleQueue();
  assert.equal(sessions[2].connected, true); assert.equal(sessions[3].connected, true);
  assert.equal(sessions[0].roomCode, sessions[1].roomCode);
  assert.equal(sessions[2].roomCode, sessions[3].roomCode);
  assert.notEqual(sessions[0].roomCode, sessions[2].roomCode);
});


test('reliably delivered coordinator cancellation preserves unassigned followers for re-election', async t => {
  const { add, network, events } = queueHarness(t), leaving = add(), staying = add();
  const cancelled = leaving.queue('Leaving', 'ice', 'standard-2v2'); const rejected = assert.rejects(cancelled, /closed|canceled/i);
  const first = staying.queue('Staying', 'ninja', 'standard-2v2');
  await settleQueue(); network.delivery.synchronous = true;
  leaving.close(); await rejected;
  assert.equal(staying._closed, false, 'an explicit coordinator retry, delivered before channel close, preserves the waiting entrant');
  assert.equal(events[1].disconnected.length, 0);
  await new Promise(resolve => setTimeout(resolve, 400)); await settleQueue();
  const others = [add(), add(), add()];
  await Promise.all([first, ...others.map((s, i) => s.queue(`Other${i}`, 'none', 'standard-2v2'))]); await settleQueue();
  assert.equal(staying.connected, true); assert.equal(staying.role, 'host');
  assert.equal(staying.players.some(p => p.name === 'Leaving'), false);
});
