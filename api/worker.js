// Wiserax Games API: likes, comments and counters for wiserax.dev/games.
// Cloudflare Worker + D1. No logins: visitors are an anonymous random id, abuse is
// limited per hashed IP (the raw IP is never stored).
//
// All POST bodies are JSON sent as text/plain, so browsers skip the CORS preflight
// and navigator.sendBeacon works for play clicks.

const DAY = 86400;
const LIMITS = {
  commentsPer10Min: 3,
  commentsPerDay: 15,
  commentsSiteWidePerDay: 400, // beyond this new comments wait for review
  likesPerIpPerDay: 60,
  nameMax: 24,
  bodyMin: 2,
  bodyMax: 400,
  minMsOnPage: 2500,
  powBits: 16,
  reportsToHide: 3,
};

const VISITOR = /^[a-z0-9-]{16,40}$/;
const LINKY = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ru|xyz|top|io|co|info|biz|shop|site|online|link|click|cc|me)\b|t\.me\/|@[a-z0-9_]{4,}\b)/i;
const NASTY = /\b(porn|xxx|casino|viagra|cialis|crypto ?airdrop|onlyfans|escort|loan|bitcoin doubler)\b/i;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error(e);
      return json({ error: 'server error' }, 500, cors);
    }
  },

  // daily tidy: drop the per-day dedupe keys once they are 3 days old
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM seen WHERE at < ?').bind(now() - 3 * DAY).run();
  },
};

async function route(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const games = (env.GAMES || 'site').split(',');
  if (req.method === 'GET' && p === '/api/stats') return stats(env, games);
  if (req.method === 'GET' && p === '/api/comments') return listComments(env, games, url);
  if (req.method === 'POST' && p === '/api/hit') return hit(req, env, games);
  if (req.method === 'POST' && p === '/api/like') return like(req, env, games);
  if (req.method === 'POST' && p === '/api/comments') return postComment(req, env, games);
  if (req.method === 'POST' && p === '/api/report') return report(req, env);
  if (p.startsWith('/api/admin/')) return admin(req, env, url, p);
  if (p === '' || p === '/api') return json({ ok: true, name: 'wiserax-games-api' });
  throw new HttpError(404, 'not found');
}

// ---------- reads ----------

async function stats(env, games) {
  const { results } = await env.DB.prepare('SELECT game, kind, n FROM counters').all();
  const out = {};
  for (const g of games) out[g] = { view: 0, play: 0, like: 0, comment: 0 };
  for (const r of results) if (out[r.game]) out[r.game][r.kind] = r.n;
  return json({ games: out }, 200, { 'Cache-Control': 'public, max-age=10' });
}

async function listComments(env, games, url) {
  const game = url.searchParams.get('game');
  if (!games.includes(game)) throw new HttpError(400, 'unknown game');
  const limit = Math.min(50, Math.max(1, +url.searchParams.get('limit') || 30));
  const before = +url.searchParams.get('before') || 2 ** 52;
  const { results } = await env.DB.prepare(
    "SELECT id, name, body, at FROM comments WHERE game = ? AND status = 'visible' AND id < ? ORDER BY id DESC LIMIT ?",
  ).bind(game, before, limit).all();
  return json({ comments: results }, 200, { 'Cache-Control': 'public, max-age=5' });
}

// ---------- writes ----------

async function hit(req, env, games) {
  const b = await body(req);
  const kind = b.kind === 'play' ? 'play' : 'view';
  if (!games.includes(b.game)) throw new HttpError(400, 'unknown game');
  const ip = await ipHash(req, env);
  const day = Math.floor(now() / DAY);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO seen (key, at) VALUES (?, ?)')
    .bind(`${kind}:${b.game}:${ip}:${day}`, now()).run();
  if (r.meta.changes) await bump(env, b.game, kind, 1);
  return json({ ok: true, counted: !!r.meta.changes });
}

