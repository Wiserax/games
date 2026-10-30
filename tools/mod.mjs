// Comment moderation. The admin token lives in ~/.config/wiserax-games/admin.token (never in the repo).
//   node tools/mod.mjs held                 list comments waiting for review (also: visible, hidden, spam)
//   node tools/mod.mjs approve <id>         show it
//   node tools/mod.mjs hide <id>            hide it
//   API=http://127.0.0.1:8787 TOKEN=dev-admin node tools/mod.mjs held   (local dev)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const site = JSON.parse(readFileSync(new URL('../content/site.json', import.meta.url)));
const API = process.env.API || site.api;
const TOKEN = process.env.TOKEN || readFileSync(`${homedir()}/.config/wiserax-games/admin.token`, 'utf8').trim();
const [cmd = 'held', id] = process.argv.slice(2);
const h = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'text/plain' };
if (['held', 'visible', 'hidden', 'spam'].includes(cmd)) {
  const r = await (await fetch(`${API}/api/admin/comments?status=${cmd}`, { headers: h })).json();
  if (!r.comments?.length) console.log(`no ${cmd} comments`);
  for (const c of r.comments || []) console.log(`#${c.id} [${c.game}] ${c.name}: ${c.body.replace(/\n/g, ' ')}  (${new Date(c.at * 1000).toISOString().slice(0, 16)}, reports ${c.reports})`);
} else if (cmd === 'approve' || cmd === 'hide') {
  const r = await fetch(`${API}/api/admin/comments/${id}`, { method: 'POST', headers: h, body: JSON.stringify({ status: cmd === 'approve' ? 'visible' : 'hidden' }) });
  console.log(r.ok ? `${cmd}d #${id}` : `failed: ${r.status}`);
} else console.log('usage: node tools/mod.mjs held|visible|hidden|spam|approve <id>|hide <id>');
