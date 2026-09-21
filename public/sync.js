// Client for two-way sync between your own devices. Unlike share.js (one
// owner, any number of anonymous read-only viewers), this is the same app
// running on two devices you own, each able to read AND write - so reading
// requires the same secret token as writing, not just the code a share link
// uses. Every call here is best-effort: sync is optional and the app works
// fully offline without it, so a failure to reach the server must never
// block editing income, budgets, or expenses.

const SYNC_REQUEST_TIMEOUT = 12000;

const sync = {
  async config() {
    return db.getSync();
  },

  async isEnabled() {
    const s = await db.getSync();
    return Boolean(s && s.serverUrl && s.code && s.token && s.enabled);
  },

  base(serverUrl) {
    return String(serverUrl || '').trim().replace(/\/+$/, '');
  },

  async request(path, { method = 'GET', body, serverUrl, token } = {}) {
    const s = await db.getSync();
    const base = this.base(serverUrl || (s && s.serverUrl));
    if (!base) throw new Error('No server address set');
    const auth = token !== undefined ? token : (s && s.token);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT);
    try {
      const res = await fetch(base + path, {
        method,
        signal: controller.signal,
        headers: {
          ...(auth ? { authorization: `Bearer ${auth}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        let message = `Server said ${res.status}`;
        try {
          const parsed = await res.json();
          if (parsed && parsed.error) message = parsed.error;
        } catch {
          // A non-JSON error body - the status is all we have.
        }
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The server did not answer in time');
      if (err instanceof TypeError) {
        throw new Error(navigator.onLine
          ? 'Could not reach that address — check it is right and the server is deployed'
          : 'You are offline');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  async json(path, opts) {
    const res = await this.request(path, opts);
    return res.json();
  },

  async probe(serverUrl) {
    const res = await this.request('/', { serverUrl, token: null });
    const info = await res.json();
    if (!info || info.service !== 'budget-tracker-share') {
      throw new Error('That address answered, but it is not a share/sync server');
    }
    return info;
  },

  // Creates a brand-new sync link, on the first device. The code/token it
  // returns is what you type into the second device's "Join existing sync"
  // field to link it - there is no separate account or login.
  async start({ serverUrl, label }) {
    const data = await this.json('/api/sync', {
      method: 'POST', serverUrl, token: null,
      body: { label }
    });
    const config = {
      serverUrl: this.base(serverUrl),
      code: data.code,
      token: data.token,
      enabled: true,
      lastSyncedAt: null,
      lastRemoteUpdatedAt: 0,
      lastError: ''
    };
    await db.saveSync(config);
    return config;
  },

  // Links this device to a sync already started elsewhere. Verifies the
  // code/secret actually work by pulling the current data, so a typo is
  // caught immediately rather than silently failing on the first push.
  async join({ serverUrl, code, secret }) {
    const token = `${code}.${secret}`;
    const res = await this.json('/api/sync', { method: 'GET', serverUrl, token });
    const config = {
      serverUrl: this.base(serverUrl),
      code,
      token,
      enabled: true,
      lastSyncedAt: Date.now(),
      lastRemoteUpdatedAt: res.updatedAt || 0,
      lastError: ''
    };
    await db.saveSync(config);
    return { config, data: res.data };
  },

  // Unlinks this device only - the sync link itself (and the other device
  // still on it) is untouched unless this was the last/only device, in
  // which case there is simply nobody left pushing to it anymore.
  async stop() {
    return db.clearSync();
  },

  async setEnabled(enabled) {
    const s = await db.getSync();
    if (!s) return null;
    const updated = { ...s, enabled };
    await db.saveSync(updated);
    return updated;
  },

  // Always fetches the full dataset - sync's payload cap is generous enough
  // (it holds full history, not just one month like a share snapshot) that a
  // separate lightweight "has anything changed" endpoint isn't worth adding.
  async pull() {
    if (!(await this.isEnabled())) return { applied: false };
    try {
      const res = await this.json('/api/sync');
      const s = await db.getSync();
      await db.saveSync({ ...s, lastSyncedAt: Date.now(), lastRemoteUpdatedAt: res.updatedAt, lastError: '' });
      return { applied: true, data: res.data, updatedAt: res.updatedAt };
    } catch (err) {
      const s = await db.getSync();
      if (s) await db.saveSync({ ...s, lastError: err.message || 'Could not sync' });
      return { applied: false, error: err.message };
    }
  },

  async push(data) {
    if (!(await this.isEnabled())) return { sent: false };
    try {
      const res = await this.json('/api/sync', { method: 'PUT', body: { data } });
      const s = await db.getSync();
      await db.saveSync({ ...s, lastSyncedAt: Date.now(), lastRemoteUpdatedAt: res.updatedAt, lastError: '' });
      return { sent: true, updatedAt: res.updatedAt };
    } catch (err) {
      const s = await db.getSync();
      if (s) await db.saveSync({ ...s, lastError: err.message || 'Could not sync' });
      return { sent: false, error: err.message };
    }
  }
};
