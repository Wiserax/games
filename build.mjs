// Builds the static site into docs/ (served by GitHub Pages at wiserax.dev/games/).
// node build.mjs [--api https://...workers.dev]
// Markup uses the Wiserax Games design system (src/assets/tokens.css, components.css, wg-* classes);
// site.css only lays the pages out.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'docs');
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const media = JSON.parse(readFileSync(join(ROOT, 'content/media.json'), 'utf8'));
const games = JSON.parse(readFileSync(join(ROOT, 'content/games.json'), 'utf8')).filter((g) => !g.hidden);
const sprite = readFileSync(join(ROOT, 'src/sprite.svg'), 'utf8');
const apiArg = process.argv.indexOf('--api');
const API = apiArg > 0 ? process.argv[apiArg + 1] : site.api || '';
const BASE = site.base; // absolute site url, for og tags
const V = Date.now().toString(36); // cache buster for css/js

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric' });
const size = (g, k, half) => media[g.id].shots[k].map((v) => Math.round(half ? v / 2 : v));
const i = (name, cls = '') => `<svg class="wg-i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// relative prefix back to the site root from a page path ("./" for /, "../" for /necro/)
function rel(path) {
  const depth = path.split('/').filter(Boolean).length;
  return depth ? '../'.repeat(depth) : './';
}

function head({ title, desc, path, image, game }) {
  const r = rel(path);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="api" content="${esc(API)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#050507" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F4F4F7" media="(prefers-color-scheme: light)">
<link rel="canonical" href="${BASE + path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Wiserax Games">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${BASE + path}">
<meta property="og:image" content="${BASE}${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${r}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${r}assets/tokens.css?v=${V}">
<link rel="stylesheet" href="${r}assets/components.css?v=${V}">
<link rel="stylesheet" href="${r}assets/site.css?v=${V}">
<script>try{const t=JSON.parse(localStorage.getItem('wg.theme'));if(t)document.documentElement.dataset.theme=t}catch{}${API ? "document.documentElement.classList.add('has-api')" : ''}</script>
<script type="module" src="${r}assets/app.js?v=${V}"></script>
</head>
<body data-game="${game || 'site'}">
${sprite}
<a class="wg-skip" href="#main">Skip to content</a>`;
}

function topbar(path, back) {
  const r = rel(path);
  const left = back
    ? `<a class="wg-back" href="${r}">${i('left')}All games</a>`
    : `<a class="wg-brand" href="${r}" aria-label="Wiserax Games home"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#i-logo"/></svg>wiserax<span class="wg-brand__tag">games</span></a>`;
  return `<header class="wg-topbar">
  ${left}
  <div class="wg-topbar__end">
    <a class="top-link" href="${site.wisecraft}">Wisecraft</a>
    <button class="wg-toggle" type="button" role="switch" aria-checked="false" aria-label="Light theme" data-theme-toggle>${i('moon')}${i('sun')}</button>
  </div>
</header>`;
}

// likes always render (first paint, no layout shift); counts fill in when the API answers
function likeBtn(g, lg) {
  return `<button class="wg-like${lg ? ' wg-like--lg' : ''}" type="button" data-like="${g.id}" aria-pressed="false">${i('heart')}<span class="wg-sr">Like ${esc(g.title)}</span><span class="wg-like__count" data-stat="${g.id}:like"></span></button>`;
}

// short label where the game's name is already on screen; the full name stays for screen readers
function playBtn(g, cls = '', named = false) {
  const label = named ? `Play ${esc(g.title)}` : `Play<span class="wg-sr"> ${esc(g.title)}</span>`;
  return `<a class="wg-play ${cls}" href="${esc(g.play)}" data-play="${g.id}" data-accent="${g.id}" rel="noopener">${i('play')}${label}</a>`;
}

function shareBtn(g) {
  const label = g.id === 'graft' ? 'Invite friends' : `Share ${esc(g.title)}`;
  return `<button class="wg-iconbtn wg-iconbtn--line share" type="button" data-share="${BASE}${g.id}/" data-share-title="${esc(g.title)}: ${esc(g.pitch)}" aria-label="${label}">${i('share')}</button>`;
}

function hud(items) {
  return `<div class="wg-hud stats-hud" data-stat-wrap>${items.map(([g, k, ico, label, href]) => {
    const tag = href ? 'a' : 'span';
    return `<${tag} class="wg-hud__item"${href ? ` href="${href}"` : ''}>${i(ico, ico === 'heart' ? 'wg-i--heart' : '')}<b data-stat="${g}:${k}" data-unit="${label}">·</b><span class="unit">${label}s</span></${tag}>`;
  }).join('')}</div>`;
}

