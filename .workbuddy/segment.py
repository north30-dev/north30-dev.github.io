# -*- coding: utf-8 -*-
"""白底精灵图分割 v2：边缘泛洪识别背景，保留物体内部白色。"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r'D:/dev/projects/web/1024game_dev'
OUT = os.path.join(SRC, '抠图素材')
os.makedirs(OUT, exist_ok=True)

def background_mask(rgb):
    """白色区域中与图像边缘连通的部分 = 背景；物体内部白色保留。"""
    whiteish = (rgb.astype(np.int16).min(axis=2) >= 230)
    lab, n = ndimage.label(whiteish)
    border_labels = set(np.unique(np.concatenate([
        lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border_labels))
    return ~bg  # 前景候选

def clean_watermark(rgba, orig_size):
    """清除右下角灰色水印文字（低饱和灰色小连通域，位于右下角区域）。"""
    h, w = rgba.shape[:2]
    region = rgba[int(h*0.80):, int(w*0.70):]
    r, g, b, a = region[..., 0].astype(int), region[..., 1].astype(int), region[..., 2].astype(int), region[..., 3]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    gray = (a > 0) & (mx - mn < 30) & (mn > 100) & (mx < 235)
    lab, n = ndimage.label(gray)
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        bh, bw = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
        if bh < 40 and bw < 200:  # 文字笔画小块
            region[ys, xs, 3] = 0

def save_components(mask, rgb, base, dilate=4, corner_filter=True):
    mask_d = ndimage.binary_dilation(mask, iterations=dilate)
    lab, n = ndimage.label(mask_d)
    h, w = mask.shape
    results = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        if (x1 - x0) * (y1 - y0) < h * w * 0.0008:
            continue
        if corner_filter and x0 > w * 0.85 and y0 > h * 0.88:
            continue
        sub = mask[y0:y1, x0:x1]
        rgba = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        rgba[..., :3] = rgb[y0:y1, x0:x1]
        rgba[..., 3] = np.where(sub, 255, 0)
        results.append((x0, y0, rgba))
    results.sort(key=lambda t: (t[1] // 150, t[0]))
    for idx, (x0, y0, rgba) in enumerate(results, 1):
        img = Image.fromarray(rgba, 'RGBA')
        img = img.crop(img.getbbox())
        img.save(os.path.join(OUT, f'{base}_{idx:02d}.png'))
    return len(results)

def segment(fname, dilate=4, corner_filter=True):
    im = Image.open(os.path.join(SRC, fname)).convert('RGB')
    rgb = np.asarray(im)
    fg = background_mask(rgb)
    base = os.path.splitext(fname)[0]
    cnt = save_components(fg, rgb, base, dilate, corner_filter)
    print(f'{fname}: {cnt} 个元素')

def segment_grid(fname, rows, cols, dilate=10):
    im = Image.open(os.path.join(SRC, fname)).convert('RGB')
    rgb = np.asarray(im)
    h, w = rgb.shape[:2]
    fg = background_mask(rgb)
    ch, cw = h // rows, w // cols
    count = 0
    base = os.path.splitext(fname)[0]
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * ch, c * cw
            sub = fg[y0:y0 + ch, x0:x0 + cw]
            if sub.sum() < ch * cw * 0.01:
                continue
            rgba = np.zeros((ch, cw, 4), dtype=np.uint8)
            rgba[..., :3] = rgb[y0:y0 + ch, x0:x0 + cw]
            rgba[..., 3] = np.where(sub, 255, 0)
            clean_watermark(rgba, (ch, cw))
            img = Image.fromarray(rgba, 'RGBA')
            img = img.crop(img.getbbox())
            count += 1
            img.save(os.path.join(OUT, f'{base}_{count:02d}.png'))
    print(f'{fname}: {count} 个元素')

if __name__ == '__main__':
    segment_grid('副角色.png', 3, 3, dilate=12)
    segment('宝物.png', dilate=4)
    segment('关卡.png', dilate=6)
    segment('主角色.png', dilate=10)
    # 清理关卡_06 的水印
    p = os.path.join(OUT, '关卡_06.png')
    if os.path.exists(p):
        img = Image.open(p).convert('RGBA')
        a = np.asarray(img).copy()
        clean_watermark(a, img.size)
        img = Image.fromarray(a, 'RGBA')
        img = img.crop(img.getbbox())
        img.save(p)
        print('关卡_06 水印已清理')
