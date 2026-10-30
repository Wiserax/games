# Wiserax Games

Alex Wiserax's games page: https://wiserax.dev/games/

Small games built with AI agents and [Wisecraft](https://wiserax.dev/wisecraft/), playable in a phone browser.

- `content/`: the games, their devlogs and the page text (`games.json`, `site.json`).
- `src/`: page assets (CSS, JS) and media (gameplay loops, screenshots, share cards).
- `build.mjs`: writes the static site into `docs/` (GitHub Pages serves it). `node build.mjs`
- `api/`: a Cloudflare Worker with D1 for likes, comments and play counts. No logins: anonymous visitor ids, hashed IPs, proof of work, rate limits, link filter, report-to-hide and a moderation endpoint. `node api/test.mjs` runs the checks against `wrangler dev`.
- `tools/`: media, share cards and a local static server.
