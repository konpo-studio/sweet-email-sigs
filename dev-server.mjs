/* ============================================================
   Local dev server — emulates just enough of Vercel to run
   this app without `vercel dev`:

     • static files with cleanUrls  (/new → new.html)
     • rewrites from vercel.json    (/w/:slug → /)
     • api/workspace.js + api/shorten.js mounted as handlers
     • a local KV endpoint (/__kv) speaking the Upstash REST
       command shape, persisted to .cache/kv.json — so
       api/workspace.js runs UNMODIFIED, same code as prod.

   Usage:  node dev-server.mjs   (PORT env optional, default 5188)
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5188;

/* ----- point the API code at our local KV before loading it ----- */
process.env.KV_REST_API_URL = `http://127.0.0.1:${PORT}/__kv`;
process.env.KV_REST_API_TOKEN = 'local-dev';

const require = createRequire(import.meta.url);
const workspaceHandler = require('./api/workspace.js');            // CJS
const { default: shortenHandler } = await import('./api/shorten.js'); // ESM

/* ----- local KV store (Upstash REST command shape) ----- */
const KV_FILE = path.join(ROOT, '.cache', 'kv.json');
function kvLoad() {
  try { return JSON.parse(fs.readFileSync(KV_FILE, 'utf8')); } catch { return {}; }
}
function kvSave(store) {
  fs.mkdirSync(path.dirname(KV_FILE), { recursive: true });
  fs.writeFileSync(KV_FILE, JSON.stringify(store, null, 2));
}
function kvExec(cmd) {
  const store = kvLoad();
  const [op, key, value, flag] = cmd;
  switch (String(op).toUpperCase()) {
    case 'PING': return 'PONG';
    case 'GET': return store[key] ?? null;
    case 'SET':
      if (String(flag).toUpperCase() === 'NX' && key in store) return null;
      store[key] = value;
      kvSave(store);
      return 'OK';
    case 'DEL': {
      const had = key in store;
      delete store[key];
      kvSave(store);
      return had ? 1 : 0;
    }
    default: throw new Error(`unsupported command: ${op}`);
  }
}

/* ----- Vercel-style req/res shims ----- */
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}
async function runVercelHandler(handler, req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  const raw = await readBody(req);
  if (raw && (req.headers['content-type'] || '').includes('application/json')) {
    try { req.body = JSON.parse(raw); } catch { req.body = raw; }
  } else {
    req.body = raw || undefined;
  }
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return handler(req, res);
}

/* ----- static files ----- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};
function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}
function resolveStatic(pathname) {
  const clean = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, clean);
  if (!full.startsWith(ROOT)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  /* cleanUrls: /new → new.html */
  if (fs.existsSync(full + '.html')) return full + '.html';
  return null;
}

/* ----- server ----- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  try {
    if (p === '/__kv') {
      const raw = await readBody(req);
      let result;
      try { result = kvExec(JSON.parse(raw)); }
      catch (e) { res.statusCode = 400; return res.end(JSON.stringify({ error: e.message })); }
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ result }));
    }
    if (p === '/api/workspace') return await runVercelHandler(workspaceHandler, req, res, url);
    if (p === '/api/shorten')  return await runVercelHandler(shortenHandler, req, res, url);

    /* rewrites from vercel.json: /w/:slug → / */
    let pathname = p;
    if (/^\/w\/[^/]+$/.test(pathname)) pathname = '/';
    if (pathname === '/') pathname = '/index.html';

    const file = resolveStatic(pathname);
    if (file) return sendFile(res, file);

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('404 not found');
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Sweet & Simple Sigs dev server → http://localhost:${PORT}`);
  console.log(`KV store persisted at ${path.relative(ROOT, KV_FILE)}`);
});