function status(g) {
  if (g.status === 'new') return '<span class="wg-status wg-status--new">New today</span>';
  return '<span class="wg-status wg-status--live">Playable</span>';
}

function loop(g, r, cls = '') {
  return `<figure class="wg-media loop ${cls}" data-accent="${g.id}">
    <video data-loop muted loop playsinline preload="none" poster="${r}media/${g.id}/poster.webp" width="360" height="780" aria-label="${esc(g.title)}: a few seconds of gameplay, looping">
      <source src="${r}media/${g.id}/loop.mp4" type="video/mp4">
    </video>
    <button class="wg-iconbtn loop-toggle" type="button" aria-pressed="false" aria-label="Pause the gameplay loops" data-loop-toggle><span class="ico-pause" aria-hidden="true"></span>${i('play', 'ico-play')}</button>
  </figure>`;
}

function footer(path) {
  const r = rel(path);
  return `<footer class="wg-footer">
  <a class="wg-madewith" href="${site.wisecraft}" aria-label="Made with Wisecraft"><img class="on-dark" src="${r}assets/made-with-dark.svg" alt="" width="214" height="32"><img class="on-light" src="${r}assets/made-with-light.svg" alt="" width="214" height="32"></a>
  <nav aria-label="Footer"><a href="${r}">Games</a><a href="${site.wisecraft}">Wisecraft</a><a href="${site.repo}">Source</a></nav>
  <span>Alex Wiserax · ${new Date().getFullYear()}</span>
</footer>
<div class="wg-toasts" aria-live="polite"></div>
</body>
</html>`;
}

// ---------- home ----------

// node spots in % (x, y) on the map: a zig-zag, the locked "next game" last
const SPOTS = [[17, 72], [39, 30], [61, 72], [83, 30], [83, 30]];
function curve(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.map((v) => v.toFixed(1)).join(' ')} ${c2.map((v) => v.toFixed(1)).join(' ')} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function levelMap(r) {
  const n = games.length + 1, pts = SPOTS.slice(0, n);
  const at = (k) => `left:${pts[k][0]}%;top:${pts[k][1]}%`;
  const nodes = games.map((g, k) => `<a class="wg-node map-node" href="#${g.id}" data-node="${g.id}" data-accent="${g.id}" style="${at(k)}"${g.status === 'new' ? ' aria-current="true"' : ''}>
      <span class="wg-node__disc"><img src="${r}media/${g.id}/thumb.webp" alt="" width="120" height="120">${g.status === 'new' ? '<span class="wg-new wg-new--corner">New</span>' : ''}<span class="cleared" title="Played">${i('check')}<span class="wg-sr">played</span></span></span>
      <span class="wg-node__label"><span class="wg-node__num">${pad(g.level)}</span>${esc(g.short || g.title)}</span>
    </a>`).join('\n    ');
  return `<nav class="map" aria-label="Pick a game">
    <svg class="map-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${curve(pts)}"/></svg>
    ${nodes}
    <span class="wg-node map-node is-locked" style="${at(n - 1)}"><span class="wg-node__disc">${i('lock')}</span><span class="wg-node__label"><span class="wg-node__num">${pad(n)}</span>Next game</span></span>
  </nav>`;
}

