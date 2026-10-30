#!/bin/sh
# One-time setup and deploy of the likes/comments API on Cloudflare (free plan), after `npx wrangler login`.
# Creates the D1 database, the schema and two secrets, deploys the Worker, then points the site at it.
# The admin token is written to ~/.config/wiserax-games/admin.token (never into the repo).
set -e
cd "$(dirname "$0")/../api"
W="npx wrangler"
$W whoami >/dev/null 2>&1 || { echo "Not logged in: run npx wrangler login first"; exit 1; }

if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then
  id=$($W d1 create wiserax-games 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -n "$id" ] || { echo "could not create the database"; exit 1; }
  sed -i '' "s/00000000-0000-0000-0000-000000000000/$id/" wrangler.toml
  echo "database $id"
fi
$W d1 execute wiserax-games --remote --file schema.sql -y >/dev/null
echo "schema ok"

mkdir -p "$HOME/.config/wiserax-games"; chmod 700 "$HOME/.config/wiserax-games"
tok="$HOME/.config/wiserax-games/admin.token"
[ -s "$tok" ] || { openssl rand -hex 24 > "$tok"; chmod 600 "$tok"; }
tr -d '\n' < "$tok" | $W secret put ADMIN_TOKEN >/dev/null
salt="$HOME/.config/wiserax-games/ip.salt"
[ -s "$salt" ] || { openssl rand -hex 24 > "$salt"; chmod 600 "$salt"; }
tr -d '\n' < "$salt" | $W secret put IP_SALT >/dev/null
echo "secrets ok"

url=$($W deploy 2>&1 | tee /dev/stderr | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$url" ] || { echo "deploy did not print a workers.dev url"; exit 1; }
curl -sf "$url/api/stats" >/dev/null && echo "api live at $url"

cd ..
node -e "const f='content/site.json',j=JSON.parse(require('fs').readFileSync(f));j.api='$url';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
node build.mjs
echo "now commit and push to publish: git add -A && git commit -m 'Turn on likes and comments' && git push"
