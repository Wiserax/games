// Wiserax Games: likes, plays, views and comments against the small Cloudflare API.
// Works without it: when <meta name="api"> is empty the social bits stay hidden.
const API = (document.querySelector('meta[name="api"]')?.content || '').replace(/\/$/, '');
const PAGE = document.body.dataset.game || 'site';
const POW_BITS = 16;
const loadedAt = performance.now();

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function visitorId() {
  let v = store.get('wg.visitor', null);
  if (!v || !/^[a-z0-9-]{16,40}$/.test(v)) {
    v = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('wg.visitor', v);
  }
  return v;
}
const VISITOR = visitorId();

// text/plain bodies keep these "simple" requests: no CORS preflight, beacon-friendly
async function post(path, data) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'something went wrong');
  return j;
}
const get = (path) => fetch(API + path).then((r) => (r.ok ? r.json() : Promise.reject(new Error('offline'))));

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

function ago(sec) {
  const s = Date.now() / 1000 - sec;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(sec * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// ---------- stats ----------

let stats = null;
function paintStats() {
  if (!stats) return;
  const total = { view: 0, play: 0, like: 0, comment: 0 };
  for (const [g, s] of Object.entries(stats)) for (const k in total) if (g !== 'site' || k === 'view') total[k] += s[k] || 0;
  document.querySelectorAll('[data-stat]').forEach((el) => {
    const [g, k] = el.dataset.stat.split(':');
    const n = g === 'all' ? total[k] : stats[g]?.[k];
    if (n == null) return;
    el.textContent = fmt(n);
    el.closest('[data-stat-wrap]')?.removeAttribute('hidden');
  });
}

async function loadStats() {
  try {
    stats = (await get('/api/stats')).games;
    document.documentElement.classList.add('has-api');
    paintStats();
  } catch {}
}

// ---------- likes ----------

const liked = new Set(store.get('wg.liked', []));
function paintLikes() {
  document.querySelectorAll('[data-like]').forEach((b) => {
    const on = liked.has(b.dataset.like);
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('[data-like-label]')?.replaceChildren(on ? 'Liked' : 'Like');
  });
}

async function toggleLike(btn) {
  const g = btn.dataset.like, on = !liked.has(g);
  on ? liked.add(g) : liked.delete(g);
  store.set('wg.liked', [...liked]);
  if (stats?.[g]) stats[g].like = Math.max(0, (stats[g].like || 0) + (on ? 1 : -1));
  paintLikes(); paintStats();
  if (on) burst(btn);
  try {
    const r = await post('/api/like', { game: g, visitor: VISITOR, on });
    if (stats?.[g]) { stats[g].like = r.likes; paintStats(); }
  } catch (e) {
    on ? liked.delete(g) : liked.add(g);
    store.set('wg.liked', [...liked]);
    paintLikes(); toast(e.message);
    loadStats();
  }
}

function burst(btn) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = btn.getBoundingClientRect();
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('span');
    p.className = 'burst';
    p.textContent = ['♥', '★', '✦'][i % 3];
    const a = (i / 8) * Math.PI * 2;
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * 46}px;--dy:${Math.sin(a) * 46}px`;
    document.body.append(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

// ---------- plays ----------

function trackPlay(game) {
  const body = new Blob([JSON.stringify({ game, kind: 'play' })], { type: 'text/plain' });
  if (!(API && navigator.sendBeacon?.(API + '/api/hit', body))) post('/api/hit', { game, kind: 'play' }).catch(() => {});
  if (stats?.[game]) { stats[game].play++; paintStats(); }
}

// ---------- comments ----------

let powWorker = null;
function solvePow(text) {
  powWorker ||= new Worker(new URL('./pow.js', import.meta.url));
  return new Promise((resolve) => {
    powWorker.onmessage = (e) => resolve(e.data);
    powWorker.postMessage({ text, bits: POW_BITS });
  });
}

function commentEl(c, extra) {
  const li = document.createElement('li');
  li.className = 'comment' + (extra ? ` ${extra}` : '');
  const head = document.createElement('div');
  head.className = 'comment-head';
  const who = document.createElement('b');
  who.textContent = c.name;
  const when = document.createElement('time');
  when.dateTime = new Date(c.at * 1000).toISOString();
  when.textContent = extra === 'is-held' ? 'waiting for a quick review' : ago(c.at);
  head.append(who, when);
  const p = document.createElement('p');
  p.textContent = c.body;
  li.append(head, p);
  if (!extra) {
    const rep = document.createElement('button');
    rep.type = 'button';
    rep.className = 'report';
    rep.textContent = 'Report';
    rep.setAttribute('aria-label', `Report comment by ${c.name}`);
    rep.onclick = async () => {
      rep.disabled = true;
      try { await post('/api/report', { id: c.id, visitor: VISITOR }); li.classList.add('is-reported'); rep.textContent = 'Reported, thanks'; }
      catch (e) { rep.disabled = false; toast(e.message); }
    };
    li.append(rep);
  }
  return li;
}

async function setupComments(box) {
  const game = box.dataset.comments;
  const list = box.querySelector('[data-comment-list]');
  const empty = box.querySelector('[data-comment-empty]');
  const more = box.querySelector('[data-comment-more]');
  const form = box.querySelector('form');
  let oldest = null;

  async function page() {
    try {
      const { comments } = await get(`/api/comments?game=${game}&limit=20${oldest ? `&before=${oldest}` : ''}`);
      comments.forEach((c) => list.append(commentEl(c)));
      if (comments.length) oldest = comments[comments.length - 1].id;
      empty.hidden = list.children.length > 0;
      more.hidden = comments.length < 20;
      box.hidden = false;
    } catch {}
  }
  more?.addEventListener('click', page);
  await page();

  const name = form.elements.name;
  name.value = store.get('wg.name', '');
  const body = form.elements.body;
  const counter = form.querySelector('[data-count-left]');
  const left = () => { if (counter) counter.textContent = String(400 - body.value.length); };
  body.addEventListener('input', left); left();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const status = form.querySelector('[data-form-status]');
    const text = body.value.trim();
    if (text.length < 2) { status.textContent = 'Write a few words first.'; body.focus(); return; }
    btn.disabled = true;
    status.textContent = 'Sending...';
    try {
      const ts = Date.now();
      const nm = name.value.trim();
      const nonce = await solvePow(`${game}|${nm}|${text}|${ts}`);
      const r = await post('/api/comments', {
        game, name: nm, body: text, ts, nonce, visitor: VISITOR,
        ms: Math.round(performance.now() - loadedAt), website: form.elements.website.value,
      });
      store.set('wg.name', nm);
      list.prepend(commentEl(r.comment, r.status === 'visible' ? 'is-new' : 'is-held'));
      empty.hidden = true;
      body.value = ''; left();
      status.textContent = r.status === 'visible' ? 'Posted. Thank you!' : 'Got it. It shows up after a quick check.';
      if (r.status === 'visible' && stats?.[game]) { stats[game].comment++; paintStats(); }
    } catch (err) {
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- ui bits ----------

let toastTimer;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
}

// gameplay loops only play while on screen, and never under reduced motion
function setupVideos() {
  const vids = document.querySelectorAll('video[data-loop]');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    const v = e.target;
    if (e.isIntersecting) { if (v.preload === 'none') v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
  }), { threshold: 0.35 });
  vids.forEach((v) => { v.muted = true; io.observe(v); });
}

function setupTheme() {
  const root = document.documentElement;
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('wg.theme', root.dataset.theme);
  });
}

function init() {
  paintLikes();
  setupVideos();
  setupTheme();
  document.addEventListener('click', (e) => {
    const like = e.target.closest('[data-like]');
    if (like) { e.preventDefault(); if (API) toggleLike(like); return; }
    const play = e.target.closest('[data-play]');
    if (play && API) trackPlay(play.dataset.play);
  });
  if (!API) return;
  loadStats();
  post('/api/hit', { game: PAGE, kind: 'view' }).catch(() => {});
  document.querySelectorAll('[data-comments]').forEach(setupComments);
}

window.WG = { toast, paintStats, get stats() { return stats; } };
init();
