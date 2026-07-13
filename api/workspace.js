/* ============================================================
   Workspace API — team-shared signatures, zero-auth, fully open.
   Backed by Vercel KV (Upstash Redis-compatible REST API).

   Routes (all hit the same handler):
     POST /api/workspace { action: "create", slug, name }
     GET  /api/workspace?slug=<slug>
     POST /api/workspace { action: "save",   slug, sig: { label, state, id? } }
     POST /api/workspace { action: "delete", slug, id }

   Anyone with the /w/<slug> URL can read AND write — no passcode.

   Storage shape (one JSON blob per workspace):
     ws:<slug> = {
       slug, name,
       signatures: [{ id, label, state, updatedAt }],
       createdAt, updatedAt
     }
   ============================================================ */

const crypto = require('crypto');

/* Vercel's Upstash Redis integration injects KV_REST_API_* ;
   a direct Upstash connection injects UPSTASH_REDIS_REST_* .
   Accept whichever is present. */
const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

/* ----- KV helpers (Upstash REST API) ----- */
async function redis(cmd) {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV not configured (set KV_REST_API_URL + KV_REST_API_TOKEN in Vercel)');
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  return j.result;
}
async function kvGet(key) {
  const result = await redis(['GET', key]);
  return result ? JSON.parse(result) : null;
}
async function kvSet(key, value) {
  return redis(['SET', key, JSON.stringify(value)]);
}
async function kvSetNX(key, value) {
  return redis(['SET', key, JSON.stringify(value), 'NX']);
}

function makeSigId() {
  return 'sig_' + crypto.randomBytes(6).toString('hex');
}

/* ----- slug rules ----- */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set([
  'new', 'admin', 'api', 'w', 'workspace', 'workspaces',
  'settings', 'login', 'logout', 'help', 'about',
  'konpo', 'konpostudio', 'sweet', 'sigs', 'signature',
]);
function validSlug(s) {
  if (!s || typeof s !== 'string') return false;
  s = s.toLowerCase();
  return SLUG_RE.test(s) && !RESERVED.has(s);
}

/* ----- handler ----- */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const slug = String(req.query.slug || '').toLowerCase();
      if (!validSlug(slug)) return res.status(400).json({ error: 'invalid slug' });
      const ws = await kvGet('ws:' + slug);
      if (!ws) return res.status(404).json({ error: 'not found' });
      return res.status(200).json({ workspace: ws });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    /* body may already be parsed by Vercel, or come as a raw string */
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action;
    const slug = String(body.slug || '').toLowerCase();

    /* ---- CREATE ---- */
    if (action === 'create') {
      if (!validSlug(slug)) {
        return res.status(400).json({ error: 'slug must be 3–40 chars, a-z 0-9 or - (cannot start/end with -)' });
      }
      const name = String(body.name || slug).slice(0, 80);
      const now = Date.now();
      const ws = { slug, name, signatures: [], createdAt: now, updatedAt: now };
      const ok = await kvSetNX('ws:' + slug, ws);
      /* Upstash returns "OK" on success, null when NX fails */
      if (!ok) return res.status(409).json({ error: 'that slug is already taken' });
      return res.status(200).json({ workspace: ws });
    }

    /* read the workspace for save / delete */
    if (!validSlug(slug)) return res.status(400).json({ error: 'invalid slug' });
    const ws = await kvGet('ws:' + slug);
    if (!ws) return res.status(404).json({ error: 'workspace not found' });

    /* ---- SAVE (insert or update) ---- */
    if (action === 'save') {
      const sig = body.sig || {};
      const label = String(sig.label || 'Untitled').slice(0, 80);
      const state = sig.state;
      if (!state || typeof state !== 'object') return res.status(400).json({ error: 'state required' });
      const id = sig.id || makeSigId();
      const now = Date.now();
      const idx = (ws.signatures || []).findIndex(s => s.id === id);
      const entry = { id, label, state, updatedAt: now };
      if (idx >= 0) ws.signatures[idx] = entry;
      else (ws.signatures = ws.signatures || []).unshift(entry);
      /* cap at 200 sigs per workspace */
      if (ws.signatures.length > 200) ws.signatures = ws.signatures.slice(0, 200);
      ws.updatedAt = now;
      await kvSet('ws:' + slug, ws);
      return res.status(200).json({ workspace: ws, saved: entry });
    }

    /* ---- DELETE ---- */
    if (action === 'delete') {
      const id = String(body.id || '');
      ws.signatures = (ws.signatures || []).filter(s => s.id !== id);
      ws.updatedAt = Date.now();
      await kvSet('ws:' + slug, ws);
      return res.status(200).json({ workspace: ws });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    /* A missing/uninstalled KV store surfaces as a DNS failure — make it legible. */
    const cause = e && e.cause && (e.cause.code || e.cause.message);
    if (cause === 'ENOTFOUND' || cause === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'workspace storage is not connected — reconnect the Upstash Redis store in Vercel' });
    }
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
