/**
 * 《寻宝东莞》主入口
 *
 * 初始化输入系统与 requestAnimationFrame 主循环，
 * 按全局状态分发输入：START（首页）→ WORLD_MAP（地图选关）⇄ LEVEL（关卡内）。
 * 终极关卡（东莞博物馆新馆）需完成其余全部关卡后解锁，完成进度存于 localStorage。
 */

import { GameState, currentState, setState } from './state';
import {
  initInput,
  isAButtonJustPressed,
  isBButtonJustPressed,
  isLeftJustPressed,
  isRightJustPressed,
  isUpJustPressed,
  isDownJustPressed,
  isChannelDown,
  getInputSource,
  refreshGamepad,
  type ChannelName,
} from './InputManager';
import {
  enterLevel as enterLevelScene,
  updateLevel,
  drawLevel,
  isLevelWon,
  winElapsed,
  isCinematic,
  getTreasureGuide,
} from './level';

/** 关卡定义 */
interface LevelDef {
  name: string;
  sub: string;
  /** 地标 ID：对应宝物配置与场景背景 bg-<id>.png */
  id: string;
}

const LEVELS: LevelDef[] = [
  { name: '虎门炮台', sub: '海防历史', id: 'humen' },
  { name: '东莞博物馆新馆', sub: '终极关卡', id: 'museum' },
  { name: '可园', sub: '岭南园林', id: 'ky' },
  { name: '东莞国贸', sub: '现代都市', id: 'gm' },
  { name: '松山湖', sub: '科技与自然交融', id: 'ssl' },
  { name: '南社古村', sub: '明清宗祠', id: 'ns' },
];

/** 终极关卡（东莞博物馆新馆）的节点下标：完成其余关卡后解锁 */
const FINAL_LEVEL_INDEX = 1;

/** 各关卡节点在地图上的坐标（left%/top%，与 index.html 内联样式一致，y 向下为正） */
const LEVEL_POS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 13, y: 59 }, // 虎门炮台
  { x: 30, y: 43 }, // 东莞博物馆新馆
  { x: 33, y: 16 }, // 可园
  { x: 45, y: 28 }, // 东莞国贸
  { x: 48, y: 53.5 }, // 松山湖
  { x: 71, y: 38 }, // 南社古村
];

/** 键帽提示项：keys 为需要展示的实体键帽，label 为动作说明 */
interface HintItemDef {
  keys: ChannelName[];
  label: string;
}

/** 手柄键位文案（实体键帽正面） */
const PAD_LABEL: Record<ChannelName, string> = {
  a: 'A',
  b: 'B',
  left: '◀',
  right: '▶',
  up: '▲',
  down: '▼',
};

/** 键盘键位文案（自动切换时使用） */
const KB_LABEL: Record<ChannelName, string> = {
  a: '空格',
  b: 'Esc',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
};

/** 大地图底部默认提示 */
const MAP_HINTS: HintItemDef[] = [
  { keys: ['left', 'right', 'up', 'down'], label: '选择关卡' },
  { keys: ['a'], label: '进入' },
  { keys: ['b'], label: '返回首页' },
];

/** 首页底部默认提示 */
const START_HINTS: HintItemDef[] = [
  { keys: ['left', 'right'], label: '选择' },
  { keys: ['a'], label: '确认' },
];

/**
 * 按空间方位查找最近邻关卡节点：在指定方向的半平面内，
 * 取"前进距离 + 2×侧向偏移"评分最小者；找不到则保持原地。
 */
function neighborOf(from: number, dx: number, dy: number): number {
  const cur = LEVEL_POS[from];
  let best = from;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < LEVEL_POS.length; i += 1) {
    if (i === from) continue;
    const ox = LEVEL_POS[i].x - cur.x;
    const oy = LEVEL_POS[i].y - cur.y;
    const forward = ox * dx + oy * dy; // 沿方向的投影前进量
    if (forward <= 1) continue; // 必须确实在该方向前方（1% 容差）
    const side = Math.abs(ox * dy - oy * dx); // 垂直于方向的偏移量
    const score = forward + side * 2; // 侧偏越大越不可取
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** 完成进度持久化键名 */
const STORAGE_KEY = 'xunbao-dongguan-completed';

/** 当前在大地图上选中的关卡下标（0 起） */
let selectedLevel = 0;

/** 各关卡完成状态 */
let completed: boolean[] = loadCompleted();

/** 地图提示语还原定时器 */
let hintTimer: number | undefined;

/** 终极关卡解锁公告是否已播报 */
let finalUnlockAnnounced = false;

/** 首页按钮选中项：0=继续游戏 1=重置关卡 */
let startSelection = 0;

/** 首页提示语还原定时器 */
let startHintTimer: number | undefined;

/** 读取本地完成的关卡进度 */
function loadCompleted(): boolean[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return LEVELS.map(() => false);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return LEVELS.map(() => false);
    return LEVELS.map((_, i) => parsed[i] === true);
  } catch {
    return LEVELS.map(() => false);
  }
}

