/**
 * 场景 A 的可视化：一盘 N×N 棋盘（边长与障碍数量由左栏的盘面设置决定）。
 *
 * 整块是一张 SVG，viewBox 就是盘面本身（一格 = 一个用户单位），所以"按可用空间
 * 缩放"这件事交给 `width` 上那一行 `min(100cqw, 100cqh)` 就够了：变窄按宽缩、
 * 变矮按高缩，任何尺寸下都是完整的一整盘，不出滚动条。
 *
 * 画四样东西：走过的**路径**（一条折线，每走一步实时接长）、当前位置、终点、障碍。
 * 全部是图标而不是文字 —— 一格只有几毫米宽时，"障"字糊成一团，而一堵砖墙还认得出；
 * 文案仍留在 i18n 里，作为每个图元的无障碍名字（`<title>`）。
 *
 * 撞墙的那一步位置不变，折线上是同一个点重复 —— 画出来看不见，但步数会涨，
 * 这正是要让用户看到的代价。
 */
import { Bot, BrickWall, Flag, Home } from "lucide-react";

import { useT } from "@stores/ui-lang";
import { GRID_START, type GridRunnerState } from "./scenarios";

/** 一格里图标的边长与左上角偏移（格子是 1×1）。 */
const ICON = 0.56;
const ICON_PAD = (1 - ICON) / 2;

/** 轨迹 → 折线上的点（去掉连续重复：撞墙那几步原地不动，画不出线段）。 */
function pathPoints(trail: readonly [number, number][]): [number, number][] {
  const points: [number, number][] = [[GRID_START[0], GRID_START[1]]];
  for (const [row, col] of trail) {
    const last = points[points.length - 1] as [number, number];
    if (last[0] === row && last[1] === col) continue;
    points.push([row, col]);
  }
  return points;
}

export function GridView({ state, trail }: { state: GridRunnerState; trail: [number, number][] }) {
  const t = useT();
  const size = state.size;
  const side = "min(100cqw, 100cqh)";
  const cells = Array.from({ length: size * size }, (_, i) => [Math.floor(i / size), i % size] as const);
  const walls = new Set(state.walls.map(([r, c]) => `${r},${c}`));
  const visited = new Set(trail.map(([r, c]) => `${r},${c}`));
  const points = pathPoints(trail);
  // 线条宽度跟着盘面走：10×10 用 5×5 的线宽会把格子糊住。
  const stroke = 0.5 / size;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: "size" }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          style={{ width: side, height: side }}
          className="block overflow-visible"
          role="img"
          aria-label={t("jev.playground.grid.aria")}
        >
          {/* 底格。走过的格子留一层淡色，光看底色也能认出走过哪儿。 */}
          {cells.map(([row, col]) => {
            const key = `${row},${col}`;
            const isWall = walls.has(key);
            const isGoal = row === state.goal[0] && col === state.goal[1];
            return (
              <rect
                key={key}
                x={col + 0.04}
                y={row + 0.04}
                width={0.92}
                height={0.92}
                rx={0.12}
                className={
                  isWall
                    ? "fill-muted stroke-border"
                    : isGoal
                      ? "fill-emerald-500/15 stroke-border"
                      : visited.has(key)
                        ? "fill-primary/10 stroke-primary/40"
                        : "fill-transparent stroke-border"
                }
                strokeWidth={stroke / 2}
              />
            );
          })}

          {/* 路径：每走一步实时接长一段。只有一个点（还没动过）时不画。 */}
          {points.length > 1 ? (
            <polyline
              points={points.map(([row, col]) => `${col + 0.5},${row + 0.5}`).join(" ")}
              fill="none"
              className="stroke-primary/80"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {/* 路径上的落点：一步一个小圆，看得出走了几步、在哪拐的弯。 */}
          {points.slice(1, -1).map(([row, col]) => (
            <circle
              key={`dot-${row}-${col}`}
              cx={col + 0.5}
              cy={row + 0.5}
              r={stroke * 0.9}
              className="fill-primary/80"
            />
          ))}

          {/* 起点。角色站在起点上时被盖住，正好不用特意处理。 */}
          <Home
            x={GRID_START[1] + ICON_PAD}
            y={GRID_START[0] + ICON_PAD}
            width={ICON}
            height={ICON}
            className="text-muted-foreground"
            strokeWidth={2}
          >
            <title>{t("jev.playground.grid.markerStart")}</title>
          </Home>

          {state.walls.map(([row, col]) => (
            <BrickWall
              key={`wall-${row}-${col}`}
              x={col + ICON_PAD}
              y={row + ICON_PAD}
              width={ICON}
              height={ICON}
              className="text-muted-foreground"
              strokeWidth={2}
            >
              <title>{t("jev.playground.grid.markerWall")}</title>
            </BrickWall>
          ))}

          <Flag
            x={state.goal[1] + ICON_PAD}
            y={state.goal[0] + ICON_PAD}
            width={ICON}
            height={ICON}
            className="text-emerald-600"
            strokeWidth={2}
          >
            <title>{t("jev.playground.grid.markerGoal")}</title>
          </Flag>

          {/*
            角色。位置用 transform 而不是直接改坐标：加一段过渡之后，每一步是"滑"
            过去的 —— 一眼看得出它往哪个方向动了，而不是忽然出现在另一格。
          */}
          <g
            style={{
              transform: `translate(${state.pos[1]}px, ${state.pos[0]}px)`,
              transition: "transform 220ms ease",
            }}
          >
            <circle cx={0.5} cy={0.5} r={0.42} className="fill-primary stroke-primary" strokeWidth={stroke / 2} />
            <Bot
              x={ICON_PAD}
              y={ICON_PAD}
              width={ICON}
              height={ICON}
              className="text-primary-foreground"
              strokeWidth={2}
            >
              <title>{t("jev.playground.grid.markerHere")}</title>
            </Bot>
          </g>
        </svg>
      </div>

      {/* 图例用的就是盘面上那几个图元本身，不另画色块。 */}
      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Bot className="size-3" aria-hidden /> {t("jev.playground.grid.legendHere")}
        </span>
        <span className="flex items-center gap-1">
          <Flag className="size-3 text-emerald-600" aria-hidden /> {t("jev.playground.grid.legendGoal")}
        </span>
        <span className="flex items-center gap-1">
          <BrickWall className="size-3" aria-hidden /> {t("jev.playground.grid.legendWall")}
        </span>
        <span className="flex items-center gap-1">
          <svg className="size-3" viewBox="0 0 12 12" aria-hidden>
            <polyline points="1,9 5,9 5,3 11,3" fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("jev.playground.grid.legendTrail")}
        </span>
      </div>
    </div>
  );
}
