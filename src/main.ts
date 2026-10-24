/**
 * 《寻宝东莞》主入口
 *
 * 负责初始化输入系统与主循环，完成 START 首页 → 大地图的状态切换。
 */

import { GameState, currentState, setState } from './state';
import { initInput, isAButtonJustPressed } from './InputManager';

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

/** START → WORLD_MAP：首页渐隐 + 状态切换 + 震动 + 日志（状态改变后不会重复触发） */
function enterWorldMap(): void {
  document.getElementById('start-screen')?.classList.add('hidden');
  setState(GameState.WORLD_MAP);
  triggerVibration();
  console.log('进入大地图');
}

/** 主循环：仅在 START 状态下响应 A 键（空格/手柄 A），每帧检测一次 */
function loop(): void {
  if (currentState === GameState.START && isAButtonJustPressed()) {
    enterWorldMap();
  }
  requestAnimationFrame(loop);
}

initInput();
requestAnimationFrame(loop);
