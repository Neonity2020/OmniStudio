/**
 * 把打砖块的当前局面画成一张**像素风的小图** —— 视觉版场景唯一的输入。
 *
 * 两条硬要求:
 *
 * 1. **小**。视觉编码器按像素块切 token,分辨率翻倍 token 数翻四倍。场地 300×220
 *    个游戏单位按 0.5 缩到 150×110 像素(远在 200×200 以内),这张图要分辨的只是
 *    "球在板子左边还是右边",再大纯属浪费。
 * 2. **像素对齐**。所有坐标先 round 成整数像素再画,球画成 3×3 的方块而不是圆 ——
 *    半径 3.2 个单位缩完只有 1.6 像素,画圆会被抗锯齿糊成一团灰,方块在这个尺寸下
 *    反而最清楚。这也正好是街机像素风该有的样子。
 *
 * 与 `breakout-view.tsx` 的分工:那张 SVG 是给人看的(带落点虚线、球迹、HUD);
 * 这里画的是"干净的游戏画面",连落点虚线都不能有 —— 标在图上就等于把答案写给它了。
 * 视觉版场景里,界面直接把**这张图**放大显示,所以人看到的和模型看到的是同一份像素。
 */
import {
  BREAKOUT_H,
  BREAKOUT_PADDLE_W,
  BREAKOUT_PADDLE_Y,
  BREAKOUT_TOP,
  BREAKOUT_W,
  type BreakoutState,
} from "./scenarios";

/** 游戏单位 → 像素。0.5 让砖块正好落在整数像素上(34×10 → 17×5)。 */
export const FRAME_SCALE = 0.5;
export const FRAME_W = Math.round(BREAKOUT_W * FRAME_SCALE);
export const FRAME_H = Math.round(BREAKOUT_H * FRAME_SCALE);

const BRICK_W = 34;
const BRICK_H = 10;
/** 与 `breakout-view.tsx` 同一套配色:人看到的和模型看到的必须是同一个画面。 */
const ROW_COLORS = ["#E24B4A", "#EF9F27", "#FAC775", "#97C459", "#85B7EB"];
/** 球的边长(像素)。3 是"还看得出是个球"的下限,2 在砖块之间容易被当成噪点。 */
const BALL_PX = 3;
const PADDLE_PX_H = 3;

export type Painter = {
  fillRect: (x: number, y: number, w: number, h: number) => void;
  // 浏览器的 `fillStyle` 还接受渐变与图案,这里只写颜色字符串,所以放宽成写入即可。
  fillStyle: unknown;
};

const px = (value: number) => Math.round(value * FRAME_SCALE);

/**
 * 画到一个 2D 上下文上 —— 只要 `fillRect`,不碰 DOM、不用路径。
 *
 * 抽出来是为了**测试脚本能画出与应用里一模一样的一张图**(脚本走 node 端的 canvas),
 * 不然"这张图看不看得清"就只能靠肉眼在应用里猜。
 */
export function paintBreakout(ctx: Painter, state: BreakoutState): void {
  ctx.fillStyle = "#17171a";
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.fillStyle = "#3a3a40";
  ctx.fillRect(0, px(BREAKOUT_TOP), FRAME_W, 1);

  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    ctx.fillStyle = ROW_COLORS[brick.row] ?? "#B4B2A9";
    // 宽高各减 1 像素当缝:不留缝的话整排砖糊成一条色带,看不出还剩几块。
    ctx.fillRect(px(brick.x), px(brick.y), px(BRICK_W) - 1, px(BRICK_H) - 1);
  }

  ctx.fillStyle = "#9FE1CB";
  ctx.fillRect(px(state.paddleX), px(BREAKOUT_PADDLE_Y), px(BREAKOUT_PADDLE_W), PADDLE_PX_H);

  // 球最后画,保证任何情况下都盖在别的东西上面 —— 它是这张图里最该看清的东西。
  ctx.fillStyle = "#F1EFE8";
  ctx.fillRect(
    Math.max(0, Math.min(FRAME_W - BALL_PX, px(state.ball.x) - (BALL_PX >> 1))),
    Math.max(0, Math.min(FRAME_H - BALL_PX, px(state.ball.y) - (BALL_PX >> 1))),
    BALL_PX,
    BALL_PX,
  );
}

/**
 * 局面 → `data:image/png;base64,…`。
 *
 * 取不到 2D 上下文时返回 null(极少见,但不能让整局判定挂在一个画布上)——
 * 调用方据此报错,而不是发一个没有图的"视觉"请求出去。
 */
export function renderBreakoutFrame(state: BreakoutState): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintBreakout(ctx, state);
  return canvas.toDataURL("image/png");
}
