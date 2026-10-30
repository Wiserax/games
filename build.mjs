// Builds the static site into docs/ (served by GitHub Pages at wiserax.dev/games/).
// node build.mjs [--api https://...workers.dev]
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'docs');
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const media = JSON.parse(readFileSync(join(ROOT, 'content/media.json'), 'utf8'));
const games = JSON.parse(readFileSync(join(ROOT, 'content/games.json'), 'utf8')).filter((g) => !g.hidden);
const size = (g, k, half) => media[g.id].shots[k].map((v) => (half ? v / 2 : v)).map(Math.round);
const apiArg = process.argv.indexOf('--api');
const API = apiArg > 0 ? process.argv[apiArg + 1] : site.api || '';
const BASE = site.base; // absolute site url, for og tags
const V = Date.now().toString(36); // cache buster for css/js

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });

const icon = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="currentColor"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11a4 4 0 110-8 4 4 0 010 8z" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a1 1 0 011 1v11a1 1 0 01-1 1H9l-5 4v-4H4a1 1 0 01-1-1V5a1 1 0 011-1z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h12m-5-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H7m5 6-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1.5v3m0 15v3M1.5 12h3m15 0h3M4.6 4.6l2.1 2.1m10.6 10.6 2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0110 0v3h1a1 1 0 011 1v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9a1 1 0 011-1zm2 0h6V7a3 3 0 00-6 0z" fill="currentColor"/></svg>',
};

