/**
 * 场景 A 的可视化：一盘 N×N 棋盘（边长与障碍数量由左栏的盘面设置决定）。
 *
 * 标出四样东西：当前位置（高亮）、终点、障碍、走过的轨迹。每步结束后由父组件
 * 把最新的 `GridRunnerState` 与轨迹（含"原地踏步"的撞墙步）传进来重画一次 ——
 * 用户能看到模型在每一步之后**实际**走到哪，撞墙那几步轨迹里是原地重复点。
 *
 * 颜色用 inline style + Tailwind token：棋盘是场景专属的图元，不新增 CSS 类。
 */
import { useT } from "@stores/ui-lang";
import { cn } from "@/mainview/lib/utils";
import type { GridRunnerState } from "./scenarios";

export function GridView({ state, trail }: { state: GridRunnerState; trail: [number, number][] }) {
  const t = useT();
  const cells = Array.from({ length: state.size * state.size }, (_, i) => [Math.floor(i / state.size), i % state.size] as const);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {/*
        棋盘按**可用空间**缩放，而不是按内容撑开：外层声明成 size 容器，棋盘的边长取
        `min(100cqw, 100cqh)` —— 窗口变窄按宽缩、变矮按高缩，任何尺寸下都是完整的一整盘，
        不出滚动条。格子的间距与字号也跟着盘面走，10×10 时不会挤成一团。
      */}
      <div
        className="flex min-h-0 w-full flex-1 items-center justify-center"
        style={{ containerType: "size" }}
      >
        <div
          className="grid aspect-square"
          style={{
            width: "min(100cqw, 100cqh)",
            gridTemplateColumns: `repeat(${state.size}, minmax(0, 1fr))`,
            gap: `min(${state.size > 7 ? 0.8 : 1.6}cqmin, 4px)`,
            fontSize: `min(${state.size > 7 ? 3 : 4}cqmin, 12px)`,
          }}
          role="img"
          aria-label={t("jev.playground.grid.aria")}
        >
        {cells.map(([row, col]) => {
          const isStart = row === 0 && col === 0;
          const isGoal = row === state.goal[0] && col === state.goal[1];
          const isWall = state.walls.some(([r, c]) => r === row && c === col);
          const isHere = row === state.pos[0] && col === state.pos[1];
          const onTrail = trail.some(([r, c]) => r === row && c === col);
          return (
            <div
              key={`${row}-${col}`}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border font-semibold",
                isHere
                  ? "border-accent bg-accent/70 text-accent-foreground"
                  : isGoal
                    ? "border-border bg-emerald-500/15 text-emerald-600"
                    : isWall
                      ? "border-border bg-muted"
                      : onTrail
                        ? "border-accent/40 bg-accent/10"
                        : "border-border bg-transparent",
              )}
            >
              {isHere
                ? t("jev.playground.grid.markerHere")
                : isGoal
                  ? t("jev.playground.grid.markerGoal")
                  : isWall
                    ? t("jev.playground.grid.markerWall")
                    : isStart
                      ? t("jev.playground.grid.markerStart")
                      : null}
            </div>
          );
        })}
        </div>
      </div>
      <div className="flex flex-none flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-accent/70" aria-hidden /> {t("jev.playground.grid.legendHere")}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-emerald-500/40" aria-hidden /> {t("jev.playground.grid.legendGoal")}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-muted" aria-hidden /> {t("jev.playground.grid.legendWall")}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm border border-accent/50 bg-accent/10" aria-hidden /> {t("jev.playground.grid.legendTrail")}
        </span>
      </div>
    </div>
  );
}
