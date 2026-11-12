import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initPixelAccountUI, isPixelAuthorizationUrl } from './pixel-account.js';

const NOW = Date.parse('2026-10-24T13:00:00Z');
const CALLBACK = 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';
function authorizeUrl({ create = false } = {}) {
  const url = new URL('https://pixel-pulse-websites.vercel.app/api/sso/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: 'rematch-rush', redirect_uri: CALLBACK, response_type: 'code', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43), state: 's'.repeat(43), nonce: 'n'.repeat(43), scope: 'openid profile email' }).toString();
  if (create) { url.searchParams.set('pixel_intent', 'link'); url.searchParams.set('nonce', 'create_' + 'n'.repeat(43)); }
  return url.href;
}
const anonymous = { available: true, authenticated: false };
const signedIn = { available: true, authenticated: true, profile: { displayName: 'Pixel player' }, sessionExpiresAt: new Date(NOW + 60000).toISOString() };

function harness(responses, { creationControls = true, search = '' } = {}) {
  const nodes = new Map();
  const ids = ['pixel-account', 'pixel-account-sign-in', 'pixel-account-sign-out', 'pixel-account-name', 'pixel-account-status', 'profile-name', 'header-sign-out'];
  if (creationControls) ids.push('pixel-account-discover', 'pixel-account-create', 'pixel-account-create-confirmation', 'pixel-account-create-confirm', 'pixel-account-create-cancel', 'pixel-account-return');
  for (const id of ids) {
    const listeners = new Map();
    nodes.set(id, {
      hidden: true, disabled: false, textContent: id === 'profile-name' ? 'Guest striker' : '', attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
      listeners,
      set innerHTML(_) { throw new Error('Untrusted account content must not use HTML.'); },
    });
  }
  const requests = [], redirects = [], timers = new Map();
  let timer = 0;
  const document = { getElementById: id => nodes.get(id) || null };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const result = responses.shift();
    if (result instanceof Error) throw result;
    if (typeof result === 'function') return result(url, options);
    return { ok: true, json: async () => result };
  };
  const ui = initPixelAccountUI({
    document, fetchImpl, location: { search, assign(url) { redirects.push(url); } }, now: () => NOW,
    setTimer(callback, delay) { const id = ++timer; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); },
  });
  return { ui, node: id => nodes.get(id), requests, redirects, timers };
}

test('disabled configuration and static-host missing API leave account controls hidden and guest identity untouched', async () => {
  for (const result of [{ available: false, authenticated: false }, () => ({ ok: false }), new Error('offline'), () => ({ ok: true, json: async () => { throw new Error('static HTML'); } })]) {
    const app = harness([result]);
    assert.equal(app.node('pixel-account').hidden, true);
    await app.ui.ready;
    assert.equal(app.node('pixel-account').hidden, true);
    assert.equal(app.node('profile-name').textContent, 'Guest striker');
    assert.equal(await app.ui.startSignIn(), false);
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, '/api/auth/pixel-pulse/session');
    assert.equal(app.requests[0].options.credentials, 'same-origin');
    assert.equal(app.requests[0].options.cache, 'no-store');
    app.ui.destroy();
  }
});

test('bound-only sign-in uses a credentialed JSON POST and only navigates to the fixed central flow', async () => {
  const url = authorizeUrl();
  const app = harness([anonymous, { url }]);
  await app.ui.ready;
  assert.equal(app.node('pixel-account').hidden, false);
  assert.match(app.node('pixel-account-status').textContent, /already linked/);
  assert.equal(app.node('pixel-account-sign-out').hidden, true);
  assert.equal(app.node('pixel-account-sign-in').listeners.has('click'), true);
  assert.equal(await app.ui.startSignIn(), true);
  assert.deepEqual(app.redirects, [url]);
  const request = app.requests[1];
  assert.equal(request.url, '/api/auth/pixel-pulse/start');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.body, '{}');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(app.node('profile-name').textContent, 'Guest striker');
  app.ui.destroy();
});