function head({ title, desc, path, image, game }) {
  const url = BASE + path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="api" content="${esc(API)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#000000">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Wiserax Games">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE}${image}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${rel(path)}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rel(path)}assets/site.css?v=${V}">
<script>try{const t=localStorage.getItem('wg.theme');if(t)document.documentElement.dataset.theme=JSON.parse(t)}catch{}</script>
<script type="module" src="${rel(path)}assets/app.js?v=${V}"></script>
</head>
<body data-game="${game || 'site'}">
<a class="skip" href="#main">Skip to content</a>`;
}

// relative prefix back to the site root from a page path ("" for /, "../" for /necro/)
function rel(path) {
  const depth = path.split('/').filter(Boolean).length;
  return depth ? '../'.repeat(depth) : './';
}

function topbar(path, back) {
  const r = rel(path);
  return `<header class="top">
  <div class="top-in">
    ${back ? `<a class="back" href="${r}">${icon.back}<span>All games</span></a>` : `<a class="brand" href="${r}" aria-label="Wiserax Games home"><img src="${r}assets/logo.svg" alt="" width="22" height="22"><span>wiserax</span><span class="brand-sub">/games</span></a>`}
    <nav class="top-nav" aria-label="Site">
      <a class="top-link" href="${site.wisecraft}">Wisecraft</a>
      <button class="icon-btn theme-btn" type="button" data-theme-toggle aria-label="Switch light or dark theme">${icon.sun}${icon.moon}</button>
    </nav>
  </div>
</header>`;
}

function stat(game, kind, label, ico) {
  return `<span class="stat" data-stat-wrap hidden>${ico}<b data-stat="${game}:${kind}">0</b><span>${label}</span></span>`;
}

function likeBtn(g, big) {
  return `<button class="like${big ? ' like-lg' : ''}" type="button" data-like="${g.id}" aria-pressed="false" aria-label="Like ${esc(g.title)}">${icon.heart}<span data-like-label>Like</span><b data-stat="${g.id}:like" class="like-n"></b></button>`;
}

function playBtn(g, cls = '') {
  return `<a class="play ${cls}" href="${esc(g.play)}" data-play="${g.id}" rel="noopener">${icon.play}<span>Play ${esc(g.title)}</span></a>`;
}

function phone(g, r, eager) {
  return `<div class="phone" data-accent="${g.id}">
    <video data-loop muted loop playsinline preload="none" poster="${r}media/${g.id}/poster.webp" width="360" height="780" aria-label="${esc(g.title)} gameplay, a few seconds on a loop"${eager ? '' : ' loading="lazy"'}>
      <source src="${r}media/${g.id}/loop.mp4" type="video/mp4">
    </video>
  </div>`;
}

function badge(g) {
  if (g.status === 'new') return '<span class="pill pill-new">New today</span>';
  if (g.status === 'secret') return '<span class="pill pill-secret">Secret level</span>';
  return '<span class="pill pill-live">Playable</span>';
}

function footer(path) {
  const r = rel(path);
  return `<footer class="foot">
  <div class="foot-in">
    <a class="made" href="${site.wisecraft}"><img src="${r}assets/made-with-dark.svg" alt="Made with Wisecraft" width="188" height="28" class="only-dark"><img src="${r}assets/made-with-light.svg" alt="Made with Wisecraft" width="188" height="28" class="only-light"></a>
    <p class="needs-api">${esc(site.footer)}</p>
    <p class="mono">Alex Wiserax · ${new Date().getFullYear()} · <a href="${site.repo}">source</a></p>
  </div>
</footer>
</body>
</html>`;
}

// ---------- home ----------

// node spots on the map in % (x, y); the path is a smooth curve through them
const SPOTS = [[14, 80], [38, 58], [62, 40], [86, 18], [86, 18]];
function curve(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.map((v) => v.toFixed(1)).join(' ')} ${c2.map((v) => v.toFixed(1)).join(' ')} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function levelMap(r) {
  const n = games.length + 1;
  const pts = SPOTS.slice(0, n);
  const at = (i) => `left:${pts[i][0]}%;top:${pts[i][1]}%`;
  const nodes = games.map((g, i) => `<a class="node" href="#${g.id}" data-accent="${g.id}" style="${at(i)}" aria-label="Level ${g.level}: ${esc(g.title)}">
      <span class="node-disc"><img src="${r}media/${g.id}/thumb.webp" alt="" width="120" height="120"></span>
      <span class="node-lv mono">Level ${pad(g.level)}</span>
      <span class="node-name">${esc(g.title)}</span>
      ${g.status === 'new' ? '<span class="node-new">New</span>' : ''}
    </a>`).join('\n    ');
  return `<nav class="map" aria-label="Levels">
    <svg class="map-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${curve(pts)}" /></svg>
    ${nodes}
    <span class="node node-locked" style="${at(n - 1)}"><span class="node-disc">${icon.lock}</span><span class="node-lv mono">Level ${pad(n)}</span><span class="node-name">In the oven</span></span>
  </nav>`;
}

function gameSection(g, i) {
  const r = './';
  return `<section class="level" id="${g.id}" data-accent="${g.id}" aria-labelledby="${g.id}-t">
  <div class="level-media">${phone(g, r)}</div>
  <div class="level-body">
    <p class="kicker mono">Level ${pad(g.level)} · ${esc(g.genre)} ${badge(g)}</p>
    <h2 id="${g.id}-t" class="level-title">${esc(g.title)}</h2>
    <p class="level-pitch">${esc(g.pitch)}</p>
    <p class="level-what">${esc(g.what)}</p>
    <div class="actions">${playBtn(g)}${likeBtn(g)}</div>
    <div class="stats">${stat(g.id, 'play', 'plays', icon.play)}${stat(g.id, 'view', 'views', icon.eye)}${stat(g.id, 'comment', 'comments', icon.chat)}</div>
    <div class="shots">${g.media.shots.slice(0, 3).map((s, k) => `<img src="${r}media/${g.id}/shot-${k + 1}-sm.webp" alt="${esc(s)}" width="${size(g, k, 1)[0]}" height="${size(g, k, 1)[1]}" loading="lazy" decoding="async">`).join('')}</div>
    <a class="more" href="${r}${g.id}/">Devlog, patch notes and comments ${icon.arrow}</a>
  </div>
</section>`;
}

function home() {
  const path = '';
  const lead = games.find((g) => g.status === 'new') || games[0];
  return `${head({ title: site.title, desc: site.description, path, image: 'media/og.jpg' })}
${topbar(path)}
<main id="main">
<section class="hero">
  <div class="hero-copy">
    <p class="kicker mono">${esc(site.kicker)}</p>
    <h1 class="hero-title"><span>${esc(site.h1[0])}</span> <span class="dim">${esc(site.h1[1])}</span> <span class="glow">${esc(site.h1[2])}</span></h1>
    <p class="hero-sub">${esc(site.intro)}</p>
    <div class="actions">${playBtn(lead, 'play-hero')}<a class="ghost" href="#levels">See all ${games.length} games</a></div>
    <div class="stats stats-total">${stat('all', 'play', 'plays', icon.play)}${stat('all', 'like', 'likes', icon.heart)}${stat('all', 'comment', 'comments', icon.chat)}</div>
  </div>
  <div class="hero-map">${levelMap('./')}</div>
</section>
<div class="levels" id="levels">
${games.map(gameSection).join('\n')}
</div>
<section class="how">
  <p class="kicker mono">How these get made</p>
  <h2>${esc(site.how.title)}</h2>
  <p>${esc(site.how.text)}</p>
  <a class="ghost" href="${site.wisecraft}">Wisecraft ${icon.arrow}</a>
</section>
</main>
${footer(path)}`;
}

// ---------- game page ----------

function gamePage(g, i) {
  const path = `${g.id}/`;
  const r = rel(path);
  const prev = games[i - 1], next = games[i + 1];
  return `${head({ title: `${g.title}: ${g.pitch} | Wiserax Games`, desc: g.what, path, image: `media/${g.id}/og.jpg`, game: g.id })}
${topbar(path, true)}
<main id="main" data-accent="${g.id}">
<section class="ghero">
  <div class="ghero-copy">
    <p class="kicker mono">Level ${pad(g.level)} · ${esc(g.genre)} ${badge(g)}</p>
    <h1 class="ghero-title">${esc(g.title)}</h1>
    <p class="level-pitch">${esc(g.pitch)}</p>
    <p class="level-what">${esc(g.what)}</p>
    <div class="actions">${playBtn(g, 'play-hero')}${likeBtn(g, true)}</div>
    <p class="hint mono">${esc(g.playNote)}</p>
    <div class="stats">${stat(g.id, 'play', 'plays', icon.play)}${stat(g.id, 'view', 'views', icon.eye)}${stat(g.id, 'like', 'likes', icon.heart)}${stat(g.id, 'comment', 'comments', icon.chat)}</div>
  </div>
  <div class="ghero-media">${phone(g, r, true)}</div>
</section>

<section class="block shots-block" aria-label="Screenshots">
  <div class="shots shots-lg">${g.media.shots.map((s, k) => `<figure><img src="${r}media/${g.id}/shot-${k + 1}.webp" alt="${esc(s)}" width="${size(g, k)[0]}" height="${size(g, k)[1]}" loading="lazy" decoding="async"><figcaption class="mono">${esc(s)}</figcaption></figure>`).join('')}</div>
</section>

<section class="block devlog" aria-labelledby="dl">
  <p class="kicker mono">Devlog</p>
  <h2 id="dl">${esc(g.storyTitle)}</h2>
  ${g.story.map((p) => `<p>${esc(p)}</p>`).join('\n  ')}
  <aside class="hard"><p class="kicker mono">Hardest part</p><p>${esc(g.hard)}</p></aside>
</section>

<section class="block" aria-labelledby="pn">
  <p class="kicker mono">Patch notes</p>
  <h2 id="pn">How it got here</h2>
  <ol class="timeline">
    ${g.timeline.map((t) => `<li><time class="mono" datetime="${t.date}">${fmtDate(t.date)}</time><b>${esc(t.label)}</b><span>${esc(t.text)}</span></li>`).join('\n    ')}
  </ol>
</section>

<section class="block" aria-labelledby="fx">
  <p class="kicker mono">By the numbers</p>
  <h2 id="fx" class="sr-only">Facts</h2>
  <div class="facts">${g.facts.map((f) => `<div class="fact"><b>${esc(f.n)}</b><span>${esc(f.label)}</span></div>`).join('')}</div>
  <div class="tags">${g.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
</section>

<section class="block comments" aria-labelledby="cm" data-comments="${g.id}" hidden>
  <p class="kicker mono">Guestbook</p>
  <h2 id="cm">Say hi</h2>
  <form class="cform" novalidate>
    <label class="field"><span>Name <i>(optional)</i></span><input name="name" maxlength="24" autocomplete="nickname" placeholder="anon"></label>
    <label class="field"><span>Comment</span><textarea name="body" maxlength="400" rows="3" required placeholder="What did you think? Found a bug?"></textarea></label>
    <label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
    <div class="cform-row"><span class="mono count"><span data-count-left>400</span> left</span><button class="btn" type="submit">Post comment</button></div>
    <p class="form-status" data-form-status role="status" aria-live="polite"></p>
  </form>
  <ul class="clist" data-comment-list></ul>
  <p class="empty" data-comment-empty hidden>No comments yet. Be the first to say something nice (or mean, but useful).</p>
  <button class="ghost" type="button" data-comment-more hidden>Load older comments</button>
</section>

<nav class="pn" aria-label="Other games">
  ${prev ? `<a class="pn-a" href="${r}${prev.id}/" data-accent="${prev.id}"><span class="mono">${icon.back} Level ${pad(prev.level)}</span><b>${esc(prev.title)}</b></a>` : '<span></span>'}
  ${next ? `<a class="pn-a pn-next" href="${r}${next.id}/" data-accent="${next.id}"><span class="mono">Level ${pad(next.level)} ${icon.arrow}</span><b>${esc(next.title)}</b></a>` : `<a class="pn-a pn-next" href="${r}"><span class="mono">All games ${icon.arrow}</span><b>Back to the map</b></a>`}
</nav>
</main>
${footer(path)}`;
}

// ---------- write ----------

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'src/assets'), join(OUT, 'assets'), { recursive: true });
cpSync(join(ROOT, 'src/media'), join(OUT, 'media'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), home());
games.forEach((g, i) => {
  mkdirSync(join(OUT, g.id), { recursive: true });
  writeFileSync(join(OUT, g.id, 'index.html'), gamePage(g, i));
});
writeFileSync(join(OUT, '.nojekyll'), '');
writeFileSync(join(OUT, '404.html'), (`${head({ title: 'Lost level | Wiserax Games', desc: 'This level does not exist.', path: '', image: 'media/og.jpg' })}${topbar('')}<main id="main" class="lost"><p class="kicker mono">404</p><h1 class="hero-title"><span>Wrong level.</span> <span class="glow">Respawning...</span></h1><p><a class="play" href="${BASE}">${icon.play}<span>Back to the map</span></a></p></main>${footer('')}`).replaceAll('"./', `"${new URL(BASE).pathname}`));
console.log(`built ${games.length} games into docs/ (api: ${API || 'none'})`);
