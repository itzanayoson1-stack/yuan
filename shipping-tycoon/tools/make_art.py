"""Turns the team's Gemini mockups into game art (python3 tools/make_art.py SRC_DIR).
- erases the UI baked into the mockups (title, tabs, chips, goal box, date, side panels) by inpainting
- re-signs buildings with the game's fictional names (no real-company names such as Lloyd's or A1)
- cuts portraits for captains and building staff into one sprite sheet
Output: assets/*.jpg next to index.html. Needs Pillow, numpy and opencv-python-headless."""
import sys, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
os.makedirs(OUT, exist_ok=True)

def load(name): return Image.open(os.path.join(SRC, name)).convert('RGB')

def erase(im, boxes, r=9):
    a = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    mask = np.zeros(a.shape[:2], np.uint8)
    for x0, y0, x1, y1 in boxes: mask[max(0, y0):y1, max(0, x0):x1] = 255
    a = cv2.inpaint(a, mask, r, cv2.INPAINT_TELEA)
    # soften the filled patches so the smear reads as haze, not streaks
    blur = cv2.GaussianBlur(a, (0, 0), 6)
    soft = cv2.GaussianBlur(mask, (0, 0), 4).astype(np.float32)[..., None] / 255
    a = (a * (1 - soft) + blur * soft).astype(np.uint8)
    return Image.fromarray(cv2.cvtColor(a, cv2.COLOR_BGR2RGB))

def resign(im, quad, text, ink=(58, 39, 22), inset=4, size=None):
    """Repaint a slanted signboard (TL, TR, BR, BL) with its own median colour and new lettering."""
    (tlx, tly), (trx, try_), (brx, bry), (blx, bly) = quad
    d = ImageDraw.Draw(im)
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).polygon(quad, fill=255)
    px = np.array(im)[np.array(m) > 0]
    board = tuple(int(v) for v in np.median(px, axis=0)) if len(px) else (200, 180, 140)
    slope = (try_ - tly) / (trx - tlx)
    inner = [(tlx + inset, tly + inset + slope * inset), (trx - inset, try_ + inset - slope * inset), (brx - inset, bry - inset), (blx + inset, bly - inset)]
    d.polygon(inner, fill=board)
    w, h = int(trx - tlx), int(bly - tly)
    f = ImageFont.truetype(FONT, size or int(h * 0.62))
    t = Image.new('RGBA', (w, h), (0, 0, 0, 0)); td = ImageDraw.Draw(t)
    bb = td.textbbox((0, 0), text, font=f)
    td.text(((w - (bb[2] - bb[0])) / 2 - bb[0], (h - (bb[3] - bb[1])) / 2 - bb[1]), text, font=f, fill=ink + (255,), stroke_width=1, stroke_fill=ink + (255,))
    H = int(h + abs(slope) * w) + 1
    t = t.transform((w, H), Image.AFFINE, (1, 0, 0, -slope, 1, 0), resample=Image.BICUBIC)
    im.paste(t, (int(tlx), int(tly)), t)

HUD = [(8, 8, 376, 60), (478, 8, 900, 60), (958, 8, 1368, 60), (16, 84, 332, 174), (8, 708, 248, 762), (1072, 552, 1368, 686), (1140, 692, 1368, 762)]
SIGN_BACK = [(595, 109), (663, 134), (662, 155), (594, 130)]

# 모항 낮 (08): the back building is the teahouse
day = erase(load('08_모항_로이드다방_정비소_거래소.jpg'), HUD)
resign(day, SIGN_BACK, '닻 다방')
day.save(os.path.join(OUT, 'port_day.jpg'), quality=84)

# 모항 밤 (04): same layout, older signs → teahouse and exchange
night = erase(load('04_야간_모항_맑은달밤.jpg'), HUD)
resign(night, SIGN_BACK, '닻 다방', ink=(40, 30, 22))
resign(night, [(1026, 291), (1080, 315), (1079, 332), (1025, 309)], '거래소', ink=(40, 30, 22))
night.save(os.path.join(OUT, 'port_night.jpg'), quality=84)

# 거래소 실내 (10): the right-hand panel is cut away, the rest of the baked UI erased
ex = erase(load('10_매선화물거래소_내부_벽보.jpg'), [(4, 4, 395, 64), (12, 80, 336, 175), (954, 4, 1372, 64), (4, 704, 252, 766)]).crop((0, 0, 1070, 768))
# wipe the chalkboard's garbled English line with the board's own colour
d = ImageDraw.Draw(ex); board = tuple(int(v) for v in np.median(np.array(ex.crop((930, 300, 1060, 316))).reshape(-1, 3), axis=0))
d.polygon([(918, 318), (1068, 336), (1068, 370), (918, 352)], fill=board)
ex = Image.fromarray(cv2.GaussianBlur(np.array(ex), (0, 0), 0.01))
ex.save(os.path.join(OUT, 'in_exchange.jpg'), quality=84)

# 닻 다방 실내 (09): the menu is erased and the posters on the far right cut away; both wall signs re-lettered
tea = erase(load('09_로이드다방_내부_선급보험.jpg'), [(4, 4, 275, 64), (474, 4, 904, 64), (954, 4, 1372, 64), (4, 704, 252, 766), (8, 540, 395, 704), (1132, 524, 1372, 766)])
resign(tea, [(825, 59), (964, 99), (961, 147), (824, 107)], '닻 다방', inset=7)
resign(tea, [(1040, 122), (1191, 174), (1190, 232), (1039, 182)], '닻 다방', inset=8)
tea.crop((0, 0, 1236, 768)).save(os.path.join(OUT, 'in_teahouse.jpg'), quality=84)

# portraits: 6 captains, then exchange clerk, teahouse owner, yard foreman (120 px each, one row)
src9, src3, src10 = load('09_로이드다방_내부_선급보험.jpg'), load('03_주간_선대관리_투명HUD.jpg'), load('10_매선화물거래소_내부_벽보.jpg')
faces = [(src9, (440, 415, 530, 505)), (src9, (705, 522, 785, 602)), (src9, (465, 200, 555, 290)), (src3, (1265, 185, 1345, 265)), (src9, (190, 328, 270, 408)), (src3, (1055, 180, 1145, 270)),
         (src10, (675, 300, 765, 390)), (src9, (985, 300, 1075, 390)), (src10, (190, 345, 280, 435))]
sheet = Image.new('RGB', (120 * len(faces), 120))
for i, (im, b) in enumerate(faces): sheet.paste(im.crop(b).resize((120, 120), Image.LANCZOS), (i * 120, 0))
sheet.save(os.path.join(OUT, 'faces.jpg'), quality=88)
print('ok', sorted(os.listdir(OUT)))
