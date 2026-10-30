"""Builds src/media/<game>/ stills (WebP, 2 sizes), a round-crop thumb and content/media.json sizes.
Sources are local files from the game projects; loops are encoded separately (tools/loops.sh)."""
import json, sys
from pathlib import Path
from PIL import Image

C = Path('/Users/mac/Documents/Codex')
SRC = {
  'zt': ['zombie-tower/outputs/bi-prototype/02-horde.jpg', 'zombie-tower/outputs/bi-prototype/01-boss.jpg', 'zombie-tower/outputs/bi-prototype/06-blade-frenzy.jpg'],
  'graft': ['graft-design/channel-shots/01-boss-fight-snake-queen.jpg', 'graft-design/channel-shots/02-skeleton-grafted-closeup.jpg', 'graft-design/g33/review-int/04-pick-of-three.png'],
  'necro': ['new-proto/design/islands-rel/i3-golem.png', 'new-proto/design/islands-rel/i3-yard.png', 'new-proto/design/islands-rel/i2-settlement-main.png'],
}
THUMB = {'zt': (0, .30), 'graft': (1, .28), 'necro': (0, .30)}  # (shot index, crop top as share of height)
out = Path('src/media'); man = {}
for g, files in SRC.items():
    d = out / g; d.mkdir(parents=True, exist_ok=True); man[g] = {'shots': []}
    for i, f in enumerate(files, 1):
        im = Image.open(C / f).convert('RGB')
        for w, suf in ((600, ''), (300, '-sm')):
            r = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
            r.save(d / f'shot-{i}{suf}.webp', 'WEBP', quality=74, method=6)
        man[g]['shots'].append([600, round(im.height * 600 / im.width)])
    k, top = THUMB[g]
    im = Image.open(C / files[k]).convert('RGB'); s = int(im.width * .72); x = (im.width - s) // 2; y = int(im.height * top)
    im.crop((x, y, x + s, y + s)).resize((240, 240), Image.LANCZOS).save(d / 'thumb.webp', 'WEBP', quality=78, method=6)
Path('content/media.json').write_text(json.dumps(man, indent=1))
print(json.dumps(man))
