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

/** START：左右切换按钮，A 键确认（继续游戏 / 重置关卡） */
function handleStart(): void {
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
  enterWorldMap();
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
      handleStart();
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