/** 保存完成进度 */
function saveCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  } catch {
    // 隐私模式等存储不可用场景：仅内存记录，静默降级
  }
}

/** 终极关卡是否已解锁（其余关卡全部完成） */
function isFinalUnlocked(): boolean {
  return LEVELS.every((_, i) => i === FINAL_LEVEL_INDEX || completed[i]);
}

/** 显示/隐藏屏幕（.hidden 类控制 opacity 渐隐渐显） */
function showScreen(id: string, show: boolean): void {
  document.getElementById(id)?.classList.toggle('hidden', !show);
}

/** 单个实体键帽元素（键位文案由 CSS 依据 body[data-input] 自动切换） */
function createKeycap(channel: ChannelName): HTMLElement {
  const cap = document.createElement('span');
  cap.className = `keycap keycap--${channel}`;
  if (channel === 'left' || channel === 'right' || channel === 'up' || channel === 'down') {
    cap.classList.add('keycap--dpad');
  }
  cap.dataset.pad = PAD_LABEL[channel];
  cap.dataset.kb = KB_LABEL[channel];
  cap.dataset.channel = channel;
  cap.setAttribute('aria-hidden', 'true');
  return cap;
}

/** 渲染简牍提示条：键帽 + 动作说明 */
function renderHint(container: HTMLElement | null, items: HintItemDef[]): void {
  if (!container) return;
  container.replaceChildren();
  for (const item of items) {
    const group = document.createElement('span');
    group.className = 'hint-item';
    for (const key of item.keys) group.appendChild(createKeycap(key));
    const label = document.createElement('span');
    label.className = 'hint-label';
    label.textContent = item.label;
    group.appendChild(label);
    container.appendChild(group);
  }
}

/** 提示条临时显示纯文本，计时结束恢复键帽结构 */
function showHintText(container: HTMLElement | null, text: string): void {
  if (!container) return;
  container.replaceChildren();
  const node = document.createElement('span');
  node.className = 'hint-text';
  node.textContent = text;
  container.appendChild(node);
}

/** 临时替换地图提示文案，稍后还原 */
function flashMapHint(text: string, duration = 2200): void {
  const hint = document.getElementById('map-hint');
  if (!hint) return;
  showHintText(hint, text);
  if (hintTimer !== undefined) clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    renderHint(hint, MAP_HINTS);
    hintTimer = undefined;
  }, duration);
}

/** 临时替换首页提示文案，稍后还原 */
function flashStartHint(text: string, duration = 2200): void {
  const hint = document.querySelector<HTMLElement>('#start-screen .start-hint');
  if (!hint) return;
  showHintText(hint, text);
  if (startHintTimer !== undefined) clearTimeout(startHintTimer);
  startHintTimer = window.setTimeout(() => {
    renderHint(hint, START_HINTS);
    startHintTimer = undefined;
  }, duration);
}

/* ===== 首页剧情：文字流 ===== */

/** 剧情段落类型：旁白 / 地点标题 / 宝物名 / 宝物介绍 */
type StoryKind = 'line' | 'place' | 'name' | 'desc';

interface StorySeg {
  kind: StoryKind;
  text: string;
}

const STORY_CLASS: Record<StoryKind, string> = {
  line: 'story-line',
  place: 'story-place',
  name: 'story-name',
  desc: 'story-desc',
};

/** 普通字符与标点的打字间隔（s） */
const STORY_CHAR_TIME = 0.026;
const STORY_PUNCT_TIME = 0.14;

/** 剧情播放状态 */
let storyActive = false;
let storyDone = false;
/** 0 = 现状与操作引导，1 = 宝物介绍（独立一屏，从头播放） */
let storyPage = 0;
let storySegs: StorySeg[] = [];
let storyIndex = 0;
let storyChar = 0;
let storyAcc = 0;
let storyWait = 0;
let storyCurrentEl: HTMLElement | null = null;

