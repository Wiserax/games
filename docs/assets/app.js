// Wiserax Games: likes, plays, views and comments against the small Cloudflare API.
// Without the API (or when it is down) likes still work on this device and the guestbook says it opens soon.
const API = (document.querySelector('meta[name="api"]')?.content || '').replace(/\/$/, '');
const PAGE = document.body.dataset.game || 'site';
const POW_BITS = 16;
const MIN_MS = 2600; // the server refuses comments sent faster than this after page load
const loadedAt = performance.now();
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  if (!r.ok) throw Object.assign(new Error(j.error || 'offline'), { status: r.status });
  return j;
}
const get = (path) => fetch(API + path, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('offline'))));
const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
const icon = (name) => `<svg class="wg-i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function ago(sec) {
  const s = Date.now() / 1000 - sec;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(sec * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// ---------- toasts ----------

function toast(msg, { kind = '', action = null, ms = 3200 } = {}) {
  const box = document.querySelector('.wg-toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `wg-toast${kind ? ` wg-toast--${kind}` : ''}`;
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  t.innerHTML = `<span class="wg-toast__icon">${icon(kind === 'like' ? 'heart' : kind === 'error' ? 'alert' : 'check')}</span><span></span>`;
  t.lastChild.textContent = msg;
  let timer;
  const close = () => { clearTimeout(timer); t.classList.add('is-leaving'); setTimeout(() => t.remove(), 400); };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wg-btn wg-btn--ghost toast-action';
    b.textContent = action.label;
    b.onclick = () => { action.run(); close(); };
    t.append(b);
    t.style.pointerEvents = 'auto';
  }
  box.append(t);
  timer = setTimeout(() => { action?.done?.(); close(); }, ms);
  return close;
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
    el.textContent = el.classList.contains('wg-like__count') || el.classList.contains('playbar-n') ? (n ? fmt(n) : '') : fmt(n);
    const unit = el.dataset.unit && el.nextElementSibling;
    if (unit) unit.textContent = n === 1 ? el.dataset.unit : `${el.dataset.unit}s`;
    // nobody has commented yet: invite instead of showing a zero
    if (el.dataset.unit === 'comment' && el.closest('a') && !n) { el.textContent = ''; unit.textContent = 'Be the first to comment'; }
  });
  root.classList.add('stats-on');
}

async function loadStats() {
  try {
    stats = (await get('/api/stats')).games;
    paintStats();
  } catch {
    root.classList.add('stats-off'); // API down: hide the numbers, keep likes and the guestbook (it has its own retry)
  }
}

// ---------- likes ----------

const liked = new Set(store.get('wg.liked', []));
function paintLikes() {
  document.querySelectorAll('[data-like]').forEach((b) => b.setAttribute('aria-pressed', String(liked.has(b.dataset.like))));
}

async function toggleLike(btn) {
  const g = btn.dataset.like, on = !liked.has(g);
  on ? liked.add(g) : liked.delete(g);
  store.set('wg.liked', [...liked]);
  if (stats?.[g]) stats[g].like = Math.max(0, (stats[g].like || 0) + (on ? 1 : -1));
  paintLikes(); paintStats();
  if (on) burst(btn);
  if (!root.classList.contains('has-api')) { if (on) toast('Saved on this device. Thanks!', { kind: 'like' }); return; }
  try {
    const r = await post('/api/like', { game: g, visitor: VISITOR, on });
    if (stats?.[g]) { stats[g].like = r.likes; paintStats(); }
  } catch (e) {
    on ? liked.delete(g) : liked.add(g);
    store.set('wg.liked', [...liked]);
    paintLikes(); loadStats();
    toast(e.status === 429 ? e.message : "Couldn't save that like, try again.", { kind: 'error' });
  }
}

function burst(btn) {
  btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop');
  if (reduced) return;
  const r = btn.getBoundingClientRect();
  for (let k = 0; k < 8; k++) {
    const p = document.createElement('span');
    p.className = 'burst';
    const a = (k / 8) * Math.PI * 2;
    p.style.cssText = `left:${r.left + 22}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * 46}px;--dy:${Math.sin(a) * 46}px`;
    document.body.append(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

// ---------- plays ----------

function trackPlay(game) {
  try { sessionStorage.setItem('wg.lastPlay', JSON.stringify({ game, at: Date.now() })); } catch {}
  if (!root.classList.contains('has-api')) return;
  const body = new Blob([JSON.stringify({ game, kind: 'play' })], { type: 'text/plain' });
  if (!navigator.sendBeacon?.(API + '/api/hit', body)) post('/api/hit', { game, kind: 'play' }).catch(() => {});
}

// ---------- share ----------

async function share(btn) {
  const url = btn.dataset.share, title = btn.dataset.shareTitle;
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Link copied. Send it to a friend!'); }
  catch { toast(url); }
}

// ---------- gameplay loops: play while visible, one pause switch for all ----------

let loopsPaused = store.get('wg.loopsPaused', reduced);
function paintLoops() {
  document.querySelectorAll('[data-loop-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', String(loopsPaused));
    b.setAttribute('aria-label', loopsPaused ? 'Play the gameplay loops' : 'Pause the gameplay loops');
  });
  document.querySelectorAll('video[data-loop]').forEach((v) => { if (loopsPaused) v.pause(); else if (v.dataset.visible === '1') v.play().catch(() => {}); });
}
function setupLoops() {
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    const v = e.target;
    v.dataset.visible = e.isIntersecting ? '1' : '0';
    if (e.isIntersecting && !loopsPaused) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
  }), { threshold: 0.35 });
  document.querySelectorAll('video[data-loop]').forEach((v) => { v.muted = true; io.observe(v); });
  paintLoops();
}

// ---------- sticky play bar on game pages ----------

function setupPlaybar() {
  const bar = document.querySelector('[data-playbar]'), hero = document.querySelector('[data-hero-actions]');
  if (!bar || !hero) return;
  bar.hidden = false;
  bar.inert = true;
  document.body.classList.add('has-playbar');
  let typing = false, guest = false;
  const io = new IntersectionObserver(([e]) => { bar.dataset.past = String(!e.isIntersecting && e.boundingClientRect.top < 0); update(); });
  const update = () => { const on = bar.dataset.past === 'true' && !typing && !guest; bar.classList.toggle('is-on', on); bar.inert = !on; };
  io.observe(hero);
  // hide over the comment form only, so the bar stays around while reading the devlog
  const form = document.querySelector('#cm .wg-form') || document.querySelector('#cm');
  if (form) new IntersectionObserver(([e]) => { guest = e.isIntersecting; update(); }).observe(form);
  document.addEventListener('focusin', (e) => { typing = e.target.matches('input, textarea'); update(); });
  document.addEventListener('focusout', () => { typing = false; update(); });
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

function commentEl(c, state) {
  const li = document.createElement('li');
  li.className = 'wg-comment' + (state ? ` ${state}` : '');
  const name = c.name || 'anon';
  li.innerHTML = `<span class="wg-avatar" aria-hidden="true"></span><div class="wg-comment__main"><p class="wg-comment__head"><span class="wg-comment__name"></span><time class="wg-comment__time"></time></p><p class="wg-comment__body"></p></div>`;
  li.querySelector('.wg-avatar').textContent = name === 'anon' ? '?' : [...name][0].toUpperCase();
  li.querySelector('.wg-comment__name').textContent = name;
  const t = li.querySelector('time');
  t.dateTime = new Date(c.at * 1000).toISOString();
  t.textContent = state === 'is-held' ? 'waiting for a quick check' : ago(c.at);
  li.querySelector('.wg-comment__body').textContent = c.body;
  if (!state) {
    const rep = document.createElement('button');
    rep.type = 'button';
    rep.className = 'wg-iconbtn wg-comment__report';
    rep.setAttribute('aria-pressed', 'false');
    rep.setAttribute('aria-label', `Report comment by ${name}`);
    rep.innerHTML = icon('flag');
    rep.onclick = () => {
      if (rep.getAttribute('aria-pressed') === 'true') return;
      rep.setAttribute('aria-pressed', 'true');
      li.classList.add('is-reported');
      let undone = false;
      toast('Reported. Thanks for keeping it friendly.', {
        ms: 5000,
        action: { label: 'Undo', run: () => { undone = true; rep.setAttribute('aria-pressed', 'false'); li.classList.remove('is-reported'); rep.focus(); } },
        done: () => { if (!undone) post('/api/report', { id: c.id, visitor: VISITOR }).catch(() => {}); },
      });
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

  const offline = box.querySelector('[data-comment-offline]');
  async function page() {
    try {
      const { comments } = await get(`/api/comments?game=${game}&limit=20${oldest ? `&before=${oldest}` : ''}`);
      offline.hidden = true;
      comments.forEach((c) => list.append(commentEl(c)));
      if (comments.length) oldest = comments[comments.length - 1].id;
      empty.hidden = list.children.length > 0;
      more.hidden = comments.length < 20;
      if (oldest && !comments.length) toast("That's all of them.");
    } catch {
      offline.hidden = false;
    }
  }
  more.addEventListener('click', page);
  box.querySelector('[data-comment-retry]').addEventListener('click', page);
  page();

  const name = form.elements.name, body = form.elements.body, btn = form.querySelector('[type=submit]');
  const status = form.querySelector('[data-form-status]'), counter = form.querySelector('[data-count]');
  name.value = store.get('wg.name', '');
  const left = () => {
    const n = body.value.length;
    counter.textContent = `${n} / 400`;
    counter.classList.toggle('is-near', n > 340);
  };
  body.addEventListener('input', left); left();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.getAttribute('aria-busy') === 'true') return;
    const text = body.value.trim();
    if (text.length < 2) { status.textContent = 'Write a few words first.'; body.setAttribute('aria-invalid', 'true'); body.focus(); return; }
    body.removeAttribute('aria-invalid');
    btn.setAttribute('aria-busy', 'true');
    status.textContent = 'Posting...';
    const wait = MIN_MS - (performance.now() - loadedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const ts = Date.now(), nm = name.value.trim();
      const nonce = await solvePow(`${game}|${nm}|${text}|${ts}`);
      const r = await post('/api/comments', { game, name: nm, body: text, ts, nonce, visitor: VISITOR, ms: Math.round(performance.now() - loadedAt), website: form.elements.website.value });
      store.set('wg.name', nm);
      const li = commentEl(r.comment, r.status === 'visible' ? 'is-new' : 'is-held');
      li.tabIndex = -1;
      list.prepend(li);
      empty.hidden = true;
      body.value = ''; left();
      status.textContent = r.status === 'visible' ? 'Posted. Thank you!' : 'Got it. It shows up after a quick check.';
      if (r.status === 'visible' && stats?.[game]) { stats[game].comment++; paintStats(); }
      li.focus();
    } catch (err) {
      status.textContent = err.status && err.status < 500 && err.message !== 'offline' ? err.message : "Couldn't post. Your text is safe, try again.";
      body.focus();
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });
}

// ---------- labels that expire: "New" for 7 days after release, "Updated" for 7 days after a build ----------

function paintFresh() {
  const now = Date.now(), day = 864e5, d = (s) => Date.parse(s + 'T00:00:00Z');
  const fmtD = (s) => new Date(d(s) + 432e5).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  document.querySelectorAll('[data-fresh]').forEach((el) => {
    const isNew = now - d(el.dataset.first) < 7 * day, upd = now - d(el.dataset.last) < 7 * day;
    el.textContent = isNew ? 'New' : upd ? `Updated ${fmtD(el.dataset.last)}` : '';
    el.hidden = !(isNew || upd);
  });
  document.querySelectorAll('[data-fresh-sticker]').forEach((el) => { if (now - d(el.dataset.first) >= 7 * day) el.remove(); });
}

// ---------- after a game: back on the page, ask for a like or a comment once ----------

function comeBack() {
  let last = null;
  try { last = JSON.parse(sessionStorage.getItem('wg.lastPlay')); } catch {}
  if (!last || Date.now() - last.at < 4000) return;
  try { sessionStorage.removeItem('wg.lastPlay'); } catch {}
  const btn = document.querySelector(`[data-like="${last.game}"]`);
  const title = btn?.querySelector('.wg-sr')?.textContent.replace(/^Like /, '') || 'the game';
  if (liked.has(last.game)) toast(`Back from ${title}? Tell me what you thought in the guestbook.`, { ms: 6000 });
  else toast(`Back from ${title}? Leave a like if it was fun.`, { kind: 'like', ms: 7000, action: { label: 'Like', run: () => btn && toggleLike(btn) } });
}

function init() {
  paintFresh();
  paintLikes();
  addEventListener('pageshow', (e) => { if (e.persisted) comeBack(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') comeBack(); });
  setupLoops();
  setupPlaybar();
  document.addEventListener('click', (e) => {
    const like = e.target.closest('[data-like]');
    if (like) { e.preventDefault(); toggleLike(like); return; }
    const sh = e.target.closest('[data-share]');
    if (sh) { e.preventDefault(); share(sh); return; }
    const lt = e.target.closest('[data-loop-toggle]');
    if (lt) { loopsPaused = !loopsPaused; store.set('wg.loopsPaused', loopsPaused); paintLoops(); return; }
    const play = e.target.closest('[data-play]');
    if (play) trackPlay(play.dataset.play);
  });
  comeBack(); // a full reload after playing (iOS often drops the page) still gets the prompt
  if (!API) return;
  loadStats();
  post('/api/hit', { game: PAGE, kind: 'view' }).catch(() => {});
  document.querySelectorAll('[data-comments]').forEach(setupComments);
}

init();