test('handoff validation rejects changed origin, callback, client, path, credentials, fragments and duplicate fixed parameters', () => {
  assert.equal(isPixelAuthorizationUrl(authorizeUrl()), true);
  const unsafe = [null, {}, '', '/api/sso/oauth2/authorize', 'javascript:alert(1)'];
  for (const change of [
    url => { url.protocol = 'http:'; },
    url => { url.hostname = 'pixel-pulse-websites.vercel.app.attacker.invalid'; },
    url => { url.pathname += '/other'; },
    url => { url.username = 'attacker'; },
    url => { url.hash = 'credentials'; },
    url => { url.searchParams.set('client_id', 'skyway-sprint'); },
    url => { url.searchParams.set('redirect_uri', 'https://attacker.invalid/callback'); },
    url => { url.searchParams.set('code_challenge_method', 'plain'); },
    url => { url.searchParams.append('client_id', 'rematch-rush'); },
    url => { url.searchParams.set('pixel_intent', 'link'); },
    url => { url.searchParams.set('scope', 'openid profile email offline_access'); },
    url => { url.searchParams.append('scope', 'openid profile email'); },
  ]) { const url = new URL(authorizeUrl()); change(url); unsafe.push(url.href); }
  for (const value of unsafe) assert.equal(isPixelAuthorizationUrl(value), false);
});

test('an invalid handoff cannot navigate or expose its response details', async () => {
  const app = harness([anonymous, { url: 'https://attacker.invalid/?secret=do-not-display' }]);
  await app.ui.ready;
  assert.equal(await app.ui.startSignIn(), false);
  assert.deepEqual(app.redirects, []);
  assert.equal(app.node('pixel-account-sign-in').disabled, false);
  assert.match(app.node('pixel-account-status').textContent, /Guest play still works/);
  assert.doesNotMatch(app.node('pixel-account-status').textContent, /attacker|secret|do-not-display/);
  app.ui.destroy();
});

