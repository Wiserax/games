// Tiny static server for local checks (Range support for the video loops). node tools/serve.mjs [dir] [port]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const [dir = 'docs', port = 8790] = process.argv.slice(2);
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json' };
createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let f = join(dir, p);
  try { if (statSync(f).isDirectory()) f = join(f, 'index.html'); } catch {}
  let st;
  try { st = statSync(f); } catch { res.writeHead(404, { 'Content-Type': T['.html'] }); return createReadStream(join(dir, '404.html')).pipe(res); }
  const type = T[extname(f)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
    return createReadStream(f, { start: s, end: e }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
  createReadStream(f).pipe(res);
}).listen(+port, '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}/`));
