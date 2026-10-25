/**
 * 输入管理器：手柄（原生 Gamepad API）+ 键盘双通道，未连接手柄时自动降级为键盘。
 * 所有 isXxxJustPressed 均为边沿检测（防连发）：按住只触发一次，须先释放再按下。
 * 键盘按下带边沿锁存：keydown 与 keyup 在两次轮询之间完成时也保证触发一次。
 */

const DEADZONE = 0.2;
/** 左摇杆水平推杆的导航触发阈值（推过才视为选择了方向） */
const AXIS_NAV_THRESHOLD = 0.5;

export let axisX = 0;
export let axisY = 0;

/** 最近一次有效输入来源：用于界面键帽在手柄/键盘之间自动切换键位文案 */
export type InputSource = 'keyboard' | 'pad';

let lastInputSource: InputSource = 'keyboard';

/** 读取最近一次有效输入来源 */
export function getInputSource(): InputSource {
  return lastInputSource;
}

/** 单个输入通道的边沿状态 */
interface Channel {
  /** 当前是否按住（键盘或手柄任一） */
  down: boolean;
  /** 键盘按下边沿锁存：快速敲击（按下抬起跨帧）兜底触发一次 */
  pending: boolean;
  /** 上一轮边沿检测时的按住状态 */
  prev: boolean;
}

export type ChannelName = 'a' | 'b' | 'left' | 'right' | 'up' | 'down';

const channels: Record<ChannelName, Channel> = {
  a: { down: false, pending: false, prev: false },
  b: { down: false, pending: false, prev: false },
  left: { down: false, pending: false, prev: false },
  right: { down: false, pending: false, prev: false },
  up: { down: false, pending: false, prev: false },
  down: { down: false, pending: false, prev: false },
};

/** 键盘按键 → 通道映射（空格=A，Esc=B，←/A=左，→/D=右，↑/W=上，↓/S=下） */
const KEY_MAP: Record<string, ChannelName> = {
  Space: 'a',
  Escape: 'b',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
};

/** 手柄各通道的按住状态（每次轮询刷新） */
interface PadState {
  a: boolean;
  b: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

const padState: PadState = { a: false, b: false, left: false, right: false, up: false, down: false };

/** 轮询手柄：刷新摇杆（死区过滤）与各通道按住状态 */
function pollGamepad(): PadState {
  // 先清零摇杆：手柄中途断开时不会残留上次的推杆值（否则主角会持续漂移）
  axisX = 0;
  axisY = 0;
  padState.a = false;
  padState.b = false;
  padState.left = false;
  padState.right = false;
  padState.up = false;
  padState.down = false;
  const pads = navigator.getGamepads();
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const btn = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
    if (btn(0)) padState.a = true; // A 键
    if (btn(1)) padState.b = true; // B 键
    // 十字键（标准映射 12-15）或左摇杆推过导航阈值
    if (btn(14) || (pad.axes[0] ?? 0) < -AXIS_NAV_THRESHOLD) padState.left = true;
    if (btn(15) || (pad.axes[0] ?? 0) > AXIS_NAV_THRESHOLD) padState.right = true;
    if (btn(12) || (pad.axes[1] ?? 0) < -AXIS_NAV_THRESHOLD) padState.up = true;
    if (btn(13) || (pad.axes[1] ?? 0) > AXIS_NAV_THRESHOLD) padState.down = true;
    // 摇杆输出（死区过滤），取第一个已连接手柄
    const rawX = pad.axes[0] ?? 0;
    const rawY = pad.axes[1] ?? 0;
    axisX = Math.abs(rawX) < DEADZONE ? 0 : rawX;
    axisY = Math.abs(rawY) < DEADZONE ? 0 : rawY;
    // 任一按键按下或摇杆推过导航阈值：记录为手柄输入
    if (
      padState.a ||
      padState.b ||
      padState.left ||
      padState.right ||
      padState.up ||
      padState.down
    ) {
      lastInputSource = 'pad';
    }
    break;
  }
  return padState;
}

/** 通道边沿检测：按住只触发一次；键盘快速敲击由锁存位兜底 */
function edge(name: ChannelName): boolean {
  const pad = pollGamepad();
  const ch = channels[name];
  const current = ch.down || pad[name];
  let just = current && !ch.prev;
  ch.prev = current;
  if (ch.pending) {
    just = true;
    ch.pending = false;
  }
  return just;
}

export function initInput(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const name = KEY_MAP[e.code];
    if (!name) return;
    e.preventDefault();
    lastInputSource = 'keyboard';
    if (!e.repeat) {
      channels[name].down = true;
      channels[name].pending = true;
    }
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    const name = KEY_MAP[e.code];
    if (name) channels[name].down = false;
  });
  window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
    console.log(`手柄已连接: ${e.gamepad.id}`);
  });
  window.addEventListener('gamepaddisconnected', () => {
    console.log('手柄已断开，自动降级为键盘控制');
  });
  console.log('输入管理器已初始化（键盘控制可用，连接手柄后自动启用手柄）');
}

/** 主循环每帧调用：刷新摇杆与手柄状态，保证 axisX/axisY 按帧新鲜 */
export function refreshGamepad(): void {
  pollGamepad();
}

/** 键盘按住状态 → 归一化方向（-1/0/1）：未连接手柄时关卡内移动的兜底通道 */
export function getKeyboardAxes(): { x: number; y: number } {
  const x = (channels.right.down ? 1 : 0) - (channels.left.down ? 1 : 0);
  const y = (channels.down.down ? 1 : 0) - (channels.up.down ? 1 : 0);
  return { x, y };
}

/** A 键 / 空格：确认 */
export function isAButtonJustPressed(): boolean {
  return edge('a');
}

/** B 键 / Esc：返回 */
export function isBButtonJustPressed(): boolean {
  return edge('b');
}

/** 左方向：十字键 / 左摇杆 / ← 或 A 键 */
export function isLeftJustPressed(): boolean {
  return edge('left');
}

/** 右方向：十字键 / 左摇杆 / → 或 D 键 */
export function isRightJustPressed(): boolean {
  return edge('right');
}

/** 上方向：十字键 / 左摇杆 / ↑ 或 W 键 */
export function isUpJustPressed(): boolean {
  return edge('up');
}

/** 下方向：十字键 / 左摇杆 / ↓ 或 S 键 */
export function isDownJustPressed(): boolean {
  return edge('down');
}

/** 通道当前是否按住（键盘或手柄任一），用于界面键帽的按压反馈 */
export function isChannelDown(name: ChannelName): boolean {
  return channels[name].down || padState[name];
}