test('signed-in display uses text only, preserves the guest profile and expires without silent refresh', async () => {
  const app = harness([{ ...signedIn, profile: { displayName: '<img src=x onerror=alert(1)>' } }]);
  await app.ui.ready;
  assert.equal(app.node('pixel-account-name').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(app.node('profile-name').textContent, 'Guest striker');
  assert.equal(app.node('pixel-account-sign-in').hidden, true);
  assert.equal(app.node('pixel-account-sign-out').hidden, false);
  assert.equal(app.timers.size, 1);
  const { callback, delay } = [...app.timers.values()][0];
  assert.equal(delay, 60000);
  callback();
  assert.equal(app.node('pixel-account-name').textContent, '');
  assert.equal(app.node('pixel-account-sign-in').hidden, false);
  assert.match(app.node('pixel-account-status').textContent, /session ended/);
  assert.equal(app.requests.length, 1, 'expiry must not invent refresh or silently renew');
  assert.equal(app.node('profile-name').textContent, 'Guest striker');
  app.ui.destroy();
});

test('expired, absent and overlong session metadata never displays authenticated state', async () => {
  for (const sessionExpiresAt of [undefined, 'not a date', new Date(NOW - 1).toISOString(), new Date(NOW + 300001).toISOString()]) {
    const app = harness([{ ...signedIn, sessionExpiresAt }]);
    await app.ui.ready;
    assert.equal(app.node('pixel-account-sign-in').hidden, false);
    assert.equal(app.node('pixel-account-sign-out').hidden, true);
    assert.equal(app.node('pixel-account-name').textContent, '');
    assert.equal(app.timers.size, 0);
    app.ui.destroy();
  }
});

test('site sign-out is confirmed locally without claiming central logout or modifying guest data', async () => {
  const app = harness([signedIn, { ok: true, authenticated: false }]);
  await app.ui.ready;
  assert.equal(await app.ui.endSession(), true);
  assert.equal(app.requests[1].url, '/api/auth/pixel-pulse/sign-out');
  assert.equal(app.requests[1].options.method, 'POST');
  assert.equal(app.timers.size, 0);
  assert.equal(app.node('pixel-account-sign-in').hidden, false);
  assert.equal(app.node('profile-name').textContent, 'Guest striker');
  assert.match(app.node('pixel-account-status').textContent, /Pixel Pulse sign-in and device player profile are unchanged/);
  assert.equal(app.requests.some(request => request.url.includes('logout')), false);
  app.ui.destroy();
});

test('failed, contradictory or incomplete sign-out cannot fake success and preserves the original expiry', async (t) => {
  const cases = {
    'network failure': new Error('offline'),
    'both flags contradict success': { ok: false, authenticated: true },
    'failed operation with signed-out claim': { ok: false, authenticated: false },
    'successful operation with signed-in claim': { ok: true, authenticated: true },
    'missing authenticated': { ok: true },
    'missing ok': { authenticated: false },
    'missing both': {},
    'truthy string ok': { ok: 'true', authenticated: false },
    'false string authenticated': { ok: true, authenticated: 'false' },
  };
  for (const [label, result] of Object.entries(cases)) await t.test(label, async () => {
    const app = harness([signedIn, result]);
    await app.ui.ready;
    assert.equal(await app.ui.endSession(), false);
    assert.equal(app.node('pixel-account-sign-out').hidden, false);
    assert.equal(app.node('pixel-account-sign-in').hidden, true);
    assert.equal(app.node('pixel-account-name').textContent, 'Pixel player');
    assert.match(app.node('pixel-account-status').textContent, /Could not confirm/);
    assert.equal(app.timers.size, 1);
    [...app.timers.values()][0].callback();
    assert.equal(app.node('pixel-account-sign-out').hidden, true);
    assert.match(app.node('pixel-account-status').textContent, /session ended/);
    app.ui.destroy();
  });
});

test('duplicate sign-in actions share no second attempt and a destroyed UI ignores stale responses', async () => {
  let resolveStart;
  const app = harness([anonymous, () => new Promise(resolve => { resolveStart = resolve; })]);
  await app.ui.ready;
  const first = app.ui.startSignIn();
  assert.equal(app.node('pixel-account-sign-in').disabled, true);
  assert.equal(await app.ui.startSignIn(), false);
  assert.equal(app.requests.length, 2);
  app.ui.destroy();
  resolveStart({ ok: true, json: async () => ({ url: authorizeUrl() }) });
  assert.equal(await first, false);
  assert.deepEqual(app.redirects, []);
  assert.equal(app.node('pixel-account-sign-in').listeners.size, 0);
});

test('a late readiness response cannot reveal a destroyed account control', async () => {
  let resolveSession;
  const app = harness([() => new Promise(resolve => { resolveSession = resolve; })]);
  app.ui.destroy();
  resolveSession({ ok: true, json: async () => signedIn });
  await app.ui.ready;
  assert.equal(app.node('pixel-account').hidden, true);
  assert.equal(app.timers.size, 0);
});

test('account readiness, sign-out and re-entry never access or upload device-local storage', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let storageAccesses = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { storageAccesses++; throw new Error('Device-local data is outside this account flow.'); } });
  const app = harness([signedIn, { ok: true, authenticated: false }, { url: authorizeUrl() }]);
  try {
    await app.ui.ready;
    assert.equal(await app.ui.endSession(), true);
    assert.equal(await app.ui.startSignIn(), true);
    assert.equal(storageAccesses, 0);
    assert.equal(app.node('profile-name').textContent, 'Guest striker');
    for (const request of app.requests.filter(request => request.options.method === 'POST')) assert.equal(request.options.body, '{}');
  } finally {
    app.ui.destroy();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('the account markup hides separate-profile confirmation by default and has no native password or guest adoption controls', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const account = html.match(/<section class="pixel-account"[\s\S]*?<\/section>/)?.[0];
  assert.ok(account);
  assert.match(account, /id="pixel-account" hidden/);
  assert.match(account, /id="pixel-account-sign-in"/);
  assert.match(account, /id="pixel-account-sign-out"/);
  assert.match(account, /id="pixel-account-create"[^>]* hidden>Create a Rematch profile/);
  assert.match(account, /id="pixel-account-create-confirmation"[^>]* hidden/);
  assert.match(account, /progress on this device stays separate/);
  assert.match(account, /current Pixel password only on Pixel Pulse/);
  assert.doesNotMatch(account, /<form|<input|data-action|id="profile-name"|type="password"/);
  assert.match(html, /id="profile-name">Player<\/span>/);
  assert.match(html, /type="module" src="\.\/pixel-account\.js\?v=6"/);
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(css, /\.site-header\[hidden\]\+\.pixel-account\{display:none\}/);
});

test('new profile controls require the exact available capability and remain optional for older markup', async () => {
  for (const firstConnections of [undefined, false, 'true', 1]) {
    const app = harness([{ ...anonymous, firstConnections }]);
    await app.ui.ready;
    assert.equal(app.node('pixel-account-create').hidden, true);
    assert.equal(app.ui.openCreateConfirmation(), false);
    assert.equal(await app.ui.startCreate(), false);
    assert.equal(app.requests.length, 1);
    app.ui.destroy();
  }
  const old = harness([{ ...anonymous, firstConnections: true }, { url: authorizeUrl() }], { creationControls: false });
  await old.ui.ready;
  assert.equal(old.ui.openCreateConfirmation(), false);
  assert.equal(await old.ui.startSignIn(), true);
  old.ui.destroy();
});

