/**
 * LEVEL 状态：Canvas 关卡场景（由 main.ts 主循环驱动，本模块不启动任何 rAF）
 *
 * - 按地标渲染 public/assets/bg-<id>.png 场景背景（onload 完成前绘制兜底底色与加载文案，防白屏）
 * - 主角使用 /assets/hero.png 横向 3 帧序列图（每帧 256x347），左摇杆（死区 0.2）/键盘移动
 * - 宝物按 TREASURE_CONFIG 配置在画面中上部随机生成，使用 public/assets/treasure-01..15.png 实体图绘制
 * - 碰撞收集（距离 < 50）：手柄震动 + 金色粒子 + 宝物文化描述对话框；集齐后弹出"寻宝成功！"
 * - 博物馆为终极合成场景：无收集品，进场播放完整青铜纵目面具复苏动画（暗屏/放大/粒子环/闪光/长震动）
 */

import { axisX, axisY, getKeyboardAxes, getInputSource } from './InputManager';

/** 关卡画布与 2D 上下文（module 脚本延迟执行，DOM 已就绪） */
const canvas = document.getElementById('level-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** 中文字体（画布内文字统一使用） */
const FONT = '"LXGW WenKai", "KaiTi", serif';

/** 行走帧：三张独立透明 PNG（侧视步循环，按 1→2→3 播放）；
 *  bx/by/bw/bh 为图内主体包围盒，绘制时裁掉透明留白，避免帧间左右跳动 */
const HERO_WALK_FRAMES = 3;
interface HeroFrame {
  src: string;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}
const HERO_FRAME_DEFS: HeroFrame[] = [
  { src: '/assets/hero_1.png', bx: 75, by: 0, bw: 221, bh: 319 },
  { src: '/assets/hero_2.png', bx: 71, by: 0, bw: 165, bh: 313 },
  { src: '/assets/hero_3.png', bx: 13, by: 0, bw: 219, bh: 314 },
];
const heroFrames = HERO_FRAME_DEFS.map((def) => {
  const img = new Image();
  img.src = def.src;
  return img;
});
/** 正面待机：单张透明 PNG（静止时使用，不做待机动画） */
const heroIdleImg = new Image();
heroIdleImg.src = '/assets/hero_idle.png';

/** 场景背景图缓存（懒加载，未加载完成前绘制兜底文案） */
const bgCache = new Map<string, HTMLImageElement>();
function getBg(id: string): HTMLImageElement {
  let img = bgCache.get(id);
  if (!img) {
    img = new Image();
    img.src = `/assets/bg-${id}.png`;
    bgCache.set(id, img);
  }
  return img;
}

/** 主角移动速度（px/s） */
const SPEED = 420;
/** 收集判定半径（px） */
const COLLECT_RADIUS = 50;

/** 宝物静态定义：img 对应 public/assets 下的实体图文件名，文案取自 docs/宝物描述.md */
interface TreasureDef {
  img: string;
  name: string;
  desc: string;
}

/** 画面中的宝物实例 */
interface Treasure extends TreasureDef {
  x: number;
  y: number;
}

/** 宝物实体图统一显示高度（px），宽度按原图比例缩放 */
const TREASURE_SIZE = 64;

/** 预加载全部 15 张宝物图（编号 = docs/宝物描述.md 三星堆清单顺序） */
const TREASURE_IMGS: Record<string, HTMLImageElement> = {};
for (let i = 1; i <= 15; i += 1) {
  const name = `treasure-${String(i).padStart(2, '0')}`;
  const img = new Image();
  img.src = `/assets/${name}.png`;
  TREASURE_IMGS[name] = img;
}

/** 博物馆终极合成场景的完整面具图（取自抠图素材/宝物_16.png） */
const maskImg = new Image();
maskImg.src = '/assets/mask-final.png';

/** 博物馆地标 ID（终极合成场景） */
const MUSEUM_ID = 'museum';
/** 合成动画时间轴（s）：暗屏 0→1.0，面具放大 1.0→3.4，3.4s 处闪光+最强震动 */
const SYNTH_REVEAL = 3.4;

/** 各地标的收集品配置（三星堆主题：5 关 × 3 件；博物馆为终极合成场景，无收集品） */
const TREASURE_CONFIG: Record<string, TreasureDef[]> = {
  // 松山湖（科技与自然的交汇）
  ssl: [
    { img: 'treasure-01', name: '纵目之瞳', desc: '青铜面具上高高凸起的眼睛碎片，仿佛蕴含着看透科技未来的光芒。' },
    { img: 'treasure-02', name: '太阳轮微光', desc: '形似方向盘的太阳轮碎片，像极了松山湖科学城里运转的精密齿轮。' },
    { img: 'treasure-03', name: '神树青叶', desc: '青铜神树的一截枝叶，隐喻着自然生态与现代科技的共生。' },
  ],
  // 可园（岭南园林的精致）
  ky: [
    { img: 'treasure-04', name: '金箔残片', desc: '贴在青铜面具上的黄金面罩一角，闪耀着古蜀王权的尊贵。' },
    { img: 'treasure-05', name: '夔龙纹窗', desc: '带有青铜器上常见夔龙纹的碎片，恰好与可园的满洲窗花纹相呼应。' },
    { img: 'treasure-06', name: '云雷涟漪', desc: '回字形的云雷纹碎片，如同可园池塘里泛起的微波。' },
  ],
  // 虎门炮台（海防历史的厚重）
  humen: [
    { img: 'treasure-07', name: '阔口利齿', desc: '面具夸张的阔嘴与獠牙碎片，象征着镇守海疆的威严与力量。' },
    { img: 'treasure-08', name: '青铜战戈', desc: '一截断裂的青铜兵器，与虎门炮台的古代海防属性完美契合。' },
    { img: 'treasure-09', name: '祭祀玉璋', desc: '三星堆祭祀坑出土的玉璋碎片，代表着古人的祈愿与信仰。' },
  ],
  // 南社古村（宗祠岁月的沧桑）
  ns: [
    { img: 'treasure-10', name: '招风神耳', desc: '面具上巨大的招风耳碎片，仿佛能听见南社古村八百年的风雨声。' },
    { img: 'treasure-11', name: '青铜神树座', desc: '青铜神树底部的龙形底座，承载着古蜀人的通天之梦。' },
    { img: 'treasure-12', name: '古蜀灰陶', desc: '三星堆遗址出土的陶器碎片，带着四千年前的泥土气息。' },
  ],
  // 东莞国贸（现代都市的摩天）
  gm: [
    { img: 'treasure-13', name: '高冠之巅', desc: '青铜面具头顶高耸的冠饰碎片，犹如国贸大厦刺破云霄的楼顶。' },
    { img: 'treasure-14', name: '金杖斑纹', desc: '刻有鱼鸟图案的金杖碎片，寓意着这座城市如金般闪耀的财富与活力。' },
    { img: 'treasure-15', name: '时空青铜', desc: '一块未经雕琢的青铜原石，蕴含着穿越时空的能量。' },
  ],
  // 东莞博物馆新馆（终极合成：集齐碎片后在此召唤完整面具，不用收集图标）
  museum: [],
};

/** 六关收齐三件宝物后的剧情文本（古蜀歌谣 + 现代馆员手记） */
const STORY_BY_LEVEL: Record<string, { song: string; note: string }> = {
  ssl: {
    song: '星落湖心，目望天河',
    note: '捡到第一片眼泡时，栏杆外正过一列地铁。四千年前的人也在抬头看天。',
  },
  ky: {
    song: '金箔贴面，龙纹守窗',
    note: '满洲窗和夔龙纹叠在一起，我一时分不清哪个更旧。',
  },
  humen: {
    song: '利齿向海，戈止风涛',
    note: '炮台的铁与祭坑的铜，隔了三千年，守的是同一片海。',
  },
  ns: {
    song: '耳听风雨，树通九天',
    note: '祠堂梁上的灰比面具还厚，八百年的村子替我们收着四千年的梦。',
  },
  gm: {
    song: '高冠刺云，金杖照城',
    note: '在四十二层的玻璃上看见自己，头上像是已经戴着那顶冠。',
  },
  museum: {
    song: '十七归位，面复其光',
    note: '最后一件回来时，展柜里的面具在响——不是碎，是呼吸。',
  },
};

/** 金色收集粒子 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 生命值 1→0，透明度随之衰减 */
  life: number;
}

