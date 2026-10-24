/**
 * 全局游戏状态机
 *
 * GameState 定义游戏流程中的各个阶段：
 * - START: 游戏首页（标题界面）
 * - WORLD_MAP: 大地图（选择关卡）
 * - LEVEL: 关卡内（进行游戏）
 * - CLEAR: 通关（结算界面）
 */

/** 游戏全局状态枚举 */
export enum GameState {
  /** 游戏首页 */
  START = 'START',
  /** 大地图 */
  WORLD_MAP = 'WORLD_MAP',
  /** 关卡内 */
  LEVEL = 'LEVEL',
  /** 通关 */
  CLEAR = 'CLEAR',
}

/** 当前游戏状态，默认首页 */
export let currentState: GameState = GameState.START;

/** 切换全局游戏状态（ESM 导入绑定只读，外部须通过本函数修改） */
export function setState(next: GameState): void {
  currentState = next;
}