async function like(req, env, games) {
  const b = await body(req);
  if (!games.includes(b.game) || b.game === 'site') throw new HttpError(400, 'unknown game');
  if (!VISITOR.test(b.visitor || '')) throw new HttpError(400, 'bad visitor');
  const ip = await ipHash(req, env);
  if (b.on === false) {
    const r = await env.DB.prepare('DELETE FROM likes WHERE game = ? AND visitor = ?').bind(b.game, b.visitor).run();
    if (r.meta.changes) await bump(env, b.game, 'like', -1);
  } else {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM likes WHERE ip = ? AND at > ?')
      .bind(ip, now() - DAY).first();
    if (recent.n >= LIMITS.likesPerIpPerDay) throw new HttpError(429, 'easy there, that is a lot of love for one day');
    const r = await env.DB.prepare('INSERT OR IGNORE INTO likes (game, visitor, ip, at) VALUES (?, ?, ?, ?)')
      .bind(b.game, b.visitor, ip, now()).run();
    if (r.meta.changes) await bump(env, b.game, 'like', 1);
  }
  const row = await env.DB.prepare("SELECT n FROM counters WHERE game = ? AND kind = 'like'").bind(b.game).first();
  return json({ likes: row ? row.n : 0, liked: b.on !== false });
}

async function postComment(req, env, games) {
  const b = await body(req);
  if (!games.includes(b.game) || b.game === 'site') throw new HttpError(400, 'unknown game');
  if (!VISITOR.test(b.visitor || '')) throw new HttpError(400, 'bad visitor');
  const name = clean(b.name).slice(0, LIMITS.nameMax) || 'anon';
  const text = clean(b.body);
  if (text.length < LIMITS.bodyMin) throw new HttpError(400, 'say a little more');
  if (text.length > LIMITS.bodyMax) throw new HttpError(400, `keep it under ${LIMITS.bodyMax} characters`);
  if (!(+b.ms >= LIMITS.minMsOnPage)) throw new HttpError(400, 'too fast, are you a robot?');
  await checkPow(b, env);
  if (env.TURNSTILE_SECRET) await checkTurnstile(req, b, env);

  const ip = await ipHash(req, env);
  const t = now();
  const lim = await env.DB.prepare(
    'SELECT SUM(at > ?) AS m10, COUNT(*) AS d, SUM(body = ?) AS dup FROM comments WHERE ip = ? AND at > ?',
  ).bind(t - 600, text, ip, t - DAY).first();
  if (lim.dup) throw new HttpError(409, 'you already said that');
  if (lim.m10 >= LIMITS.commentsPer10Min || lim.d >= LIMITS.commentsPerDay)
    throw new HttpError(429, 'slow down a little, try again later');

  let status = 'visible';
  if (b.website) status = 'spam'; // honeypot field humans never see
  else if (LINKY.test(text) || LINKY.test(name) || NASTY.test(text) || NASTY.test(name)) status = 'held';
  else {
    const site = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE at > ?').bind(t - DAY).first();
    if (site.n >= LIMITS.commentsSiteWidePerDay) status = 'held';
  }
  const r = await env.DB.prepare(
    'INSERT INTO comments (game, name, body, at, ip, visitor, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(b.game, name, text, t, ip, b.visitor, status).run();
  if (status === 'visible') await bump(env, b.game, 'comment', 1);
  // spam gets the same answer as a held comment so bots learn nothing
  return json({ id: r.meta.last_row_id, status: status === 'spam' ? 'held' : status, comment: { id: r.meta.last_row_id, name, body: text, at: t } });
}

async function report(req, env) {
  const b = await body(req);
  if (!VISITOR.test(b.visitor || '') || !(+b.id > 0)) throw new HttpError(400, 'bad report');
  const r = await env.DB.prepare('INSERT OR IGNORE INTO reports (comment, visitor) VALUES (?, ?)').bind(+b.id, b.visitor).run();
  if (r.meta.changes) {
    await env.DB.prepare('UPDATE comments SET reports = reports + 1 WHERE id = ?').bind(+b.id).run();
    const c = await env.DB.prepare('SELECT game, status, reports FROM comments WHERE id = ?').bind(+b.id).first();
    if (c && c.status === 'visible' && c.reports >= LIMITS.reportsToHide) await setStatus(env, +b.id, 'hidden');
  }
  return json({ ok: true });
}

// ---------- admin (Bearer ADMIN_TOKEN) ----------

async function admin(req, env, url, p) {
  const auth = req.headers.get('Authorization') || '';
  if (!env.ADMIN_TOKEN || !(await sameText(auth, `Bearer ${env.ADMIN_TOKEN}`))) throw new HttpError(401, 'no');
  if (req.method === 'GET' && p === '/api/admin/comments') {
    const status = url.searchParams.get('status') || 'held';
    const { results } = await env.DB.prepare(
      'SELECT id, game, name, body, at, status, reports FROM comments WHERE status = ? ORDER BY id DESC LIMIT 100',
    ).bind(status).all();
    return json({ comments: results });
  }
  const m = p.match(/^\/api\/admin\/comments\/(\d+)$/);
  if (req.method === 'POST' && m) {
    const b = await body(req);
    if (!['visible', 'held', 'hidden', 'spam'].includes(b.status)) throw new HttpError(400, 'bad status');
    await setStatus(env, +m[1], b.status);
    return json({ ok: true });
  }
  throw new HttpError(404, 'not found');
}

async function setStatus(env, id, status) {
  const c = await env.DB.prepare('SELECT game, status FROM comments WHERE id = ?').bind(id).first();
  if (!c || c.status === status) return;
  await env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(status, id).run();
  if (c.status === 'visible') await bump(env, c.game, 'comment', -1);
  if (status === 'visible') await bump(env, c.game, 'comment', 1);
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => Math.floor(Date.now() / 1000);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ORIGINS || '').split(',').map((s) => s.trim());
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

async function body(req) {
  const t = await req.text();
  if (t.length > 4000) throw new HttpError(413, 'too long');
  try { return JSON.parse(t || '{}'); } catch { throw new HttpError(400, 'bad json'); }
}

async function bump(env, game, kind, d) {
  await env.DB.prepare(
    'INSERT INTO counters (game, kind, n) VALUES (?, ?, MAX(0, ?)) ON CONFLICT(game, kind) DO UPDATE SET n = MAX(0, n + ?)',
  ).bind(game, kind, d, d).run();
}

// strip control characters and invisible tricks, collapse spaces
function clean(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function ipHash(req, env) {
  // TRUST_XFF only in local dev (.dev.vars) so tests can fake many visitors
  const xff = env.TRUST_XFF === '1' && req.headers.get('X-Forwarded-For');
  const ip = xff || req.headers.get('CF-Connecting-IP') || 'local';
  return (await sha256Hex(`${env.IP_SALT || 'dev-salt'}|${ip}`)).slice(0, 20);
}

async function sameText(a, b) {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return x === y;
}

// proof of work: sha256(game|name|body|ts|nonce) must start with powBits zero bits
async function checkPow(b, env) {
  const ts = +b.ts;
  if (!(Math.abs(Date.now() - ts) < 15 * 60 * 1000)) throw new HttpError(400, 'stale form, reload the page');
  const h = await sha256Hex(`${b.game}|${b.name || ''}|${b.body || ''}|${ts}|${b.nonce}`);
  const bits = Math.min(30, Math.max(1, +(env.POW_BITS || LIMITS.powBits)));
  if (parseInt(h.slice(0, 8), 16) >>> (32 - bits)) throw new HttpError(400, 'check failed, reload the page');
}

async function checkTurnstile(req, b, env) {
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', b.turnstile || '');
  form.append('remoteip', req.headers.get('CF-Connecting-IP') || '');
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const d = await r.json();
  if (!d.success) throw new HttpError(400, 'human check failed, try again');
}