test('new profile flow requires explicit confirmation and sends only its separate-profile acknowledgement', async () => {
  const url = authorizeUrl({ create: true });
  const app = harness([{ ...anonymous, firstConnections: true }, { url }]);
  await app.ui.ready;
  assert.equal(app.node('pixel-account-create').hidden, false);
  assert.equal(app.node('pixel-account-create-confirmation').hidden, true);
  assert.equal(await app.ui.startCreate(), false);
  assert.equal(app.ui.openCreateConfirmation(), true);
  assert.equal(app.node('pixel-account-create-confirmation').hidden, false);
  assert.equal(app.requests.length, 1, 'opening confirmation never starts an attempt');
  assert.equal(app.ui.closeCreateConfirmation(), true);
  assert.equal(await app.ui.startCreate(), false);
  assert.equal(app.ui.openCreateConfirmation(), true);
  assert.equal(await app.ui.startCreate(), true);
  assert.deepEqual(app.redirects, [url]);
  assert.equal(app.requests[1].url, '/api/auth/pixel-pulse/create');
  assert.deepEqual(JSON.parse(app.requests[1].options.body), { intent: 'create', acknowledgeSeparateProfile: true });
  assert.equal(app.requests[1].options.credentials, 'same-origin');
  assert.equal(app.node('profile-name').textContent, 'Guest striker');
  app.ui.destroy();
  assert.equal(app.node('pixel-account-create').listeners.size, 0);
  assert.equal(app.node('pixel-account-create-confirm').listeners.size, 0);
});

test('fresh authorization is accepted only for explicit create with exactly the fixed nine fields', async () => {
  assert.equal(isPixelAuthorizationUrl(authorizeUrl({ create: true })), false);
  assert.equal(isPixelAuthorizationUrl(authorizeUrl(), { intent: 'create' }), false);
  assert.equal(isPixelAuthorizationUrl(authorizeUrl({ create: true }), { intent: 'create' }), true);
  const withoutIntent = new URL(authorizeUrl({ create: true }));
  withoutIntent.searchParams.delete('pixel_intent');
  assert.equal(isPixelAuthorizationUrl(withoutIntent.href), false, 'A create nonce cannot fall through to an ordinary return.');
  for (const mutate of [
    url => { url.searchParams.set('pixel_intent', 'create'); },
    url => { url.searchParams.append('pixel_intent', 'link'); },
    url => { url.searchParams.set('state', 'short'); },
    url => { url.searchParams.delete('nonce'); },
    url => { url.searchParams.set('nonce', 'n'.repeat(43)); },
    url => { url.searchParams.set('prompt', 'none'); },
    url => { url.searchParams.set('code_challenge', 'unsafe/challenge'); },
  ]) {
    const url = new URL(authorizeUrl({ create: true })); mutate(url);
    assert.equal(isPixelAuthorizationUrl(url.href, { intent: 'create' }), false);
  }
  const ordinary = harness([anonymous, { url: authorizeUrl({ create: true }) }]);
  await ordinary.ui.ready;
  assert.equal(await ordinary.ui.startSignIn(), false);
  assert.deepEqual(ordinary.redirects, []);
  ordinary.ui.destroy();
  const create = harness([{ ...anonymous, firstConnections: true }, { url: authorizeUrl() }]);
  await create.ui.ready; create.ui.openCreateConfirmation();
  assert.equal(await create.ui.startCreate(), false);
  assert.deepEqual(create.redirects, []);
  create.ui.destroy();
});

test('uncertain callback guidance keeps new creation blocked and offers only ordinary return', async () => {
  const app = harness([{ ...anonymous, firstConnections: true }, { url: authorizeUrl() }], { search: '?pixel=uncertain' });
  await app.ui.ready;
  assert.match(app.node('pixel-account-status').textContent, /could not confirm.*Continue with Pixel Pulse/);
  assert.doesNotMatch(app.node('pixel-account-status').textContent, /unchanged|try.*creat|start.*again/i);
  assert.equal(app.node('pixel-account-create').hidden, true);
  assert.equal(app.ui.openCreateConfirmation(), false);
  assert.equal(await app.ui.startCreate(), false);
  assert.equal(await app.ui.startSignIn(), true);
  assert.equal(app.requests[1].url, '/api/auth/pixel-pulse/start');
  app.ui.destroy();
});

