# 城堡战争模式地图：上下两条大路，中间是海。输出 assets/castle/ground.jpg（HD=2）
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
import os

W, H, HD = 1200, 600, 2
DW, DH = W * HD, H * HD
ROAD_Y = (110, 490)   # 上下大路中线（逻辑坐标）
ROAD_W = 56
SEA = (250, 180, 950, 420)  # 海（逻辑坐标，圆角）
OUT = 'assets/castle'
os.makedirs(OUT, exist_ok=True)

def tile(path, scale):
    t = Image.open(path).convert('RGB')
    t = t.resize((int(t.width * scale), int(t.height * scale)), Image.LANCZOS)
    big = Image.new('RGB', (DW, DH))
    for y in range(0, DH, t.height):
        for x in range(0, DW, t.width):
            big.paste(t, (x, y))
    return np.asarray(big).astype(np.float32)

def mask(draw_fn, blur):
    m = Image.new('L', (DW, DH), 0)
    draw_fn(ImageDraw.Draw(m))
    return np.asarray(m.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32)[..., None] / 255

grass = tile('art_src/map/grass.png', .6)
water = tile('art_src/map/water.png', .6)
shallow = tile('art_src/map/shallow.png', .6)

# 大片明暗斑，避免草地太平
rng = np.random.default_rng(3)
noise = Image.fromarray((rng.random((DH // 64, DW // 64)) * 255).astype(np.uint8)).resize((DW, DH), Image.BICUBIC)
noise = np.asarray(noise.filter(ImageFilter.GaussianBlur(40))).astype(np.float32)[..., None] / 255
img = grass * (0.88 + 0.24 * noise)

# 大路：草被踩出来的浅色土路（软边，没有硬缝）
def roads(d):
    for y in ROAD_Y:
        d.rounded_rectangle([20 * HD, (y - ROAD_W / 2) * HD, (W - 20) * HD, (y + ROAD_W / 2) * HD], radius=ROAD_W * HD // 2, fill=255)
    # 两侧基地前的竖向连接路
    for x in (130, W - 130):
        d.rounded_rectangle([(x - 22) * HD, ROAD_Y[0] * HD, (x + 22) * HD, ROAD_Y[1] * HD], radius=22 * HD, fill=200)
rm = mask(roads, 14)
lum = grass.mean(axis=2, keepdims=True)
dirt = (lum - lum.mean()) * .8 + np.array([168, 140, 98])  # 暖土色，保留草纹的明暗
img = img * (1 - rm * .9) + dirt * (rm * .9)

# 海：浅滩 -> 深水，岸边白浪
sx0, sy0, sx1, sy1 = [v * HD for v in SEA]
# 海岸线：圆角矩形大模糊后用噪声扰动再取阈值，得到不规则海岸
def sea_shape(d): d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=100 * HD, fill=255)
base = mask(sea_shape, 60)[..., 0]
n2 = Image.fromarray((rng.random((DH // 48, DW // 48)) * 255).astype(np.uint8)).resize((DW, DH), Image.BICUBIC)
n2 = np.asarray(n2.filter(ImageFilter.GaussianBlur(18))).astype(np.float32) / 255
field = base + (n2 - .5) * .35
def soft(th, w): return np.clip((field - th) / w, 0, 1)[..., None]
mo = soft(.5, .03)
mi = soft(.62, .12)
img = img * (1 - mo) + shallow * mo
img = img * (1 - mi) + water * mi
edge = np.clip(mo * (1 - mo) * 4, 0, 1)  # 岸线一圈
foam = np.clip(edge - 0.35, 0, 1) * 1.6
img = img * (1 - foam * .6) + 245 * foam * .6

Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(f'{OUT}/ground.jpg', quality=88)
print('ok', DW, DH)