/** 第一屏：面具碎裂的现状 + 操作与目标引导 */
function buildNarrativeSegments(): StorySeg[] {
  const lines = [
    '昨夜子时，镇馆的纵目面具自己裂开了。灵韵散成十五道碎光，落进东莞六个地方。',
    '我是从神树纹里醒来的昭，你是守藏灵瞳——去把它们带回来，别让「锈」先找到。',
    '你刚醒，腿脚还生疏。用方向键或左摇杆移动瞳，靠近散落的碎光，按确认键把它们收回来。',
    '每处地方藏着三件宝物。收齐三件，寻宝图上那个地方才会亮起来。',
    '五处全部点亮后，东莞博物馆新馆的门会为你打开。昭会在那里等你，把宝物一并交给我。',
  ];
  return lines.map((text) => ({ kind: 'line', text }));
}

/** 第二屏：统一介绍这一路要找回的全部宝物（纯文字，居中，不放图片） */
function buildTreasureSegments(): StorySeg[] {
  const segs: StorySeg[] = [];
  segs.push({
    kind: 'line',
    text: '出发前，先认一认这一路要找回的十五件碎光。它们不是战利品，是面具的一部分。',
  });

  const numerals = ['壹', '贰', '叁', '肆', '伍'];
  getTreasureGuide().forEach((place, i) => {
    segs.push({ kind: 'place', text: `${numerals[i] ?? ''} · ${place.place}` });
    place.items.forEach((item) => {
      segs.push({ kind: 'name', text: `【${item.name}】` });
      segs.push({ kind: 'desc', text: item.desc });
    });
  });

  segs.push({ kind: 'line', text: '都记住了吗？按确认键，踏上东莞寻宝图。' });
  return segs;
}

/** 显示剧情提示：打字中可跳过；第一屏结束后查看宝物，第二屏结束后进入大地图 */
function renderStoryHint(typing: boolean): void {
  let label = '进入大地图';
  if (typing) label = '跳过剧情';
  else if (storyPage === 0) label = '查看宝物';
  renderHint(document.getElementById('story-hint'), [{ keys: ['a'], label }]);
}

/** 开始指定剧情页：清空容器、从顶部重新播放文字流 */
function startStoryPage(page: number): void {
  storyPage = page;
  storyDone = false;
  storySegs = page === 0 ? buildNarrativeSegments() : buildTreasureSegments();
  storyIndex = 0;
  storyChar = 0;
  storyAcc = 0;
  storyWait = 0.22;
  storyCurrentEl = null;
  const box = document.getElementById('story-text');
  if (box) {
    box.replaceChildren();
    box.scrollTop = 0;
  }
  renderStoryHint(true);
}

/** 从首页按钮进入文字流剧情 */
function startStory(): void {
  showScreen('start-screen', false);
  showScreen('story-screen', true);
  storyActive = true;
  startStoryPage(0);
}

/** 立即补全当前剧情页文字（跳过打字）；第一屏结束后稍作停顿自动进入宝物页 */
function finishStoryInstant(): void {
  const box = document.getElementById('story-text');
  if (box) {
    const frag = document.createDocumentFragment();
    for (const seg of storySegs) {
      const el = document.createElement('div');
      el.className = STORY_CLASS[seg.kind];
      el.textContent = seg.text;
      frag.appendChild(el);
    }
    box.replaceChildren(frag);
    box.scrollTop = box.scrollHeight;
  }
  storyCurrentEl = null;
  storyDone = true;
  storySegs = [];
  renderStoryHint(false);
}

/** 输出下一个字符；段落结束时插入短暂停顿 */
function advanceStoryChar(): void {
  if (storyIndex >= storySegs.length) {
    finishStoryInstant();
    return;
  }
  const seg = storySegs[storyIndex];
  if (!storyCurrentEl) {
    storyCurrentEl = document.createElement('div');
    storyCurrentEl.className = STORY_CLASS[seg.kind];
    document.getElementById('story-text')?.appendChild(storyCurrentEl);
  }
  storyChar += 1;
  storyCurrentEl.textContent = seg.text.slice(0, storyChar);
  const box = document.getElementById('story-text');
  if (box) box.scrollTop = box.scrollHeight;

  if (storyChar >= seg.text.length) {
    storyIndex += 1;
    storyChar = 0;
    storyCurrentEl = null;
    storyWait = seg.kind === 'line' ? 0.2 : seg.kind === 'place' ? 0.14 : 0.06;
  }
  if (storyIndex >= storySegs.length) finishStoryInstant();
}