/** 主角状态（x/y 为脚底锚点） */
const player = { x: 0, y: 0, moving: false, facing: 1 };

/** 行走动画计时（仅移动时累计，用于帧 0/1 切换） */
let animTime = 0;
/** 关卡内全局时间（s）：驱动宝物浮动 / 光环脉冲 / 胜利计时 */
let worldTime = 0;

/** 当前关卡地标 ID 与名称 */
let currentId = 'ssl';
let levelName = '';

/** 场景中的宝物 / 粒子 / 对话框 */
let treasures: Treasure[] = [];
let totalCount = 0;
let particles: Particle[] = [];
let dialog: { name: string; desc: string; timer: number } | null = null;

/** 通关状态与通关时刻 */
let won = false;
let wonAt = 0;

/** 同步画布分辨率与 CSS 尺寸（进入关卡与窗口缩放时调用） */
function resize(): void {
  canvas.width = canvas.clientWidth || window.innerWidth;
  canvas.height = canvas.clientHeight || window.innerHeight;
}
window.addEventListener('resize', resize);

/** 数值夹取 */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ==================================================================
 * UI 绘制组件（Canvas 版，与 DOM 组件共用 :root 设计 token）
 * ================================================================== */

/** 读取 CSS 自定义属性，保证 Canvas 与 DOM 只有一份色值来源 */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 金黄青铜器色板（启动时从 :root 读取一次） */
const C = {
  gold: cssVar('--gold', '#e3b24b'),
  goldHi: cssVar('--gold-hi', '#f8e3a6'),
  goldDim: cssVar('--gold-dim', '#8a5f1f'),
  goldDeep: cssVar('--gold-deep', '#6b4a18'),
  patina: cssVar('--patina', '#4a7a66'),
  lacquer: cssVar('--lacquer', '#16100b'),
  caseBg: cssVar('--case-bg', '#0b0907'),
  ivory: cssVar('--ivory', '#eadcc0'),
  cinnabar: cssVar('--cinnabar', '#8c3327'),
};

