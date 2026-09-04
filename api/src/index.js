// Live share link for one person's budget. Runs on Cloudflare Workers with D1
// for storage.
//
// Deliberately small on auth, the same trade the Lose It group board makes:
// creating a share hands back a token that authenticates the owner's app for
// every future push, and the code in the link is the only thing gating who
// can view it. That is proportionate to sharing a household budget with a
// spouse - nobody has to make an account - but it is not a secret in any
// strong sense: anyone who gets the link can see the snapshot, with no way to
// write to it (only the owner's token can PUT). Share it the way you would a
// house key.

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

// No 0/O/1/I, because these get read aloud and typed by hand.
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SNAPSHOT_BYTES = 200 * 1024;

function cors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400'
  };
}

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...cors(origin) } });
}

function fail(message, status, origin) {
  return json({ error: message }, status, origin);
}

function randomCode(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Comparison that does not leak where two tokens first differ.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7) : '';
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const code = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!code || !secret) return null;

  const row = await env.DB.prepare('SELECT code, token_hash FROM shares WHERE code = ?').bind(code).first();
  if (!row) return null;
  if (!safeEqual(row.token_hash, await sha256(secret))) return null;
  return row;
}

async function createShare(request, env, origin) {
  const body = await request.json().catch(() => ({}));
  const label = String(body.label || '').trim().slice(0, 60);
  const now = Date.now();

  let code = null;
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = randomCode();
    const taken = await env.DB.prepare('SELECT 1 FROM shares WHERE code = ?').bind(candidate).first();
    if (!taken) code = candidate;
  }
  if (!code) return fail('Could not allocate a share code, try again', 503, origin);

  const secret = randomToken();
  await env.DB.prepare(
    'INSERT INTO shares (code, token_hash, label, snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(code, await sha256(secret), label, '{}', now, now).run();

  return json({ code, token: `${code}.${secret}` }, 201, origin);
}

async function putSnapshot(request, share, env, origin) {
  const body = await request.json().catch(() => ({}));
  const snapshotJson = JSON.stringify(body.snapshot ?? {});
  if (snapshotJson.length > MAX_SNAPSHOT_BYTES) return fail('That budget is too large to sync', 413, origin);

  const now = Date.now();
  await env.DB.prepare('UPDATE shares SET snapshot_json = ?, updated_at = ? WHERE code = ?')
    .bind(snapshotJson, now, share.code).run();
  return json({ ok: true, updatedAt: now }, 200, origin);
}

async function getView(env, code, origin) {
  const row = await env.DB.prepare('SELECT label, snapshot_json, updated_at FROM shares WHERE code = ?').bind(code).first();
  if (!row) return fail('No budget is shared at this link', 404, origin);
  let snapshot = {};
  try {
    snapshot = JSON.parse(row.snapshot_json || '{}');
  } catch {
    // Malformed or empty - show an empty budget rather than an error.
  }
  return json({ label: row.label, snapshot, updatedAt: row.updated_at }, 200, origin);
}

async function deleteShare(share, env, origin) {
  await env.DB.prepare('DELETE FROM shares WHERE code = ?').bind(share.code).run();
  return json({ ok: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    try {
      if (path === '/' || path === '/api') {
        return json({ ok: true, service: 'budget-tracker-share' }, 200, origin);
      }

      if (path === '/api/share' && method === 'POST') return await createShare(request, env, origin);

      if (path.startsWith('/api/view/') && method === 'GET') {
        return await getView(env, decodeURIComponent(path.slice('/api/view/'.length)), origin);
      }

      if (path === '/api/share' && (method === 'PUT' || method === 'DELETE')) {
        const share = await authenticate(request, env);
        if (!share) return fail('Not authorized', 401, origin);
        return method === 'PUT' ? await putSnapshot(request, share, env, origin) : await deleteShare(share, env, origin);
      }

      return fail('Not found', 404, origin);
    } catch (err) {
      return fail(err?.message || 'Server error', 500, origin);
    }
  }
};