/** 按 dt 推进打字机：标点处放慢，保证阅读节奏 */
function updateStory(dt: number): void {
  if (storyDone) return;
  if (storyWait > 0) {
    storyWait -= dt;
    if (storyWait > 0) return;
  }
  storyAcc += dt;
  let guard = 0;
  while (!storyDone && storyAcc > 0 && guard < 400) {
    guard += 1;
    const seg = storySegs[storyIndex];
    if (!seg) {
      finishStoryInstant();
      break;
    }
    const ch = storyChar < seg.text.length ? seg.text[storyChar] : '';
    const cost = ch && '，。；：！？—…'.includes(ch) ? STORY_PUNCT_TIME : STORY_CHAR_TIME;
    if (storyAcc < cost) break;
    storyAcc -= cost;
    advanceStoryChar();
  }
}

/** 剧情结束：淡出剧情层并进入大地图 */
function enterMapFromStory(): void {
  storyActive = false;
  showScreen('story-screen', false);
  enterWorldMap();
}

/** 每帧同步输入来源（切换键帽键位文案）与键帽按压态 */
function syncInputUi(): void {
  const source = getInputSource();
  if (document.body.dataset.input !== source) document.body.dataset.input = source;
  document.querySelectorAll<HTMLElement>('.hint-bar .keycap').forEach((cap) => {
    const channel = cap.dataset.channel as ChannelName | undefined;
    if (!channel) return;
    cap.classList.toggle('is-pressed', isChannelDown(channel));
  });
}

/** 刷新首页按钮高亮 */
function refreshStartSelection(): void {
  document.getElementById('btn-continue')?.classList.toggle('selected', startSelection === 0);
  document.getElementById('btn-reset')?.classList.toggle('selected', startSelection === 1);
}

/** 触发手柄双马达短震，失败时静默兜底 */
function triggerVibration(): void {
  try {
    const pad = navigator.getGamepads()[0];
    pad?.vibrationActuator
      ?.playEffect('dual-rumble', { duration: 300, strongMagnitude: 1, weakMagnitude: 0.5 })
      .catch(() => {});
  } catch {
    // 键盘用户或浏览器不支持震动，静默跳过
  }
}

/** 刷新关卡节点状态：selected 高亮 / locked 灰化挂锁 / completed 对勾 */
function refreshLevelStates(): void {
  const finalUnlocked = isFinalUnlocked();
  document.querySelectorAll('.level-node').forEach((node, i) => {
    node.classList.toggle('selected', i === selectedLevel);
    node.classList.toggle('completed', completed[i]);
    node.classList.toggle('locked', i === FINAL_LEVEL_INDEX && !finalUnlocked);
  });
}

/** 从首页进入大地图 */
function enterWorldMap(): void {
  showScreen('start-screen', false);
  showScreen('world-map-screen', true);
  setState(GameState.WORLD_MAP);
  triggerVibration();
  console.log('进入大地图');
}

/** 重置全部关卡进度：清空存档并回到初始状态 */
function resetProgress(): void {
  completed = LEVELS.map(() => false);
  saveCompleted();
  finalUnlockAnnounced = false;
  selectedLevel = 0;
  refreshLevelStates();
  flashStartHint('已重置全部关卡进度');
  console.log('关卡进度已重置');
}

/** START：剧情播放中先输出文字流；结束后左右切换按钮，A 键确认（继续游戏 / 重置关卡） */
function handleStart(dt: number): void {
  if (storyActive) {
    const confirm = isAButtonJustPressed();
    if (storyDone) {
      if (storyPage === 0) {
        // 第一屏读完：按 A 换一屏，宝物介绍从头开始播放
        if (confirm) startStoryPage(1);
      } else if (confirm) {
        enterMapFromStory();
      }
      return;
    }
    if (confirm) finishStoryInstant();
    else updateStory(dt);
    return;
  }
  if (isLeftJustPressed() || isRightJustPressed()) {
    startSelection = (startSelection + 1) % 2;
    refreshStartSelection();
    return;
  }
  if (!isAButtonJustPressed()) return;
  if (startSelection === 1) {
    resetProgress();
    return;
  }
  startStory();
}