/** 按当前输入来源取键帽文案（手柄 / 键盘自动切换） */
function inputLabel(pad: string, kb: string): string {
  return getInputSource() === 'pad' ? pad : kb;
}

/** 展柜铜牌：直角底牌 + 暗金双描边 + 四角铜钉 + 顶边回纹 */
function drawPlaque(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1
): void {
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = C.caseBg;
  c.fillRect(x, y, w, h);

  const sheen = c.createLinearGradient(0, y, 0, y + h);
  sheen.addColorStop(0, 'rgba(227, 178, 75, 0.08)');
  sheen.addColorStop(0.42, 'rgba(227, 178, 75, 0)');
  c.fillStyle = sheen;
  c.fillRect(x, y, w, h);

  c.lineWidth = 1;
  c.strokeStyle = C.goldDim;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.strokeStyle = 'rgba(227, 178, 75, 0.16)';
  c.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);

  c.fillStyle = C.goldDim;
  const studs: ReadonlyArray<readonly [number, number]> = [
    [x + 10, y + 10],
    [x + w - 10, y + 10],
    [x + 10, y + h - 10],
    [x + w - 10, y + h - 10],
  ];
  for (const [sx, sy] of studs) {
    c.beginPath();
    c.arc(sx, sy, 2, 0, Math.PI * 2);
    c.fill();
  }

  c.strokeStyle = 'rgba(227, 178, 75, 0.3)';
  for (let sx = x + 18; sx < x + w - 24; sx += 14) {
    c.beginPath();
    c.moveTo(sx, y + 7);
    c.lineTo(sx + 8, y + 7);
    c.lineTo(sx + 8, y + 3);
    c.stroke();
  }
  c.restore();
}