function gameCard(g) {
  const r = './';
  return `<section class="level" id="${g.id}" data-accent="${g.id}" aria-labelledby="${g.id}-t">
  <div class="level-head">
    <p class="level-kicker"><span class="wg-label">Level ${pad(g.level)} · ${esc(g.genre)}</span>${status(g)}</p>
    <h2 class="level-title" id="${g.id}-t">${esc(g.title)}</h2>
    <p class="level-pitch">${esc(g.pitch)}</p>
    <div class="actions">${playBtn(g)}${likeBtn(g)}${shareBtn(g)}</div>
  </div>
  <div class="level-media">${loop(g, r)}</div>
  <div class="level-body">
    <p class="level-what">${esc(g.what)}</p>
    ${hud([[g.id, 'play', 'pad', 'play'], [g.id, 'like', 'heart', 'like'], [g.id, 'comment', 'chat', 'comment', `${r}${g.id}/#cm`]])}
    <div class="level-shots">${g.media.shots.slice(0, 3).map((s, n) => `<img src="${r}media/${g.id}/shot-${n + 1}-sm.webp" alt="${esc(s)}" width="${size(g, n, 1)[0]}" height="${size(g, n, 1)[1]}" loading="lazy" decoding="async">`).join('')}</div>
    <a class="more" href="${r}${g.id}/">Devlog, patch notes and comments ${i('right')}</a>
  </div>
</section>`;
}

function home() {
  const path = '';
  const lead = games.find((g) => g.status === 'new') || games[games.length - 1];
  const heroPlay = playBtn(lead, 'wg-play--lg play-hero', true).replace('<svg', `<img class="play-thumb" src="./media/${lead.id}/thumb.webp" alt="" width="40" height="40"><svg`);
  return `${head({ title: site.title, desc: site.description, path, image: 'media/og.jpg' })}
${topbar(path)}
<main id="main">
<section class="hero wg-wrap">
  <div class="hero-copy">
    <h1 class="hero-title">${esc(site.h1[0])} <span class="wg-glow">${esc(site.h1[1])}</span></h1>
    <p class="hero-sub">${esc(site.sub)}</p>
  </div>
  <div class="hero-map">${levelMap('./')}</div>
  <div class="hero-cta" data-accent="${lead.id}">
    <p class="wg-label cta-label">New · ${esc(lead.genre)}</p>
    <div class="actions">${heroPlay}<a class="wg-btn see-all" href="#levels">See all ${games.length} games ${i('right')}</a></div>
    ${hud([['all', 'play', 'pad', 'play'], ['all', 'like', 'heart', 'like'], ['all', 'comment', 'chat', 'comment']])}
  </div>
</section>
<div class="levels wg-wrap" id="levels">
${games.map(gameCard).join('\n')}
</div>
<section class="how wg-wrap">
  <header class="wg-sechead"><span class="wg-sechead__kicker">How these get made</span><h2 class="wg-h2">${esc(site.how.title)}</h2></header>
  <p class="wg-lead">${esc(site.intro)}</p>
  <p class="how-text">${esc(site.how.text)}</p>
  <a class="wg-btn" href="${site.wisecraft}">Meet Wisecraft ${i('right')}</a>
</section>
</main>
${footer(path)}`;
}

// ---------- game page ----------

function gamePage(g, idx) {
  const path = `${g.id}/`;
  const r = rel(path);
  const prev = games[idx - 1], next = games[idx + 1];
  const pager = (o, dir) => {
    const cls = `wg-pager__link${dir === 'next' ? ' wg-pager__link--next' : ''}`;
    if (!o) return `<a class="${cls}" href="${r}"><span class="wg-pager__dir">Back to</span><span class="wg-pager__name">All games</span></a>`;
    return `<a class="${cls}" href="${r}${o.id}/" data-accent="${o.id}"><span class="wg-pager__dir">${dir === 'next' ? 'Next level' : 'Prev level'}</span><img class="wg-pager__thumb" src="${r}media/${o.id}/thumb.webp" alt="" width="40" height="40"><span class="wg-pager__name">${esc(o.title)}</span></a>`;
  };
  return `${head({ title: `${g.title}: ${g.pitch} | Wiserax Games`, desc: g.what, path, image: `media/${g.id}/og.jpg`, game: g.id })}
${topbar(path, true)}
<main id="main" data-accent="${g.id}">
<section class="ghero wg-wrap">
  <div class="ghero-copy">
    <p class="level-kicker"><span class="wg-label">Level ${pad(g.level)} · ${esc(g.genre)}</span>${status(g)}</p>
    <h1 class="ghero-title">${esc(g.title)}</h1>
    <p class="level-pitch">${esc(g.pitch)}</p>
    <div class="actions" data-hero-actions>${playBtn(g, 'wg-play--lg')}${likeBtn(g, true)}${shareBtn(g)}</div>
    <p class="hint">${esc(g.playNote)} No install, no login.</p>
    <p class="level-what">${esc(g.what)}</p>
    ${hud([[g.id, 'view', 'eye', 'view'], [g.id, 'play', 'pad', 'play'], [g.id, 'comment', 'chat', 'comment', '#cm']])}
  </div>
  <div class="ghero-media">${loop(g, r)}</div>
</section>

<section class="block wg-wrap" aria-labelledby="sc">
  <h2 id="sc" class="wg-sr">Screenshots</h2>
  <div class="gallery">${g.media.shots.map((s, n) => `<figure><div class="wg-media shot"><img src="${r}media/${g.id}/shot-${n + 1}.webp" alt="${esc(s)}" width="${size(g, n)[0]}" height="${size(g, n)[1]}" loading="lazy" decoding="async"></div><figcaption>${esc(s)}</figcaption></figure>`).join('')}</div>
</section>

<section class="block wg-wrap" aria-labelledby="dl">
  <header class="wg-sechead"><span class="wg-sechead__kicker">Devlog</span><h2 class="wg-h2" id="dl">${esc(g.storyTitle)}</h2></header>
  <article class="wg-story">
    ${g.story.map((p) => `<p>${esc(p)}</p>`).join('\n    ')}
  </article>
  <aside class="hard"><p class="wg-label">Hardest part</p><p>${esc(g.hard)}</p></aside>
</section>

<section class="block wg-wrap guest" id="cm" aria-labelledby="cm-t" data-comments="${g.id}">
  <header class="wg-sechead"><span class="wg-sechead__kicker">Guestbook · no account needed</span><h2 class="wg-h2" id="cm-t">Say hi</h2></header>
  <div class="guest-on">
    <form class="wg-form" novalidate>
      <div class="wg-field"><label class="wg-field__label" for="cname">Name <small>optional, shows as anon</small></label><input class="wg-input" id="cname" name="name" maxlength="24" autocomplete="nickname"></div>
      <div class="wg-field"><label class="wg-field__label" for="cbody">Comment</label><div class="wg-field__box"><textarea class="wg-input" id="cbody" name="body" maxlength="400" rows="3" aria-describedby="ccount" placeholder="What did you think? Found a bug?"></textarea><span class="wg-count" id="ccount" data-count>0 / 400</span></div></div>
      <div class="wg-hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
      <div class="wg-form__foot"><p class="form-status" data-form-status role="status" aria-live="polite"></p><button class="wg-btn wg-btn--accent" type="submit">${i('chat')}Post comment</button></div>
    </form>
    <ul class="wg-comments" data-comment-list></ul>
    <p class="wg-empty" data-comment-empty hidden>No comments yet. Be the first to say something nice, or mean but useful.</p>
    <button class="wg-btn" type="button" data-comment-more hidden>Load older comments</button>
  </div>
  <p class="guest-off wg-empty">The guestbook opens soon. Your likes already count on this device.</p>
</section>

<section class="block wg-wrap" aria-labelledby="pn">
  <header class="wg-sechead"><span class="wg-sechead__kicker">Patch notes</span><h2 class="wg-h2" id="pn">How it got here</h2></header>
  <ol class="wg-tl">
    ${g.timeline.slice().reverse().map((t, n) => `<li class="wg-tl__item${n === 0 ? ' is-latest' : ''}"><div class="wg-tl__head"><span class="wg-tl__ver">${esc(t.label)}</span><time class="wg-tl__date" datetime="${t.date}">${fmtDate(t.date)}</time></div><p>${esc(t.text)}</p></li>`).join('\n    ')}
  </ol>
</section>

<section class="block wg-wrap" aria-labelledby="fx">
  <header class="wg-sechead"><span class="wg-sechead__kicker">By the numbers</span><h2 class="wg-h2" id="fx">${esc(g.title)} in ${g.facts.length} numbers</h2></header>
  <div class="wg-facts">${g.facts.map((f) => `<div class="wg-fact"><span class="fact-n">${esc(f.n)}</span><span class="wg-fact__value"><small>${esc(f.label)}</small></span></div>`).join('')}</div>
  <p class="tags">${g.tags.map((t) => `<span class="wg-chip">${esc(t)}</span>`).join('')}</p>
</section>

<nav class="block wg-wrap wg-pager" aria-label="Other games">${pager(prev, 'prev')}${pager(next, 'next')}</nav>
</main>
<div class="playbar" data-playbar data-accent="${g.id}" hidden>
  ${playBtn(g, 'wg-play--sm')}
  ${likeBtn(g)}
  <a class="wg-iconbtn wg-iconbtn--line" href="#cm" aria-label="Comments">${i('chat')}<b class="playbar-n" data-stat="${g.id}:comment"></b></a>
  ${shareBtn(g)}
</div>
${footer(path)}`;
}

// ---------- write ----------

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'src/assets'), join(OUT, 'assets'), { recursive: true });
cpSync(join(ROOT, 'src/media'), join(OUT, 'media'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), home());
games.forEach((g, n) => {
  mkdirSync(join(OUT, g.id), { recursive: true });
  writeFileSync(join(OUT, g.id, 'index.html'), gamePage(g, n));
});
writeFileSync(join(OUT, '.nojekyll'), '');
const lost = `${head({ title: 'Lost level | Wiserax Games', desc: 'This level does not exist.', path: '', image: 'media/og.jpg' })}${topbar('')}<main id="main" class="lost wg-wrap"><p class="wg-label">404</p><h1 class="hero-title">Wrong level. <span class="wg-glow">Respawning...</span></h1><p class="actions"><a class="wg-play" href="./">${i('play')}Back to the map</a></p></main>${footer('')}`;
writeFileSync(join(OUT, '404.html'), lost.replaceAll('"./', `"${new URL(BASE).pathname}`));
console.log(`built ${games.length} games into docs/ (api: ${API || 'none'})`);
