# Contact sheet of burn frames: python3 sheet.py TAG [cols] [width] [every]
import sys, json, glob, os
from PIL import Image, ImageDraw
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'burn') + os.sep
tag = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 4; tw = int(sys.argv[3]) if len(sys.argv) > 3 else 400
every = int(sys.argv[4]) if len(sys.argv) > 4 else 1
files = sorted(glob.glob(D + tag + '_[0-9][0-9].png'))[::every]
times = json.load(open(D + tag + '_times.json'))[::every]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size; th = int(h * tw / w)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 18)), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for k, (im, t) in enumerate(zip(ims, times)):
    x, y = (k % cols) * tw, (k // cols) * (th + 18)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 18))
    d.text((x + 4, y + 3), f'{t[0]} ms' + ('' if t[2] else '  (panel gone)'), fill=(255, 255, 255))
out = D + tag + '_sheet.png'; sheet.save(out); print(out, sheet.size)