/** 实体键帽：侧壁 + 金色顶面 + 深色键位字；pressed 时下沉 */
function drawKeycap(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  label: string,
  pressed = false
): void {
  const round = document.body.dataset.input === 'pad';
  const r = round ? size / 2 : Math.max(4, size * 0.2);
  const half = size / 2;
  const x = cx - half;
  const y = cy - half + (pressed ? 2 : 0);

  c.save();
  c.fillStyle = C.goldDeep;
  roundRectPath(c, x, y + 2, size, size, r);
  c.fill();

  const face = c.createLinearGradient(0, y, 0, y + size);
  face.addColorStop(0, C.goldHi);
  face.addColorStop(0.55, C.gold);
  face.addColorStop(1, '#a97b2b');
  c.fillStyle = face;
  roundRectPath(c, x, y, size, size, r);
  c.fill();

  c.lineWidth = 1;
  c.strokeStyle = C.goldDim;
  roundRectPath(c, x + 0.5, y + 0.5, size - 1, size - 1, r);
  c.stroke();

  c.fillStyle = '#2a1b08';
  c.font = `bold ${label.length > 1 ? size * 0.34 : size * 0.42}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, cx, y + half + 0.5);
  c.restore();
}

/** 提示行：键帽 + 宣纸色动作说明，支持左 / 中 / 右对齐 */
function drawHintRow(
  c: CanvasRenderingContext2D,
  items: ReadonlyArray<{ key: string; label: string }>,
  x: number,
  y: number,
  align: 'left' | 'center' | 'right'
): void {
  const size = 34;
  const keyGap = 8;
  const itemGap = 18;
  c.save();
  c.font = `15px ${FONT}`;
  c.textBaseline = 'middle';

  const widths = items.map((it) => size + keyGap + c.measureText(it.label).width);
  const total = widths.reduce((sum, v) => sum + v, 0) + itemGap * (items.length - 1);
  let cur = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;

  items.forEach((it, i) => {
    drawKeycap(c, cur + size / 2, y, size, it.key);
    c.fillStyle = 'rgba(234, 220, 192, 0.92)';
    c.textAlign = 'left';
    c.fillText(it.label, cur + size + keyGap, y + 1);
    cur += widths[i] + itemGap;
  });
  c.restore();
}

/** 在画面中上部随机生成宝物：两两保持间距，且远离主角出生点 */
function spawnTreasures(id: string, w: number, h: number): Treasure[] {
  const defs = TREASURE_CONFIG[id] ?? [];
  const out: Treasure[] = [];
  const spawnX = w * 0.12;
  const spawnY = h * 0.8;
  let minGap = Math.min(w, h) * 0.2;
  for (const def of defs) {
    let x = w * 0.5;
    let y = h * 0.35;
    for (let tries = 0; tries < 60; tries += 1) {
      if (tries > 0 && tries % 20 === 0) minGap *= 0.6; // 重试过多时放宽间距兜底
      x = w * (0.15 + Math.random() * 0.7);
      y = h * (0.15 + Math.random() * 0.4);
      const clear =
        out.every((o) => Math.hypot(o.x - x, o.y - y) >= minGap) &&
        Math.hypot(spawnX - x, spawnY - y) >= 250;
      if (clear) break;
    }
    out.push({ ...def, x, y });
  }
  return out;
}

/** 收集反馈：双马达短震（键盘用户 / 不支持的浏览器静默兜底） */
function vibrateCollect(): void {
  try {
    const pad = navigator.getGamepads()[0];
    pad?.vibrationActuator
      ?.playEffect('dual-rumble', { duration: 100, strongMagnitude: 0.5, weakMagnitude: 0.25 })
      .catch(() => {});
  } catch {
    // 忽略震动异常
  }
}

/** 面具复苏瞬间：最高强度长震动 2000ms（模拟文物重生的震撼感） */
function vibrateBlast(): void {
  try {
    const pad = navigator.getGamepads()[0];
    pad?.vibrationActuator
      ?.playEffect('dual-rumble', { duration: 2000, strongMagnitude: 1.0, weakMagnitude: 1.0 })
      .catch(() => {});
  } catch {
    // 忽略震动异常
  }
}

/** 收集宝物：移除 + 震动 + 金色粒子 + 弹出文化描述对话框 */
function collect(index: number): void {
  const t = treasures[index];
  treasures.splice(index, 1);
  vibrateCollect();
  for (let i = 0; i < 12; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * 160;
    particles.push({
      x: t.x,
      y: t.y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 60,
      life: 0.7 + Math.random() * 0.5,
    });
  }
  // 收齐三件时改为该关的「歌谣 + 手记」，否则维持单件宝物描述
  const story = treasures.length === 0 ? STORY_BY_LEVEL[currentId] : undefined;
  dialog = story
    ? { name: story.song, desc: story.note, timer: 4.6 }
    : { name: t.name, desc: t.desc, timer: 3.5 };
}

/** 进入关卡：重置画布、主角、宝物与全部特效状态 */
export function enterLevel(def: { id: string; name: string }): void {
  resize();
  currentId = def.id;
  levelName = def.name;
  const w = canvas.width;
  const h = canvas.height;
  player.x = w * 0.12;
  player.y = h * 0.8;
  player.moving = false;
  animTime = 0;
  worldTime = 0;
  particles = [];
  dialog = null;
  won = false;
  wonAt = 0;
  treasures = spawnTreasures(def.id, w, h);
  totalCount = treasures.length;
  getBg(def.id); // 立即触发场景图加载
}

/** 每帧更新：移动、碰撞收集、粒子与对话框计时、通关判定 */
export function updateLevel(dt: number): void {
  worldTime += dt;
  const w = canvas.width;
  const h = canvas.height;

  // —— 移动：摇杆（含 0.2 死区）优先，无输入时回退键盘方向键 ——
  let dx = axisX;
  let dy = axisY;
  if (dx === 0 && dy === 0) {
    const kb = getKeyboardAxes();
    dx = kb.x;
    dy = kb.y;
  }
  const mag = Math.hypot(dx, dy);
  player.moving = mag > 0.001;
  if (player.moving) {
    if (dx > 0.05) player.facing = 1;
    else if (dx < -0.05) player.facing = -1;
    const scale = (SPEED / Math.max(1, mag)) * dt; // 归一化，斜向不加速
    player.x = clamp(player.x + dx * scale, 40, w - 40);
    player.y = clamp(player.y + dy * scale, 60, h - 24);
    animTime += dt;
  }

  // —— 碰撞收集（以主角身体中心点判定）——
  const pcx = player.x;
  const pcy = player.y - (h * 0.24) / 2;
  for (let i = treasures.length - 1; i >= 0; i -= 1) {
    const t = treasures[i];
    if (Math.hypot(pcx - t.x, pcy - t.y) < COLLECT_RADIUS) {
      collect(i);
    }
  }

  // —— 粒子运动（带轻微重力，寿命耗尽移除）——
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt * 1.4;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt;
  }

  // —— 对话框计时 ——
  if (dialog) {
    dialog.timer -= dt;
    if (dialog.timer <= 0) dialog = null;
  }

  // —— 通关判定：普通关收集齐即胜；博物馆在面具完全显现时刻触发复苏 ——
  if (currentId === MUSEUM_ID) {
    if (!won && worldTime >= SYNTH_REVEAL) {
      won = true;
      wonAt = worldTime;
      vibrateBlast();
    }
  } else if (!won && totalCount > 0 && treasures.length === 0) {
    won = true;
    wonAt = worldTime;
  }
}

/** 是否已收集全部宝物 */
export function isLevelWon(): boolean {
  return won;
}

/** 通关后经过的秒数（供"延迟 1.5 秒"判定） */
export function winElapsed(): number {
  return won ? worldTime - wonAt : 0;
}

/** 手绘圆角矩形路径（不依赖实验性 roundRect API） */
function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * 宝物绘制：使用 public/assets/treasure-01..17.png 实体图（编号对应 docs/宝物描述.md 清单顺序）。
 * (x, y) 为宝物中心；t 为全局时间，驱动浮动与光环脉冲；图片未加载完成时以发光圆球兜底。
 */
function drawTreasure(c: CanvasRenderingContext2D, imgName: string, x: number, y: number, t: number): void {
  // 脉冲光环底座
  const pulse = 0.6 + 0.4 * Math.sin(t * 3);
  c.save();
  c.globalAlpha = 0.25 + 0.2 * pulse;
  c.fillStyle = C.gold;
  c.beginPath();
  c.ellipse(x, y + TREASURE_SIZE * 0.42, 20 + 5 * pulse, 6 + 2 * pulse, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();

  const img = TREASURE_IMGS[imgName];
  if (img && img.complete && img.naturalWidth > 0) {
    const dh = TREASURE_SIZE;
    const dw = (dh * img.naturalWidth) / img.naturalHeight;
    c.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
  } else {
    // 图片未就绪兜底：青铜色发光圆球
    c.save();
    c.shadowColor = C.gold;
    c.shadowBlur = 12;
    c.fillStyle = C.patina;
    c.beginPath();
    c.arc(x, y, 14, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}

/** 文本按宽度折行（中文逐字断行），超出 maxLines 时截断加省略号 */
function wrapText(c: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (cur && c.measureText(cur + ch).width > maxWidth) {
      if (lines.length === maxLines - 1) {
        while (cur && c.measureText(cur + '…').width > maxWidth) {
          cur = cur.slice(0, -1);
        }
        lines.push(cur + '…');
        return lines;
      }
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 底部文化描述对话框：展柜铜牌（金色竖条 + 金色宝物名 + 宣纸色描述，自动折行，末段淡出） */
function drawDialog(): void {
  if (!dialog) return;
  const w = canvas.width;
  const h = canvas.height;
  const fade = Math.min(1, dialog.timer / 0.4);
  ctx.save();
  ctx.globalAlpha = fade;
  const boxW = Math.min(660, w * 0.82);
  ctx.font = `16px ${FONT}`;
  const lines = wrapText(ctx, dialog.desc, boxW - 64, 3);
  const boxH = 64 + lines.length * 24;
  const bx = (w - boxW) / 2;
  const by = h - boxH - 30;
  drawPlaque(ctx, bx, by, boxW, boxH, fade);
  // 左侧金色竖条
  ctx.fillStyle = C.gold;
  ctx.fillRect(bx + 6, by + 12, 3, boxH - 24);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.gold;
  ctx.font = `bold 21px ${FONT}`;
  ctx.fillText(`「${dialog.name}」`, bx + 32, by + 34);
  ctx.fillStyle = 'rgba(234, 220, 192, 0.92)';
  ctx.font = `16px ${FONT}`;
  lines.forEach((ln, i) => ctx.fillText(ln, bx + 32, by + 62 + i * 24));
  ctx.restore();
}

/** HUD：左上角收集进度铜牌 + 右上角返回键帽提示 */
function drawHud(): void {
  const w = canvas.width;
  if (totalCount > 0) {
    const text = `收集进度  ${totalCount - treasures.length} / ${totalCount}`;
    drawPlaque(ctx, 20, 18, 210, 42);
    ctx.save();
    ctx.font = `bold 19px ${FONT}`;
    ctx.fillStyle = C.gold;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 36, 40);
    ctx.restore();
  }
  drawHintRow(ctx, [{ key: inputLabel('B', 'Esc'), label: '返回地图' }], w - 24, 40, 'right');
}

/** easeOutBack 缓动（带轻微过冲，让面具"弹出"感更强） */
function easeOutBack(x: number): number {
  const s = 1.70158;
  const t = x - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
}

/**
 * 博物馆终极合成动画：
 * 0→1.0s 屏幕变暗 → 1.0→3.4s 完整青铜纵目面具由小放大（金/青双色粒子环绕旋转）
 * → 3.4s 中心闪光 + 2000ms 最强震动 → 随后"镇馆之宝"文案与按 A 返回提示。
 */
function drawSynthesis(): void {
  const w = canvas.width;
  const h = canvas.height;
  const t = worldTime;
  const cx = w / 2;
  const cy = h * 0.44;

  // 1. 屏幕变暗
  ctx.fillStyle = `rgba(2, 6, 18, ${Math.min(0.8, (t / 1.0) * 0.8)})`;
  ctx.fillRect(0, 0, w, h);

  // 1b. 锈的剪影：0.7s 淡入、2.2s 前退场（多段色标模拟模糊软边）
  const rustAlpha = clamp((t - 0.2) / 0.5, 0, 1) * clamp((2.2 - t) / 0.4, 0, 1);
  if (rustAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = rustAlpha;
    ctx.translate(cx, cy);
    ctx.scale(1, 0.9);
    const rust = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.42);
    rust.addColorStop(0, 'rgba(140, 51, 39, 0.58)');
    rust.addColorStop(0.55, 'rgba(140, 51, 39, 0.3)');
    rust.addColorStop(1, 'rgba(140, 51, 39, 0)');
    ctx.fillStyle = rust;
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = rustAlpha;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#d08b76';
    ctx.font = `bold ${Math.floor(h * 0.038)}px ${FONT}`;
    ctx.fillText('锈来了。它想借面具，重新长出自己的脸。', cx, h * 0.82);
    ctx.restore();
  }

  // 2. 金/青双色旋转粒子环（暗屏后淡入，内外双环反向旋转）
  const ringAlpha = clamp((t - 0.8) / 0.8, 0, 1);
  if (ringAlpha > 0) {
    const drawRing = (count: number, radius: number, color: string, speed: number, phase: number, size: number): void => {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      for (let i = 0; i < count; i += 1) {
        const ang = phase + (i / count) * Math.PI * 2 + t * speed;
        const px = cx + Math.cos(ang) * radius;
        const py = cy + Math.sin(ang) * radius * 0.55;
        ctx.globalAlpha = ringAlpha * (0.5 + 0.5 * Math.sin(ang * 2 + t * 4));
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    };
    drawRing(26, h * 0.3, C.goldHi, 1.6, 0, 4);
    drawRing(18, h * 0.38, C.patina, -1.1, Math.PI / 3, 3);
  }

  // 3. 完整青铜纵目面具：由小到大（easeOutBack 过冲）+ 金色辉光
  const maskReady = maskImg.complete && maskImg.naturalWidth > 0;
  if (maskReady) {
    const progress = clamp((t - 1.0) / (SYNTH_REVEAL - 1.0), 0, 1);
    const scale = t < 1.0 ? 0 : easeOutBack(progress);
    const dh = h * 0.42 * scale;
    const dw = (dh * maskImg.naturalWidth) / maskImg.naturalHeight;
    if (dh > 1) {
      ctx.save();
      ctx.shadowColor = 'rgba(227, 178, 75, 0.85)';
      ctx.shadowBlur = 60;
      ctx.drawImage(maskImg, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    }
  }

  // 4. 复苏瞬间：全屏闪光 + 扩散光环
  if (t >= SYNTH_REVEAL) {
    const fl = 1 - (t - SYNTH_REVEAL) / 0.6;
    if (fl > 0) {
      ctx.fillStyle = `rgba(255, 244, 214, ${fl * 0.85})`;
      ctx.fillRect(0, 0, w, h);
    }
    const ringR = ((t - SYNTH_REVEAL) / 0.9) * h * 0.6;
    if (ringR < h * 0.6) {
      ctx.strokeStyle = `rgba(227, 178, 75, ${1 - ringR / (h * 0.6)})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, ringR, ringR * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 5. 复苏文案：主行 + 「十七道碎光归位」，结局字幕淡入时同步淡出
  const endAlpha = clamp((t - SYNTH_REVEAL - 3.0) / 0.8, 0, 1);
  if (t >= SYNTH_REVEAL + 0.2 && endAlpha < 1) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = clamp((t - SYNTH_REVEAL - 0.2) / 0.5, 0, 1) * (1 - endAlpha);
    ctx.shadowColor = 'rgba(227, 178, 75, 0.9)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = C.goldHi;
    ctx.font = `bold ${Math.floor(h * 0.05)}px ${FONT}`;
    ctx.fillText('镇馆之宝·青铜纵目面具，已完整复苏！', cx, h * 0.79);

    ctx.shadowBlur = 0;
    ctx.fillStyle = C.gold;
    ctx.font = `${Math.floor(h * 0.0275)}px ${FONT}`;
    ctx.fillText('十七道碎光归位，特展如期开幕。', cx, h * 0.845);
    ctx.restore();
  }

  // 6. 结局字幕：全屏淡入（暗场 + 两行题词），保留 A 键返回提示
  if (endAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = endAlpha;
    ctx.fillStyle = 'rgba(2, 6, 18, 0.62)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(227, 178, 75, 0.7)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = C.goldHi;
    ctx.font = `bold ${Math.floor(h * 0.045)}px ${FONT}`;
    ctx.fillText('文物不是被收藏，而是被记住。', cx, h * 0.42);

    ctx.shadowBlur = 12;
    ctx.fillStyle = C.gold;
    ctx.font = `${Math.floor(h * 0.032)}px ${FONT}`;
    ctx.fillText('—— 瞳 & 昭', cx, h * 0.5);
    ctx.restore();
  }

  if (won && worldTime - wonAt > 1.5) {
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin((worldTime - wonAt) * 5);
    drawHintRow(ctx, [{ key: inputLabel('A', '空格'), label: '返回大地图' }], cx, h * 0.955, 'center');
    ctx.restore();
  }
}

