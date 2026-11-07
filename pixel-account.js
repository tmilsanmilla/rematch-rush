const API = '/api/auth/pixel-pulse';
const ISSUER_ORIGIN = 'https://pixel-pulse-websites.vercel.app';
const CALLBACK = 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';
const MAX_SESSION_MS = 5 * 60 * 1000;

export function isPixelAuthorizationUrl(value, { intent = 'return' } = {}) {
  if (typeof value !== 'string' || value.length > 16384) return false;
  if (!['return', 'create', 'discover'].includes(intent)) return false;
  try {
    const url = new URL(value);
    if (url.origin !== ISSUER_ORIGIN || url.pathname !== '/api/sso/oauth2/authorize' ||
        url.username || url.password || url.hash) return false;
    const fixed = { client_id: 'rematch-rush', redirect_uri: CALLBACK, response_type: 'code', code_challenge_method: 'S256' };
    if (!Object.entries(fixed).every(([key, expected]) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === expected)) return false;
    const keys = ['client_id', 'redirect_uri', 'response_type', 'code_challenge_method', 'code_challenge', 'state', 'nonce', 'scope'];
    if (intent === 'create') keys.push('pixel_intent');
    if ([...url.searchParams.keys()].length !== keys.length || keys.some(key => url.searchParams.getAll(key).length !== 1) ||
        [...url.searchParams.keys()].some(key => !keys.includes(key))) return false;
    if (intent === 'create' && url.searchParams.get('pixel_intent') !== 'link') return false;
    if (!['code_challenge', 'state'].every(key => /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get(key)))) return false;
    if (!(intent === 'create' ? /^(?:create_|enroll_create_)[A-Za-z0-9_-]{43}$/ : intent === 'discover' ? /^discover_[A-Za-z0-9_-]{43}$/ : /^[A-Za-z0-9_-]{43}$/).test(url.searchParams.get('nonce'))) return false;
    const scopes = url.searchParams.get('scope')?.split(' ');
    return url.searchParams.getAll('scope').length === 1 && scopes?.length === 3 && new Set(scopes).size === 3 &&
      ['openid', 'profile', 'email'].every(scope => scopes.includes(scope));
  } catch { return false; }
}

