// A bounded per-worker circuit breaker, supplemented by storage ceilings.
// This is not an account-wide or distributed edge rate-limit guarantee.
export function createAbuseGuard({ clock = Date.now, windowMs = 60_000, maximumKeys = 512, perKey = 12, total = 120 } = {}) {
  const entries = new Map();
  let windowEnd = 0, used = 0;
  return Object.freeze({
    admit(key, cost = 1) {
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(cost) || cost < 1 || cost > perKey ||
          !/^(?:anonymous|[a-f0-9]{64})$/.test(key)) return false;
      if (now >= windowEnd) { entries.clear(); used = 0; windowEnd = now + windowMs; }
      if (used + cost > total || (!entries.has(key) && entries.size >= maximumKeys)) return false;
      const current = entries.get(key) || 0;
      if (current + cost > perKey) return false;
      entries.set(key, current + cost); used += cost;
      return true;
    },
  });
}
