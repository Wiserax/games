"""Share cards (1200x630) for the home page and each game: src/media/og.jpg, src/media/<id>/og.jpg."""
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter
F = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
M = '/System/Library/Fonts/Menlo.ttc'
games = json.load(open('content/games.json'))
ACC = {'zt': (196, 155, 255), 'graft': (255, 197, 61), 'necro': (255, 157, 77)}
MINT = (125, 255, 217)

def phone(src, h):
    im = Image.open(src).convert('RGB'); w = round(im.width * h / im.height)
    im = im.resize((w, h), Image.LANCZOS)
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w, h), radius=28, fill=255)
    return im, m

def glow(c, box, col):
    g = Image.new('RGB', c.size, (0, 0, 0)); ImageDraw.Draw(g).rounded_rectangle(box, radius=40, fill=col)
    g = g.filter(ImageFilter.GaussianBlur(40))
    return Image.blend(c, Image.composite(g, c, Image.new('L', c.size, 110)), 1)

def card(title, pitch, kicker, shots, col, out):
    c = Image.new('RGB', (1200, 630), (0, 0, 0)); d = ImageDraw.Draw(c)
    x = 1200 - 40
    for i, s in enumerate(reversed(shots)):
        im, m = phone(s, 540 - i * 40)
        x -= im.width + 16; y = (630 - im.height) // 2
        c = glow(c, (x, y, x + im.width, y + im.height), col)
        c.paste(im, (x, y), m)
    d = ImageDraw.Draw(c)
    d.text((64, 70), 'wiserax', font=ImageFont.truetype(F, 34), fill=(245, 245, 247))
    d.text((210, 76), '/games', font=ImageFont.truetype(M, 28), fill=MINT)
    d.text((64, 200), kicker.upper(), font=ImageFont.truetype(M, 22), fill=(111, 141, 255))
    size = 92 if len(title) < 8 else 72
    d.text((60, 236), title, font=ImageFont.truetype(F, size), fill=(245, 245, 247))
    y = 236 + size + 26
    words, line = pitch.split(), ''
    for w in words:
        t = (line + ' ' + w).strip()
        if d.textlength(t, font=ImageFont.truetype(F, 34)) > 520: d.text((64, y), line, font=ImageFont.truetype(F, 34), fill=col); y += 44; line = w
        else: line = t
    d.text((64, y), line, font=ImageFont.truetype(F, 34), fill=col)
    d.text((64, 560), 'PLAY FREE IN YOUR PHONE BROWSER', font=ImageFont.truetype(M, 20), fill=(163, 171, 187))
    c.save(out, quality=84, optimize=True)

for g in games:
    card(g['title'], g['pitch'], f"Level {g['level']:02d} · {g['genre']}", [f"src/media/{g['id']}/shot-1.webp", f"src/media/{g['id']}/shot-2.webp"], ACC[g['id']], f"src/media/{g['id']}/og.jpg")
card('Wiserax Games', 'I make games with AI agents. Pick a level.', 'Made with Wisecraft', [f"src/media/{g['id']}/shot-1.webp" for g in games], MINT, 'src/media/og.jpg')
print('ok')