export function initPixelAccountUI({
  document = globalThis.document,
  fetchImpl = globalThis.fetch,
  location = globalThis.location,
  now = () => Date.now(),
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  const root = document?.getElementById('pixel-account');
  const signIn = document?.getElementById('pixel-account-sign-in');
  const signOut = document?.getElementById('pixel-account-sign-out');
  const discover = document?.getElementById('pixel-account-discover');
  const name = document?.getElementById('pixel-account-name');
  const message = document?.getElementById('pixel-account-status');
  const create = document?.getElementById('pixel-account-create');
  const createPanel = document?.getElementById('pixel-account-create-confirmation');
  const confirmCreate = document?.getElementById('pixel-account-create-confirm');
  const cancelCreate = document?.getElementById('pixel-account-create-cancel');
  if (!root || !signIn || !signOut || !name || !message || typeof fetchImpl !== 'function') return null;

  let available = false;
  let authenticated = false;
  let firstConnections = false;
  let ongoingEnrollment = false;
  let discoveryReady = false;
  let confirmingCreate = false;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let sessionVersion = 0;
  let expiryTimer = null;
  let notice;
  try { notice = new URLSearchParams(location?.search || '').get('pixel'); } catch {}
  const uncertain = notice === 'uncertain';
  const noticeText = {
    discovered: 'Identity confirmed. Review Create a separate Rematch profile to continue. No game profile has been created.',
    created: 'Your new Rematch profile is ready. Continue with Pixel Pulse to check your account. Your device progress stays separate.',
    refused: 'The connection was not completed. Guest play remains available.',
    uncertain: 'We could not confirm the connection result. Use Continue with Pixel Pulse to check the original account before creating another profile.',
    returned: 'Continue with Pixel Pulse to check your current Rematch session.',
  }[notice];
  const hasCreateControls = !!(create && createPanel && confirmCreate && cancelCreate);
  root.hidden = true;

  function cancelExpiry() {
    sessionVersion++;
    if (expiryTimer !== null) clearTimer(expiryTimer);
    expiryTimer = null;
  }

  function render(text, tone = 'status') {
    root.hidden = !available;
    signIn.hidden = authenticated;
    signOut.hidden = !authenticated;
    name.hidden = !authenticated;
    signIn.disabled = busy;
    signOut.disabled = busy;
    const canCreate = available && firstConnections && !authenticated && !uncertain && hasCreateControls && (!ongoingEnrollment || discoveryReady);
    if (discover) { discover.hidden = !available || !ongoingEnrollment || !firstConnections || authenticated || uncertain; discover.disabled = busy; }
    if (create) { create.hidden = !canCreate; create.disabled = busy; create.setAttribute('aria-expanded', canCreate && confirmingCreate ? 'true' : 'false'); }
    if (createPanel) createPanel.hidden = !canCreate || !confirmingCreate;
    if (confirmCreate) confirmCreate.disabled = busy;
    if (cancelCreate) cancelCreate.disabled = busy;
    if (text !== undefined) {
      message.textContent = text;
      message.setAttribute('data-tone', tone);
      message.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      message.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    }
    root.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  async function request(path, method = 'GET', body = {}) {
    const options = { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } };
    if (typeof globalThis.AbortSignal?.timeout === 'function') options.signal = globalThis.AbortSignal.timeout(10000);
    if (method === 'POST') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(`${API}/${path}`, options);
    if (!response.ok) throw new Error('PIXEL_REQUEST_UNAVAILABLE');
    const result = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('PIXEL_RESPONSE_INVALID');
    return result;
  }

  function expireSession() {
    expiryTimer = null;
    authenticated = false;
    confirmingCreate = false;
    name.textContent = '';
    render('Your Rematch session ended. Continue again to return to your linked account.');
  }

  async function refresh() {
    const current = ++generation;
    cancelExpiry();
    available = false;
    authenticated = false;
    firstConnections = false;
    ongoingEnrollment = discoveryReady = false;
    confirmingCreate = false;
    busy = false;
    name.textContent = '';
    render('');
    try {
      const result = await request('session');
      if (disposed || current !== generation) return;
      available = result.available === true;
      firstConnections = result.firstConnections === true;
      ongoingEnrollment = result.ongoingEnrollment === true;
      const discoveryExpiry = Date.parse(result.discoveryExpiresAt);
      discoveryReady = ongoingEnrollment && result.discoveryReady === true && Number.isFinite(discoveryExpiry) && discoveryExpiry > now() && discoveryExpiry - now() <= MAX_SESSION_MS;
      if (!available) return render('');
      const expiry = typeof result.sessionExpiresAt === 'number' ? result.sessionExpiresAt : Date.parse(result.sessionExpiresAt);
      const remaining = expiry - now();
      authenticated = result.authenticated === true && Number.isFinite(remaining) && remaining > 0 && remaining <= MAX_SESSION_MS;
      if (authenticated) {
        name.textContent = typeof result.profile?.displayName === 'string' ? result.profile.displayName.trim().slice(0, 80) || 'Pixel player' : 'Pixel player';
        render(uncertain ? 'You have returned to your Rematch account. Your device player profile stays separate.' : 'Signed in to Rematch. Your device player profile stays separate.');
        const session = sessionVersion;
        expiryTimer = setTimer(() => { if (!disposed && session === sessionVersion) expireSession(); }, remaining);
      } else {
        if (discoveryReady) { const session = sessionVersion; expiryTimer = setTimer(() => { if (!disposed && session === sessionVersion) { discoveryReady = false; confirmingCreate = false; render('Identity confirmation expired. Identify with Pixel Pulse again.'); } }, discoveryExpiry - now()); }
        render(noticeText || (result.authenticated === true ? 'Continue again to confirm your current Rematch session.' :
          firstConnections && ongoingEnrollment ? discoveryReady ? 'Identity confirmed. Review Create a separate Rematch profile; your device progress stays separate.' : 'Identify with Pixel Pulse first, then explicitly create a separate Rematch profile.' : firstConnections && hasCreateControls ? 'Return to your linked account, or create a separate Rematch profile with Pixel Pulse.' : 'Return to an already linked account. New connections are unavailable.'), noticeText && ['refused', 'uncertain'].includes(notice) ? 'error' : 'status');
      }
    } catch {
      if (!disposed && current === generation) {
        available = false;
        authenticated = false;
        render('');
      }
    }
  }

  async function startSignIn() {
    if (disposed || busy || !available || authenticated) return false;
    const current = ++generation;
    confirmingCreate = false;
    busy = true;
    render('Opening Pixel Pulse…');
    try {
      const result = await request('start', 'POST');
      if (disposed || current !== generation) return false;
      if (!isPixelAuthorizationUrl(result.url)) throw new Error('PIXEL_HANDOFF_INVALID');
      location.assign(result.url);
      return true;
    } catch {
      if (!disposed && current === generation) render('Pixel sign-in is unavailable right now. Guest play still works.', 'error');
      return false;
    } finally {
      if (!disposed && current === generation) { busy = false; render(); }
    }
  }

  async function startDiscovery() {
    if (disposed || busy || !available || !ongoingEnrollment || !firstConnections || authenticated || uncertain || !discover) return false;
    const current = ++generation; confirmingCreate = false; busy = true; render('Opening Pixel Pulse identity confirmation…');
    try {
      const result = await request('discover', 'POST');
      if (disposed || current !== generation) return false;
      if (!isPixelAuthorizationUrl(result.url, { intent: 'discover' })) throw new Error('PIXEL_HANDOFF_INVALID');
      location.assign(result.url); return true;
    } catch { if (!disposed && current === generation) render('Identity confirmation is unavailable. Guest play still works.', 'error'); return false; }
    finally { if (!disposed && current === generation) { busy = false; render(); } }
  }

  function openCreateConfirmation() {
    if (disposed || busy || !available || !firstConnections || ongoingEnrollment && !discoveryReady || authenticated || uncertain || !hasCreateControls) return false;
    confirmingCreate = true;
    render('Review the separate-profile confirmation before continuing.');
    return true;
  }

  function closeCreateConfirmation() {
    if (disposed || busy) return false;
    confirmingCreate = false;
    render('You can keep playing as a guest or return to your linked account.');
    return true;
  }

  async function startCreate() {
    if (disposed || busy || !available || !firstConnections || ongoingEnrollment && !discoveryReady || authenticated || uncertain || !hasCreateControls || !confirmingCreate) return false;
    const current = ++generation;
    busy = true;
    render('Opening the Pixel Pulse confirmation…');
    try {
      const result = await request('create', 'POST', { intent: 'create', acknowledgeSeparateProfile: true });
      if (disposed || current !== generation) return false;
      if (!isPixelAuthorizationUrl(result.url, { intent: 'create' })) throw new Error('PIXEL_HANDOFF_INVALID');
      location.assign(result.url);
      return true;
    } catch {
      if (!disposed && current === generation) render('Profile creation is unavailable right now. Guest play still works.', 'error');
      return false;
    } finally {
      if (!disposed && current === generation) { busy = false; render(); }
    }
  }

  async function endSession() {
    if (disposed || busy || !available || !authenticated) return false;
    const current = ++generation;
    busy = true;
    render('Signing out of Rematch…');
    try {
      const result = await request('sign-out', 'POST');
      if (disposed || current !== generation) return false;
      if (result.ok !== true || result.authenticated !== false) throw new Error('PIXEL_SIGNOUT_UNCONFIRMED');
      cancelExpiry();
      authenticated = false;
      name.textContent = '';
      render('Signed out of Rematch. Your Pixel Pulse sign-in and device player profile are unchanged.');
      return true;
    } catch {
      if (!disposed && current === generation) render('Could not confirm Rematch sign-out. Please try again.', 'error');
      return false;
    } finally {
      if (!disposed && current === generation) { busy = false; render(); }
    }
  }

  const onDiscover = () => { void startDiscovery(); };
  const onSignIn = () => { void startSignIn(); };
  const onSignOut = () => { void endSession(); };
  const onCreate = () => { openCreateConfirmation(); };
  const onConfirmCreate = () => { void startCreate(); };
  const onCancelCreate = () => { closeCreateConfirmation(); };
  signIn.addEventListener('click', onSignIn);
  discover?.addEventListener('click', onDiscover);
  signOut.addEventListener('click', onSignOut);
  if (hasCreateControls) {
    create.addEventListener('click', onCreate);
    confirmCreate.addEventListener('click', onConfirmCreate);
    cancelCreate.addEventListener('click', onCancelCreate);
  }
  const ready = refresh();
  return {
    ready, refresh, startDiscovery, startSignIn, endSession, openCreateConfirmation, closeCreateConfirmation, startCreate,
    destroy() {
      disposed = true;
      generation++;
      cancelExpiry();
      signIn.removeEventListener('click', onSignIn);
      discover?.removeEventListener('click', onDiscover);
      signOut.removeEventListener('click', onSignOut);
      if (hasCreateControls) {
        create.removeEventListener('click', onCreate);
        confirmCreate.removeEventListener('click', onConfirmCreate);
        cancelCreate.removeEventListener('click', onCancelCreate);
      }
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initPixelAccountUI();