/** WORLD_MAP：左右选择关卡（高亮跟随），A 键进入关卡，B 键返回首页 */
function handleWorldMap(): void {
  if (isBButtonJustPressed()) {
    showScreen('world-map-screen', false);
    showScreen('start-screen', true);
    setState(GameState.START);
    startSelection = 0;
    refreshStartSelection();
    console.log('返回首页');
    return;
  }
  let moved = -1;
  if (isLeftJustPressed()) {
    moved = neighborOf(selectedLevel, -1, 0);
  } else if (isRightJustPressed()) {
    moved = neighborOf(selectedLevel, 1, 0);
  } else if (isUpJustPressed()) {
    moved = neighborOf(selectedLevel, 0, -1);
  } else if (isDownJustPressed()) {
    moved = neighborOf(selectedLevel, 0, 1);
  } else if (isAButtonJustPressed()) {
    enterLevel();
    return;
  }
  if (moved >= 0 && moved !== selectedLevel) {
    selectedLevel = moved;
    refreshLevelStates();
  }
}

/** 进入关卡：终极关卡未解锁时抖动拒绝，否则切换 LEVEL 状态并初始化 Canvas 场景 */
function enterLevel(): void {
  const def = LEVELS[selectedLevel];
  if (selectedLevel === FINAL_LEVEL_INDEX && !isFinalUnlocked()) {
    flashMapHint('🔒 先完成其余关卡，才能挑战终极关卡！');
    const node = document.querySelectorAll('.level-node')[selectedLevel];
    if (node instanceof HTMLElement) {
      node.classList.remove('denied');
      void node.offsetWidth; // 强制回流以重启动画
      node.classList.add('denied');
      window.setTimeout(() => node.classList.remove('denied'), 400);
    }
    console.log('终极关卡尚未解锁');
    return;
  }
  showScreen('world-map-screen', false);
  showScreen('level-screen', true);
  enterLevelScene({ id: def.id, name: def.name });
  setState(GameState.LEVEL);
  triggerVibration();
  console.log(`进入关卡：${def.name}`);
}

/** LEVEL：集齐宝物后按 A 完成关卡返回，未完成时 B / Esc 中途退出（不计完成） */
function handleLevel(dt: number): void {
  updateLevel(dt);
  drawLevel();
  if (isCinematic()) return; // 终章合成动画期间屏蔽按键，避免跳过结算
  if (isLevelWon()) {
    if (winElapsed() > 1.5 && isAButtonJustPressed()) {
      exitLevelToMap();
      markCompleted();
    }
    return; // 胜利结算期间 B 不响应，避免误触丢失结算画面
  }
  if (isBButtonJustPressed()) {
    exitLevelToMap();
    console.log('中途退出关卡（未完成）');
  }
}

/** 退出关卡回到大地图（不改变完成状态） */
function exitLevelToMap(): void {
  showScreen('level-screen', false);
  showScreen('world-map-screen', true);
  setState(GameState.WORLD_MAP);
  refreshLevelStates();
  triggerVibration();
  console.log('返回大地图');
}

/** 标记当前关卡完成：存档并检查终极关卡解锁 */
function markCompleted(): void {
  if (completed[selectedLevel]) return;
  completed[selectedLevel] = true;
  saveCompleted();
  const def = LEVELS[selectedLevel];
  console.log(`关卡「${def.name}」完成！`);
  refreshLevelStates();
  if (selectedLevel !== FINAL_LEVEL_INDEX && isFinalUnlocked() && !finalUnlockAnnounced) {
    finalUnlockAnnounced = true;
    flashMapHint('✨ 终极关卡已解锁：东莞博物馆新馆！', 3200);
    console.log('终极关卡已解锁：东莞博物馆新馆');
  }
}

/** 上一帧时间戳（计算 dt 用） */
let lastTime = performance.now();

/** 主循环：唯一的 requestAnimationFrame，按当前状态分发输入处理 */
function loop(): void {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05); // 秒，切页跳帧封顶
  lastTime = now;
  refreshGamepad();
  syncInputUi();
  switch (currentState) {
    case GameState.START:
      handleStart(dt);
      break;
    case GameState.WORLD_MAP:
      handleWorldMap();
      break;
    case GameState.LEVEL:
      handleLevel(dt);
      break;
    case GameState.CLEAR:
      break;
  }
  requestAnimationFrame(loop);
}

initInput();
renderHint(document.querySelector<HTMLElement>('#start-screen .start-hint'), START_HINTS);
renderHint(document.getElementById('map-hint'), MAP_HINTS);
refreshStartSelection();
refreshLevelStates();
requestAnimationFrame(loop);
