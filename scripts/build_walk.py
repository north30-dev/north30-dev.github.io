"""临时脚本：侧视行走三帧 → public/assets/hero.png（抠品红底、切帧、基线对齐）。"""

import numpy as np
from PIL import Image

SRC = '.trae/drafts/hero_walk_sheet_v2.jpg'
OUT = 'public/assets/hero.png'
BASELINE, TARGET_H, SHEET = 335, 330, (768, 347)


def key_magenta(im):
    arr = np.array(im.convert('RGBA')).astype(np.float32)
    rgb, a = arr[..., :3], arr[..., 3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    score = np.minimum(r, b) - g
    a = a * (1 - np.clip((score - 22.0) / 22.0, 0, 1))
    spill = np.clip(score, 0, None)
    rgb[..., 0] -= spill * 0.55
    rgb[..., 2] -= spill * 0.55
    return Image.fromarray(np.concatenate([np.clip(rgb, 0, 255), a[..., None]], -1).astype(np.uint8), 'RGBA')


def drop_row_lines(im):
    """去掉横贯整帧的细线（AI 偶尔画的地平线），避免污染包围盒。"""
    arr = np.array(im)
    alpha = arr[..., 3]
    for y in range(alpha.shape[0]):
        if (alpha[y] > 0).mean() > 0.6:
            arr[y, :, 3] = 0
    return Image.fromarray(arr, 'RGBA')


def main():
    sheet = drop_row_lines(key_magenta(Image.open(SRC)))
    w = sheet.width // 3
    parts = [sheet.crop((i * w, 0, (i + 1) * w, sheet.height)) for i in range(3)]
    boxes = [p.getchannel('A').getbbox() for p in parts]
    tallest = max(b[3] - b[1] for b in boxes)
    scale = TARGET_H / tallest
    fw, fh = SHEET[0] // 3, SHEET[1]
    out = Image.new('RGBA', SHEET, (0, 0, 0, 0))
    for i, (p, box) in enumerate(zip(parts, boxes)):
        art = p.crop(box)
        art = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
        if art.width > fw - 6:
            art = art.resize((fw - 6, round(art.height * (fw - 6) / art.width)), Image.LANCZOS)
        out.alpha_composite(art, (i * fw + (fw - art.width) // 2, BASELINE - art.height))
    out.save(OUT)
    print(OUT, out.size, [b[3] - b[1] for b in boxes])

    preview = Image.new('RGBA', (500, 260), (13, 20, 36, 255))
    for i in range(3):
        preview.alpha_composite(out.crop((i * fw, 0, (i + 1) * fw, fh)).resize((150, 203), Image.LANCZOS), (15 + i * 160, 10))
    preview.save('.trae/drafts/walk_preview.png')


if __name__ == '__main__':
    main()
