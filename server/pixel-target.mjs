const approvedConfigs = new WeakSet();
const rolePattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const databasePattern = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export class PixelTargetError extends Error {
  constructor(code = 'PIXEL_TARGET_CONFIG') {
    super('Pixel sign-in storage is not ready.');
    this.name = 'PixelTargetError';
    this.code = code;
    this.status = 503;
  }
}

const reject = () => { throw new PixelTargetError(); };
const required = (env, name) => typeof env[name] === 'string' && env[name] && env[name] === env[name].trim() ? env[name] : reject();
const normalizeHost = host => host.replace(/^\[|\]$/g, '').toLowerCase();
const validRemoteHost = host => {
  if (host.length > 253) return false;
  const labels = host.split('.');
  if (labels.every(label => /^[0-9]+$/.test(label))) {
    return labels.length === 4 && labels.every(label => /^(0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255) && labels[0] !== '127' && host !== '0.0.0.0';
  }
  return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
};

/** Dedicated, explicitly approved target only. Never reads ambient PG settings. */
export function readTargetConfig(env = process.env) {
  try {
    if (env.REMATCH_PIXEL_TARGET_APPROVED !== 'true') reject();
    const raw = required(env, 'REMATCH_PIXEL_DATABASE_URL');
    if (raw.length > 8192 || raw.includes('#') || raw.includes('?') || /[\r\n\t]/.test(raw)) reject();
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) reject();
    const host = normalizeHost(url.hostname);
    const approvedHostRaw = required(env, 'REMATCH_PIXEL_APPROVED_HOST');
    const approvedHost = normalizeHost(approvedHostRaw);
    if (approvedHostRaw !== approvedHost && approvedHostRaw !== `[${approvedHost}]`) reject();
    if (!host || host !== approvedHost || (!loopbackHosts.has(host) && !validRemoteHost(host))) reject();
    const approvedPortRaw = required(env, 'REMATCH_PIXEL_APPROVED_PORT');
    if (!/^[1-9][0-9]{0,4}$/.test(approvedPortRaw)) reject();
    const port = Number(url.port || 5432);
    if (port !== Number(approvedPortRaw) || port > 65535) reject();
    const database = decodeURIComponent(url.pathname.slice(1));
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const approvedDatabase = required(env, 'REMATCH_PIXEL_APPROVED_DATABASE');
    const approvedRole = required(env, 'REMATCH_PIXEL_APPROVED_ROLE');
    const history = required(env, 'REMATCH_PIXEL_APPROVED_HISTORY');
    if (!databasePattern.test(database) || !rolePattern.test(user) || database !== approvedDatabase || user !== approvedRole || !digestPattern.test(history)) reject();
    const localTest = env.NODE_ENV === 'test' && env.REMATCH_PIXEL_LOCAL_TEST_MODE === 'true';
    if (env.REMATCH_PIXEL_LOCAL_TEST_MODE === 'true' && !localTest) reject();
    if (loopbackHosts.has(host)) {
      if (!localTest || !/^rematch_pixel_test_[a-f0-9]+$/.test(database)) reject();
    } else {
      if (localTest || !password) reject();
    }
    const ownedSocket = env.REMATCH_PIXEL_OWNED_SOCKET;
    if (ownedSocket !== undefined && (!localTest || !loopbackHosts.has(host) || typeof ownedSocket !== 'string' ||
        !/^\/private\/tmp\/rematch-enrollment-pg-[A-Za-z0-9]{6,}\/socket$/.test(ownedSocket))) reject();
    const connection = Object.freeze({ host: ownedSocket || host, port, database, user, password, ssl: localTest ? false : Object.freeze({ rejectUnauthorized: true }) });
    const pins = Object.freeze({ host, port, database, role: user, history });
    const config = Object.freeze({ connection, pins, localTest, ...(ownedSocket ? { ownedSocket } : {}), schema: 'rematch_pixel', contractVersion: 1 });
    approvedConfigs.add(config);
    return config;
  } catch {
    throw new PixelTargetError();
  }
}

export function assertTargetConfig(config) {
  if (!config || !approvedConfigs.has(config)) throw new PixelTargetError();
  return config;
}
