const DEADZONE = 0.2;

export let axisX = 0;
export let axisY = 0;

let spaceHeld = false;
let prevAPressed = false;
let spaceEdgePending = false;

export function initInput(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) {
        spaceHeld = true;
        spaceEdgePending = true;
      }
    }
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.code === 'Space') spaceHeld = false;
  });
  window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
    console.log(`手柄已连接: ${e.gamepad.id}`);
  });
  window.addEventListener('gamepaddisconnected', () => {
    console.log('手柄已断开，自动降级为键盘控制');
  });
  console.log('输入管理器已初始化（键盘控制可用，连接手柄后自动启用手柄）');
}

function pollGamepad(): boolean {
  let padPressed = false;
  const pads = navigator.getGamepads();
  for (const pad of pads) {
    if (pad && pad.connected && pad.buttons[0]?.pressed) {
      padPressed = true;
    }
  }
  // 用第一个已连接手柄刷新摇杆（含死区过滤）
  for (const pad of pads) {
    if (pad && pad.connected) {
      const rawX = pad.axes[0] ?? 0;
      const rawY = pad.axes[1] ?? 0;
      axisX = Math.abs(rawX) < DEADZONE ? 0 : rawX;
      axisY = Math.abs(rawY) < DEADZONE ? 0 : rawY;
      break;
    }
  }
  return padPressed;
}

export function isAButtonJustPressed(): boolean {
  const current = spaceHeld || pollGamepad();
  let justPressed = current && !prevAPressed;
  prevAPressed = current;
  // 键盘按下边沿锁存：keydown 与 keyup 跨帧完成时也能保证触发一次
  if (spaceEdgePending) {
    justPressed = true;
    spaceEdgePending = false;
  }
  return justPressed;
}
