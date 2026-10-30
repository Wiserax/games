// End-to-end checks against a running API: node test.mjs [base] (default local wrangler dev).
// Uses POW_BITS=12 from .dev.vars locally. Each run uses fresh fake IPs via X-Forwarded-For.
import { createHash, randomUUID } from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const BITS = +(process.env.POW_BITS || 12);
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : fail++, console.log(`${c ? 'PASS' : 'FAIL'} ${m}`));

async function call(method, path, data, ip = `10.0.0.${run}`, extra = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'text/plain', 'X-Forwarded-For': ip, Origin: 'https://wiserax.dev', ...extra },
    body: data ? JSON.stringify(data) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { s: r.status, j, h: r.headers };
}

function pow(game, name, body, ts) {
  for (let n = 0; ; n++) {
    const h = createHash('sha256').update(`${game}|${name}|${body}|${ts}|${n}`).digest();
    if (h.readUInt32BE(0) >>> (32 - BITS) === 0) return n;
  }
}
const comment = (game, name, body, visitor, more = {}) => {
  const ts = Date.now();
  return { game, name, body, visitor, ts, nonce: pow(game, name, body, ts), ms: 5000, ...more };
};

const v1 = randomUUID(), v2 = randomUUID();
const before = (await call('GET', '/api/stats')).j.games;

// views count once per ip per day
let a = await call('POST', '/api/hit', { game: 'zt', kind: 'view' });
let b = await call('POST', '/api/hit', { game: 'zt', kind: 'view' });
ok(a.j.counted && !b.j.counted, 'view counts once per visitor per day');
await call('POST', '/api/hit', { game: 'zt', kind: 'play' });
let s = (await call('GET', '/api/stats')).j.games;
ok(s.zt.view === before.zt.view + 1 && s.zt.play === before.zt.play + 1, 'stats show the view and the play');
ok((await call('POST', '/api/hit', { game: 'nope' })).s === 400, 'unknown game rejected');

// likes toggle, idempotent
a = await call('POST', '/api/like', { game: 'graft', visitor: v1 });
b = await call('POST', '/api/like', { game: 'graft', visitor: v1 });
ok(a.j.likes === before.graft.like + 1 && b.j.likes === a.j.likes, 'like counts once per visitor');
a = await call('POST', '/api/like', { game: 'graft', visitor: v1, on: false });
ok(a.j.likes === before.graft.like, 'unlike takes it back');
ok((await call('POST', '/api/like', { game: 'graft', visitor: 'x' })).s === 400, 'bad visitor id rejected');

// comments
const c1 = await call('POST', '/api/comments', comment('necro', 'Mila', `skeleton army on a phone ${run}`, v1));
ok(c1.s === 200 && c1.j.status === 'visible', 'plain comment is visible');
let list = (await call('GET', '/api/comments?game=necro')).j.comments;
ok(list[0] && list[0].id === c1.j.id && list[0].name === 'Mila' && !('ip' in list[0]), 'listed newest first, no ip leaked');
ok((await call('POST', '/api/comments', { ...comment('necro', 'x', 'bad nonce here', v1), nonce: -1 })).s === 400, 'bad proof of work rejected');
ok((await call('POST', '/api/comments', comment('necro', 'x', 'too quick', v1, { ms: 300 }))).s === 400, 'instant submit rejected');
ok((await call('POST', '/api/comments', comment('necro', 'x', `skeleton army on a phone ${run}`, v1))).s === 409, 'duplicate rejected');
const link = await call('POST', '/api/comments', comment('necro', 'bot', 'cheap pills at spam.xyz', v2, {}), `10.1.0.${run}`);
ok(link.j.status === 'held', 'comment with a link is held');
const hp = await call('POST', '/api/comments', comment('necro', 'bot', 'nice game friend', v2, { website: 'x' }), `10.2.0.${run}`);
ok(hp.j.status === 'held', 'honeypot answers held (stored as spam)');
list = (await call('GET', '/api/comments?game=necro')).j.comments;
ok(!list.some((c) => c.id === link.j.id || c.id === hp.j.id), 'held and spam are not listed');
const long = await call('POST', '/api/comments', comment('necro', 'x', 'a'.repeat(401), v1), `10.3.0.${run}`);
ok(long.s === 400, 'over-long comment rejected');

// rate limit: 3 per 10 minutes per ip
const ip = `10.4.0.${run}`;
const codes = [];
for (let i = 0; i < 4; i++) codes.push((await call('POST', '/api/comments', comment('zt', 'r', `message number ${i}`, v2), ip)).s);
ok(codes.join() === '200,200,200,429', `rate limit after 3 (${codes.join()})`);

// reports: 3 different visitors hide it
const target = (await call('POST', '/api/comments', comment('zt', 'troll', 'meh game', v2), `10.5.0.${run}`)).j.id;
for (let i = 0; i < 3; i++) await call('POST', '/api/report', { id: target, visitor: randomUUID() });
list = (await call('GET', '/api/comments?game=zt')).j.comments;
ok(!list.some((c) => c.id === target), '3 reports hide a comment');

// admin
ok((await call('GET', '/api/admin/comments?status=held')).s === 401, 'admin needs the token');
const auth = { Authorization: 'Bearer dev-admin' };
const held = (await call('GET', '/api/admin/comments?status=held', null, undefined, auth)).j.comments;
ok(held.some((c) => c.id === link.j.id), 'admin sees held comments');
await call('POST', `/api/admin/comments/${link.j.id}`, { status: 'visible' }, undefined, auth);
list = (await call('GET', '/api/comments?game=necro')).j.comments;
ok(list.some((c) => c.id === link.j.id), 'admin approval makes it visible');
s = (await call('GET', '/api/stats')).j.games;
ok(s.necro.comment === before.necro.comment + 2, `comment counter follows status (${s.necro.comment - before.necro.comment})`);

// cors
const h = await call('GET', '/api/stats');
const evil = await call('GET', '/api/stats', null, undefined, { Origin: 'https://evil.example' });
ok(h.h.get('access-control-allow-origin') === 'https://wiserax.dev' && !evil.h.get('access-control-allow-origin'), 'CORS only for wiserax.dev');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