test('callback notices use fixed text without trusting query content or claiming a failed connection left data unchanged', async () => {
  for (const notice of ['created', 'refused', 'returned']) {
    const app = harness([anonymous], { search: `?pixel=${notice}&detail=%3Cimg%3Esecret` });
    await app.ui.ready;
    assert.doesNotMatch(app.node('pixel-account-status').textContent, /<img>|secret|unchanged/);
    assert.equal(app.node('profile-name').textContent, 'Guest striker');
    app.ui.destroy();
  }
});

test('create never accesses device storage and duplicate or destroyed requests cannot navigate', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('No device storage in profile creation.'); } });
  let resolveCreate;
  const app = harness([{ ...anonymous, firstConnections: true }, () => new Promise(resolve => { resolveCreate = resolve; })]);
  try {
    await app.ui.ready; app.ui.openCreateConfirmation();
    const pending = app.ui.startCreate();
    assert.equal(await app.ui.startCreate(), false);
    assert.equal(app.requests.length, 2);
    assert.equal(app.node('pixel-account-create-confirm').disabled, true);
    app.ui.destroy();
    resolveCreate({ ok: true, json: async () => ({ url: authorizeUrl({ create: true }) }) });
    assert.equal(await pending, false);
    assert.deepEqual(app.redirects, []);
  } finally {
    app.ui.destroy();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

const ongoingMetadata={...anonymous,firstConnections:true,ongoingEnrollment:true,discoveryReady:false};
function ongoingUrl(discovery=false){const url=new URL(authorizeUrl({create:!discovery}));url.searchParams.set('nonce',(discovery?'discover_':'enroll_create_')+'n'.repeat(43));return url.href;}
test('ongoing UI discovers ordinary identity before exposing separate Create acknowledgement',async()=>{
 const url=ongoingUrl(true),app=harness([ongoingMetadata,{url}]);await app.ui.ready;
 assert.equal(app.node('pixel-account-discover').hidden,false);assert.equal(app.node('pixel-account-create').hidden,true);assert.equal(app.ui.openCreateConfirmation(),false);assert.equal(await app.ui.startCreate(),false);
 assert.equal(await app.ui.startDiscovery(),true);assert.deepEqual(app.redirects,[url]);assert.equal(app.requests[1].url,'/api/auth/pixel-pulse/discover');assert.equal(app.requests[1].options.body,'{}');assert.equal(new URL(url).searchParams.has('pixel_intent'),false);assert.equal(app.node('profile-name').textContent,'Guest striker');app.ui.destroy();
});
test('browser-bound discovery permits only a NEW explicit fresh Create flow and expires locally',async()=>{
 const ready={...ongoingMetadata,discoveryReady:true,discoveryExpiresAt:new Date(NOW+30000).toISOString()},url=ongoingUrl(),app=harness([ready,{url}]);await app.ui.ready;
 assert.equal(app.node('pixel-account-create').hidden,false);assert.equal(await app.ui.startCreate(),false);assert.equal(app.ui.openCreateConfirmation(),true);assert.equal(await app.ui.startCreate(),true);assert.deepEqual(app.redirects,[url]);assert.equal(app.requests[1].options.body,JSON.stringify({intent:'create',acknowledgeSeparateProfile:true}));app.ui.destroy();
 const expiring=harness([ready]);await expiring.ui.ready;[...expiring.timers.values()][0].callback();assert.equal(expiring.node('pixel-account-create').hidden,true);assert.equal(expiring.ui.openCreateConfirmation(),false);assert.equal(expiring.node('pixel-account-discover').hidden,false);expiring.ui.destroy();
});
test('malformed/expired/overlong discovery metadata never exposes Create',async()=>{
 for(const expiry of [undefined,'invalid',new Date(NOW).toISOString(),new Date(NOW+300001).toISOString()]){const app=harness([{...ongoingMetadata,discoveryReady:true,discoveryExpiresAt:expiry}]);await app.ui.ready;assert.equal(app.node('pixel-account-create').hidden,true);assert.equal(app.ui.openCreateConfirmation(),false);app.ui.destroy();}
});
test('ordinary discovery and fresh enrollment URL purposes cannot be downgraded or swapped',()=>{
 assert.equal(isPixelAuthorizationUrl(ongoingUrl(true),{intent:'discover'}),true);assert.equal(isPixelAuthorizationUrl(ongoingUrl(),{intent:'create'}),true);
 assert.equal(isPixelAuthorizationUrl(ongoingUrl(true)),false);assert.equal(isPixelAuthorizationUrl(ongoingUrl(true),{intent:'create'}),false);assert.equal(isPixelAuthorizationUrl(ongoingUrl(),{intent:'discover'}),false);
});


test('account failures are explicitly marked red/alert and finally-render preserves the error tone',async()=>{
 const app=harness([anonymous,new Error('offline')]); await app.ui.ready;
 assert.equal(app.node('pixel-account-status').attributes.get('data-tone'),'status');
 assert.equal(await app.ui.startSignIn(),false);
 const status=app.node('pixel-account-status');assert.equal(status.attributes.get('data-tone'),'error');assert.equal(status.attributes.get('role'),'alert');assert.equal(status.attributes.get('aria-live'),'assertive');
 assert.match(status.textContent,/unavailable/);assert.equal(app.node('pixel-account-sign-in').disabled,false);assert.equal(app.node('profile-name').textContent,'Guest striker');
 assert.equal(app.requests.length,2);assert.equal(app.redirects.length,0);app.ui.destroy();
});

test('refused/uncertain returns are errors while discovery and normal result messages stay status text',async()=>{
 for(const notice of ['refused','uncertain','discovered','created','returned']){
  const app=harness([anonymous],{search:'?pixel='+notice});await app.ui.ready;
  assert.equal(app.node('pixel-account-status').attributes.get('data-tone'),['refused','uncertain'].includes(notice)?'error':'status');app.ui.destroy();
 }
 const app=harness([signedIn,{ok:true,authenticated:false}]);await app.ui.ready;assert.equal(await app.ui.endSession(),true);
 assert.equal(app.node('pixel-account-status').attributes.get('data-tone'),'status');assert.equal(app.node('pixel-account-status').attributes.get('role'),'status');app.ui.destroy();
});

test('first Continue during ongoing enrollment starts the existing discovery journey directly',async()=>{const app=harness([ongoingMetadata,{url:ongoingUrl(true)}]);await app.ui.ready;assert.equal(await app.ui.startSignIn(),true);assert.equal(app.requests.at(-1).url,'/api/auth/pixel-pulse/discover');assert.equal(app.redirects[0],ongoingUrl(true));app.ui.destroy();});
test('an unbound discovered callback immediately opens the real separate-profile confirmation',async()=>{const app=harness([{...ongoingMetadata,discoveryReady:true,discoveryExpiresAt:new Date(NOW+30000).toISOString()}],{search:'?pixel=discovered'});await app.ui.ready;assert.equal(app.node('pixel-account-create-confirmation').hidden,false);assert.equal(app.requests.length,1);app.ui.destroy();});

test('a ready unbound journey reopens its choice without repeating Continue or sending another authorization request',async()=>{const app=harness([{...ongoingMetadata,discoveryReady:true,discoveryExpiresAt:new Date(NOW+30000).toISOString()}]);await app.ui.ready;assert.equal(await app.ui.startSignIn(),false);assert.equal(app.node('pixel-account-create-confirmation').hidden,false);assert.equal(app.requests.length,1);app.ui.destroy();});
test('the explicit existing-account choice uses ordinary immutable return and never auto-creates',async()=>{const url=authorizeUrl(),app=harness([{...ongoingMetadata,discoveryReady:true,discoveryExpiresAt:new Date(NOW+30000).toISOString()},{url}]);await app.ui.ready;assert.equal(await app.ui.startSignIn(true),true);assert.equal(app.requests.at(-1).url,'/api/auth/pixel-pulse/start');assert.equal(new URL(app.redirects[0]).searchParams.has('pixel_intent'),false);app.ui.destroy();});

test('header Log out shares the confirmed site-sign-out flow, hides after success and removes its listener on teardown',async()=>{
 const app=harness([signedIn,{ok:true,authenticated:false}]);await app.ui.ready;
 assert.equal(app.node('header-sign-out').hidden,false);assert.equal(app.node('header-sign-out').disabled,false);
 assert.equal(await app.node('header-sign-out').listeners.get('click')(),true);
 assert.equal(app.requests.filter(r=>r.url.endsWith('/sign-out')).length,1);assert.equal(app.node('header-sign-out').hidden,true);
 app.ui.destroy();assert.equal(app.node('header-sign-out').listeners.has('click'),false);
});
test('header Log out remains available when sign-out fails, then hides when the original session expires',async()=>{
 const app=harness([signedIn,new Error('offline')]);await app.ui.ready;
 assert.equal(await app.node('header-sign-out').listeners.get('click')(),false);assert.equal(app.node('header-sign-out').hidden,false);assert.equal(app.node('header-sign-out').disabled,false);
 [...app.timers.values()][0].callback();assert.equal(app.node('header-sign-out').hidden,true);app.ui.destroy();
});
