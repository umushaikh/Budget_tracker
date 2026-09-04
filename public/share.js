// Client for the live share link. Unlike Lose It's Friends board (many
// members, two-way), this is one owner pushing a read-only snapshot that
// anyone with the link can view - so there is no join flow, just a server
// address and a code. Every call here is best-effort: sharing is optional and
// the app works fully offline without it, so a failure to reach the server
// must never block editing income, budgets, or expenses.

const SHARE_REQUEST_TIMEOUT = 12000;

const share = {
  async config() {
    return db.getShare();
  },

  async isEnabled() {
    const s = await db.getShare();
    return Boolean(s && s.serverUrl && s.code && s.token && s.enabled);
  },

  base(serverUrl) {
    return String(serverUrl || '').trim().replace(/\/+$/, '');
  },

  async request(path, { method = 'GET', body, serverUrl, token } = {}) {
    const s = await db.getShare();
    const base = this.base(serverUrl || (s && s.serverUrl));
    if (!base) throw new Error('No server address set');
    const auth = token !== undefined ? token : (s && s.token);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHARE_REQUEST_TIMEOUT);
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
      throw new Error('That address answered, but it is not a share server');
    }
    return info;
  },

  async enable({ serverUrl, label }) {
    const data = await this.json('/api/share', {
      method: 'POST', serverUrl, token: null,
      body: { label }
    });
    const config = {
      serverUrl: this.base(serverUrl),
      code: data.code,
      token: data.token,
      enabled: true,
      lastPushedAt: null,
      lastError: ''
    };
    await db.saveShare(config);
    return config;
  },

  async disable() {
    try {
      await this.request('/api/share', { method: 'DELETE' });
    } catch {
      // Already unreachable or already gone - clear it locally regardless.
    }
    return db.clearShare();
  },

  async setEnabled(enabled) {
    const s = await db.getShare();
    if (!s) return null;
    const updated = { ...s, enabled };
    await db.saveShare(updated);
    return updated;
  },

  // Pushes the fully-computed snapshot (not raw records) so the public
  // viewer never needs its own copy of the budget math - it just renders
  // what this pushed.
  async pushSnapshot(snapshot) {
    if (!(await this.isEnabled())) return { sent: false };
    try {
      await this.request('/api/share', { method: 'PUT', body: { snapshot } });
      const s = await db.getShare();
      await db.saveShare({ ...s, lastPushedAt: Date.now(), lastError: '' });
      return { sent: true };
    } catch (err) {
      const s = await db.getShare();
      if (s) await db.saveShare({ ...s, lastError: err.message || 'Could not sync' });
      return { sent: false, error: err.message };
    }
  }
};