/** 通关结算：暗化遮罩 + 展柜铜牌 + 金色大字，1.5s 后出现键帽返回提示 */
function drawWin(): void {
  const w = canvas.width;
  const h = canvas.height;
  const el = worldTime - wonAt;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.fillRect(0, 0, w, h);

  const pw = Math.min(560, w * 0.82);
  const ph = 190;
  const px = (w - pw) / 2;
  const py = h / 2 - ph / 2 - 6;
  drawPlaque(ctx, px, py, pw, ph);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(227, 178, 75, 0.9)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = C.goldHi;
  ctx.font = `bold ${Math.floor(Math.min(ph * 0.34, w * 0.09))}px ${FONT}`;
  ctx.fillText('寻宝成功！', w / 2, py + ph * 0.44);
  ctx.restore();

  if (el > 1.5) {
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(el * 5);
    drawHintRow(ctx, [{ key: inputLabel('A', '空格'), label: '返回大地图' }], w / 2, py + ph - 34, 'center');
    ctx.restore();
  }
}

/** 每帧绘制：背景 → 宝物 → 主角 → 粒子 → HUD → 对话框 → 通关层 */
export function drawLevel(): void {
  const w = canvas.width;
  const h = canvas.height;
  const bg = getBg(currentId);
  if (bg.complete && bg.naturalWidth > 0) {
    ctx.drawImage(bg, 0, 0, w, h); // 场景图铺满画布
  } else {
    // 场景图 onload 之前：兜底底色 + 加载文案，防止白屏
    ctx.fillStyle = C.lacquer;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(234, 220, 192, 0.75)';
    ctx.font = `24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${levelName} · 场景加载中…`, w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }

  // 宝物（带上下浮动）
  treasures.forEach((t, i) => {
    drawTreasure(ctx, t.img, t.x, t.y + Math.sin(worldTime * 2 + i * 1.3) * 4, worldTime + i);
  });

  // 主角：静止画正面立绘，移动时 3 帧侧视步行循环，朝左整体镜像
  const heroH = h * 0.24;
  const useIdle = !player.moving;
  const frame = Math.floor(animTime / 0.16) % HERO_WALK_FRAMES;
  const def = HERO_FRAME_DEFS[frame];
  const heroDrawImg = useIdle ? heroIdleImg : heroFrames[frame];
  if (heroDrawImg.complete && heroDrawImg.naturalWidth > 0) {
    // 走动帧按主体包围盒裁切绘制；静止帧用整图（本身已紧裁）
    const sx = useIdle ? 0 : def.bx;
    const sy = useIdle ? 0 : def.by;
    const sw = useIdle ? heroDrawImg.naturalWidth : def.bw;
    const sh = useIdle ? heroDrawImg.naturalHeight : def.bh;
    const heroW = (heroH * sw) / sh;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(player.x, player.y, heroH * 0.24, heroH * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    if (!useIdle && player.facing < 0) {
      ctx.translate(player.x * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(heroDrawImg, sx, sy, sw, sh, player.x - heroW / 2, player.y - heroH, heroW, heroH);
    ctx.restore();
  }

  // 金色粒子（透明度随寿命衰减）
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = C.goldHi;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 + p.life * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 博物馆：终极合成场景（暗屏 + 面具复苏动画覆盖在场景与主角之上）
  if (currentId === MUSEUM_ID) {
    drawSynthesis();
    drawHud();
    return;
  }

  drawHud();
  if (won) drawWin();
  if (dialog) drawDialog(); // 收齐三件时剧情压过结算层，保证歌谣/手记可读
}
