/**
 * 演练场主体：左侧是场景说明 + 运行控制（开始 / 单步 / 重置）+ 后端状态，
 * 右侧是场景可视化与逐步运行日志。布局沿用 JEV 页：左栏 380px、右栏产物。
 *
 * 运行逻辑（「单步」与「开始」共用同一个 `advance`，后者就是循环调它）：
 *   - 每步只发一次 `rpcClient.systemoneRun`（state 必须 `JSON.stringify` ——
 *     这条 RPC 的参数类型是 string，`scenarios.ts` 返回的是对象）；
 *   - grid：一个 choice，跑完一步推进局面，直到 `over`（到达终点或 20 步上限）；
 *   - triage：一条工单两个问题（choice + noul），顺序跑完 8 条；
 *   - 任何一步失败就停下并把错误显示出来（后端没配好是最常见的情况）；
 *   - 「开始」连续跑完，「单步」跑一步停住；「重置」或组件卸载时置 cancel 标志，
 *     循环在每步之间的 await 处检查（await 天然让出控制权，不需要别的机制）。
 *     中止后不清空现场 —— 重置按钮负责归零，卸载本来就没人看了。
 *
 * 发给模型的 state / criteria 全部来自 `scenarios.ts`（英文）；这里的界面
 * 文案走 i18n，不拼进请求体。
 */
import { MinusIcon, PlayIcon, PlusCircleIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { rpcClient } from "@lib/rpc";
import { useJevStore } from "@stores/jev";
import { useJevMetrics } from "@stores/jev-metrics";
import { useT } from "@stores/ui-lang";
import { Button } from "@ui/button";
import { Input } from "@ui/input";
import { Textarea } from "@ui/textarea";
import {
  applyMove,
  GRID_SIZE_MAX,
  GRID_SIZE_MIN,
  maxWallsFor,
  newGridRunner,
  type GridDirection,
  gridChoiceQuestion,
  gridRunnerState,
  PLAYGROUND_SCENARIOS,
  TICKETS,
  ticketQuestions,
  ticketState,
  type GridRunnerState,
  triageStats,
} from "./scenarios";
import { GridView, type GridMoveMark } from "./grid-view";

/** 每步之间的停顿：和棋子那段 220ms 过渡对齐，刚好看清它从哪格挪到哪格。 */
export const STEP_PAUSE_MS = 260;
import { RunLog, type RunLogEntry } from "./run-log";
import { TriageView, type TriageRow } from "./triage-view";
import { MarketView, type MarketMark } from "./market-view";
import {
  applyMarketDecision,
  marketReplayQuestions,
  marketReplayState,
  marketSteps,
  newMarketReplay,
  type MarketAction,
  type MarketReplayState,
} from "./scenarios";
import {
  clampMarketWindow,
  MARKET_MAX_BARS,
  MARKET_META,
  MARKET_SYMBOLS,
  marketSpan,
} from "./market-data";
import type { SystemOneChoiceAnswer, SystemOneNoulAnswer, SystemOneScoreAnswer } from "../../../../shared/systemone";

/** 一次判定调用：计时，并把响应里的问题答案按名字摘出来。 */
async function runOnce(
  state: Record<string, unknown>,
  questions: Record<string, unknown>,
  names: string[],
): Promise<
  | { ok: true; choice?: SystemOneChoiceAnswer; noul?: SystemOneNoulAnswer; score?: SystemOneScoreAnswer; ms: number }
  | { ok: false; status: number; message: string }
> {
  const started = performance.now();
  const result = await rpcClient.systemoneRun({
    // RPC 契约：state 是 string（协议本身允许对象，这条接口不接）。
    state: JSON.stringify(state),
    questions,
  });
  const ms = Math.round(performance.now() - started);
  // 侧栏的驾驶舱要的就是这个数（端到端，含网络）。
  useJevMetrics.getState().record({ at: Date.now(), ms, ok: result.ok, backend: result.ok ? result.backend : null, source: "playground" });
  if (!result.ok) return { ok: false, status: result.status, message: result.message };
  let choice: SystemOneChoiceAnswer | undefined;
  let noul: SystemOneNoulAnswer | undefined;
  let score: SystemOneScoreAnswer | undefined;
  for (const name of names) {
    const answer = result.response.answers[name];
    if (!answer) continue;
    if (answer.type === "choice") choice = answer;
    if (answer.type === "noul") noul = answer;
    if (answer.type === "score") score = answer;
  }
  return { ok: true, choice, noul, score, ms };
}

export function JevPlayground() {
  const t = useT();
  const scenarioId = useJevStore((s) => s.scenarioId);
  const scenario = PLAYGROUND_SCENARIOS.find((s) => s.id === scenarioId) ?? null;
  // 盘面设置（只有网格场景用得上）：改一下就整局重开，见下面那个 effect。
  const gridSize = useJevStore((s) => s.gridSize);
  const gridWalls = useJevStore((s) => s.gridWalls);
  const setGridSize = useJevStore((s) => s.setGridSize);
  const setGridWalls = useJevStore((s) => s.setGridWalls);
  // 行情回放的设置（同理：改任何一项都整局重开）。
  const marketSymbol = useJevStore((s) => s.marketSymbol);
  const marketFrom = useJevStore((s) => s.marketFrom);
  const marketTo = useJevStore((s) => s.marketTo);
  const marketStrategy = useJevStore((s) => s.marketStrategy);
  const setMarketSymbol = useJevStore((s) => s.setMarketSymbol);
  const setMarketRange = useJevStore((s) => s.setMarketRange);
  const setMarketStrategy = useJevStore((s) => s.setMarketStrategy);

  // 后端状态（与判定台同一查询：跑之前先看一眼"能不能跑"）。
  const status = useQuery({
    queryKey: ["systemone", "status"],
    queryFn: () => rpcClient.systemoneStatus(undefined),
  });

  // ---------- 运行现场（两个场景各一份；重置 / 换场景时整体重建） ----------
  const [gridState, setGridState] = useState<GridRunnerState>(() => newGridRunner({ size: gridSize, walls: gridWalls }));
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [triageRows, setTriageRows] = useState<TriageRow[]>(() => TICKETS.map((ticket) => ({ ticket })));
  const [marketState, setMarketState] = useState<MarketReplayState>(() =>
    newMarketReplay({ symbol: marketSymbol, from: marketFrom, to: marketTo, strategy: marketStrategy }),
  );
  /** 图上每根的判定标记（按下标）。 */
  const [marks, setMarks] = useState<MarketMark[]>([]);
  const [log, setLog] = useState<RunLogEntry[]>([]);
  /**
   * 最近一步的落点，棋盘拿它做动画：走通了是滑过去，撞墙 / 撞边界是"顶一下"再弹回。
   * `seq` 每步 +1 —— 连着撞同一堵墙时位置和目标格都不变，没有它动画只播一次，
   * 看起来就跟死机一样（而这恰恰是模型最常见的表现）。
   */
  const [lastMove, setLastMove] = useState<GridMoveMark | null>(null);
  /**
   * 这一局里"白走"的步数与置信度之和。
   *
   * 为什么要专门统计：判定模型选错了方向，界面上只看得到棋子在撞墙，看起来像
   * 演练场坏了。实测过同一套请求在三个判定模型上的差别——有的 8 步走到终点，
   * 有的 20 步全撞在同一堵墙上，概率还几乎均分（四个方向各 25% 上下）。
   * 那不是场景的问题，是这个模型对这类题没有信号，得换一个模型，所以这里把
   * "撞了几步、置信度多低"数出来，到了阈值就直说。
   */
  const [tally, setTally] = useState({ steps: 0, wasted: 0, confidence: 0 });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [done, setDone] = useState(false);

  // 卸载或重置时中止正在跑的循环（只置标志，循环每步之间检查一次）。
  const cancelRef = useRef(false);

  /**
   * 运行中的**权威局面**放 ref，React state 只是它的镜像。
   *
   * 「开始」是在一个闭包里连着调 `advance` 的：从 state 读局面的话，整轮循环读到的
   * 都是点下按钮那一刻的那一份 —— 每一步都基于同一个旧局面，棋子原地不动、工单
   * 永远在判第一条，看起来就像"模型每次都选一样的方向"。ref 在这一步就更新，
   * 下一步才拿得到刚走完的局面。
   */
  const gridRef = useRef(gridState);
  const rowsRef = useRef(triageRows);
  const marketRef = useRef(marketState);
  const putGrid = (next: GridRunnerState) => {
    gridRef.current = next;
    setGridState(next);
  };
  const putMarket = (next: MarketReplayState) => {
    marketRef.current = next;
    setMarketState(next);
  };
  const putRows = (next: TriageRow[]) => {
    rowsRef.current = next;
    setTriageRows(next);
  };

  // 换场景、改盘面 = 重置运行现场（回到未开始状态）。盘面变了还接着上一局跑，
  // 轨迹与障碍就对不上了 —— 那是比"设置没生效"更难看懂的状态。
  useEffect(() => {
    cancelRef.current = false;
    putGrid(newGridRunner({ size: gridSize, walls: gridWalls }));
    setTrail([]);
    putRows(TICKETS.map((ticket) => ({ ticket })));
    putMarket(newMarketReplay({ symbol: marketSymbol, from: marketFrom, to: marketTo, strategy: marketStrategy }));
    setMarks([]);
    setLastMove(null);
    setTally({ steps: 0, wasted: 0, confidence: 0 });
    setLog([]);
    setRunning(false);
    setError(null);
    setDone(false);
  }, [scenarioId, gridSize, gridWalls, marketSymbol, marketFrom, marketTo, marketStrategy]);

  // 卸载时中止正在跑的循环。
  useEffect(
    () => () => {
      cancelRef.current = true;
    },
    [],
  );

  /**
   * 推进一步：一次 `systemoneRun`，然后更新全部可见状态。
   * 返回 "continue" / "finished" / "error" / "cancelled"（cancelled 只在「开始」
   * 的循环里出现：await 之后发现已经该停）。
   */
  const advance = async () => {
    if (!scenario) return "finished";
    if (scenario.id === "grid-runner") {
      // 局面从 ref 读：循环里的上一步刚写进去（见 gridRef 的注释）。
      const grid = gridRef.current;
      if (grid.over) return "finished";
      const outcome = await runOnce(gridRunnerState(grid), { next_move: gridChoiceQuestion(grid) }, ["next_move"]);
      if (!outcome.ok) {
        setError({ status: outcome.status, message: outcome.message });
        return "error";
      }
      if (cancelRef.current) return "cancelled";
      const choice = outcome.choice;
      const direction = (choice?.choice ?? "down") as GridDirection;
      const move = applyMove(grid, direction);
      putGrid(move.next);
      setTrail((prev) => [...prev, move.next.pos]);
      setLastMove((prev) => ({
        seq: (prev?.seq ?? 0) + 1,
        target: move.target,
        moved: move.moved,
        inBounds: move.inBounds,
      }));
      setTally((prev) => ({
        steps: prev.steps + 1,
        wasted: prev.wasted + (move.moved ? 0 : 1),
        confidence: prev.confidence + (choice?.confidence ?? 0),
      }));
      setLog((prev) => [
        ...prev,
        {
          step: prev.length + 1,
          question: "next_move",
          choice: choice?.choice ?? "—",
          confidence: choice?.confidence,
          probabilities: choice?.probabilities ?? {},
          ms: outcome.ms,
        },
      ]);
      return move.next.over ? "finished" : "continue";
    }

    if (scenario.id === "market-replay") {
      // 局面同样从 ref 读（见 gridRef 的注释）。
      const market = marketRef.current;
      if (market.over) return "finished";
      const outcome = await runOnce(marketReplayState(market), marketReplayQuestions(market), ["action", "risk"]);
      if (!outcome.ok) {
        setError({ status: outcome.status, message: outcome.message });
        return "error";
      }
      if (cancelRef.current) return "cancelled";
      const choice = outcome.choice;
      // 答不上来就按 hold 处理：它是三个动作里唯一"什么都不改"的那个，拿它兜底
      // 不会凭空给净值加上一笔没人做过的交易。
      const action = (choice?.choice ?? "hold") as MarketAction;
      const decision = applyMarketDecision(market, action);
      putMarket(decision.next);
      setMarks((prev) => [
        ...prev,
        { index: market.index, action, confidence: choice?.confidence ?? 0, risk: outcome.score?.score ?? null },
      ]);
      setLog((prev) => {
        const step = prev.length + 1;
        const entries: RunLogEntry[] = [
          ...prev,
          {
            step,
            question: "action",
            choice: choice?.choice ?? "—",
            confidence: choice?.confidence,
            probabilities: choice?.probabilities ?? {},
            ms: outcome.ms,
          },
        ];
        if (outcome.score) {
          entries.push({
            step,
            question: "risk",
            choice: String(outcome.score.score),
            confidence: outcome.score.confidence,
            probabilities: outcome.score.probabilities,
            ms: outcome.ms,
          });
        }
        return entries;
      });
      return decision.next.over ? "finished" : "continue";
    }

    // ticket-triage：一条工单两个问题（一次调用带回来）。
    const rows = rowsRef.current;
    const nextIndex = rows.findIndex((row) => row.choice === undefined);
    if (nextIndex === -1) return "finished";
    const ticket = rows[nextIndex]!.ticket;
    const outcome = await runOnce(ticketState(ticket), ticketQuestions(ticket), ["queue", "urgent"]);
    if (!outcome.ok) {
      setError({ status: outcome.status, message: outcome.message });
      return "error";
    }
    if (cancelRef.current) return "cancelled";
    const choice = outcome.choice;
    const noul = outcome.noul;
    // 「到这一步为止」的已完成行（含当前这条）→ 批量统计给当前行；
    // triageStats 是纯函数，每步重算一次（8 条以内）便宜。
    const completed = rows.slice(0, nextIndex).flatMap((row) =>
      row.choice === undefined
        ? []
        : [{ expected: row.ticket.expectedQueue, actual: row.choice, confidence: row.confidence ?? 0 }],
    );
    completed.push({ expected: ticket.expectedQueue, actual: choice?.choice ?? "", confidence: choice?.confidence ?? 0 });
    const stats = triageStats(completed);
    putRows(
      rows.map((row, index) =>
        index === nextIndex
          ? {
              ...row,
              choice: choice?.choice,
              urgent: noul ? noul.noul >= 0.5 : undefined,
              confidence: choice?.confidence,
              stats,
            }
          : row,
      ),
    );
    setLog((prev) => {
      const step = prev.length + 1;
      return [
        ...prev,
        {
          step,
          question: "queue",
          choice: choice?.choice ?? "—",
          confidence: choice?.confidence,
          probabilities: choice?.probabilities ?? {},
          ms: outcome.ms,
        },
        {
          step,
          question: "urgent",
          choice: noul ? String(noul.noul >= 0.5) : "—",
          probabilities: noul ? { true: noul.noul, false: 1 - noul.noul } : {},
          ms: outcome.ms,
        },
      ];
    });
    return "continue";
  };

  /** 「单步」：跑一步停住（失败 / 结束也算停住）。 */
  const stepOnce = async () => {
    if (!scenario || running) return;
    cancelRef.current = false;
    setError(null);
    setRunning(true);
    try {
      const result = await advance();
      if (result === "finished") setDone(true);
      // error 时 advance 已把错误写进 state。
    } finally {
      setRunning(false);
    }
  };

  /** 「开始」：循环 advance 直到结束 / 出错 / 被中止。 */
  const start = async () => {
    if (!scenario || running || done || error) return;
    cancelRef.current = false;
    setError(null);
    setRunning(true);
    try {
      for (;;) {
        const result = await advance();
        if (result === "cancelled") return; // 重置 / 卸载：不清现场，只停。
        if (result !== "continue") break;
        // 步与步之间留一个能看清的节奏：棋子滑过去要 220ms，让出一帧就接着跑的话
        // 本地后端能在一两帧里跑完一整局，界面上只剩最后一格 —— 等于没有动画。
        await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
      }
      setDone(true);
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    cancelRef.current = true;
    putGrid(newGridRunner({ size: gridSize, walls: gridWalls }));
    setTrail([]);
    putRows(TICKETS.map((ticket) => ({ ticket })));
    putMarket(newMarketReplay({ symbol: marketSymbol, from: marketFrom, to: marketTo, strategy: marketStrategy }));
    setMarks([]);
    setLastMove(null);
    setTally({ steps: 0, wasted: 0, confidence: 0 });
    setLog([]);
    setRunning(false);
    setError(null);
    setDone(false);
  };

  if (!scenario) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">{t("jev.playground.empty")}</p>
        <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">{t("jev.playground.empty.hint")}</p>
      </div>
    );
  }

  /**
   * 一半以上的步数都白走了（撞墙 / 撞边界），而且已经走了几步 —— 这时候该怀疑的
   * 是判定模型，不是运气。四步是门槛：前两三步撞一下很正常，模型本来就允许试错。
   */
  const noSignal = tally.steps >= 4 && tally.wasted / tally.steps >= 0.5;

  const answered = triageRows.filter((row) => row.choice !== undefined).length;
  const marketTotal = marketSteps(marketState);
  const stepNumber =
    scenario.id === "grid-runner"
      ? gridState.steps + 1
      : scenario.id === "market-replay"
        ? marketState.index + 1
        : answered + 1;
  const totalSteps =
    scenario.id === "grid-runner" ? gridState.maxSteps : scenario.id === "market-replay" ? marketTotal : TICKETS.length;
  // 用户选的区间里到底有多少根、是不是被上限截过 —— 下面的提示要如实说清楚。
  const marketWindow = clampMarketWindow(marketSymbol, marketFrom, marketTo);
  const marketSpanDates = marketSpan(marketSymbol);

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* 左：场景 + 控制 */}
      <section className="flex w-[380px] min-w-[340px] flex-none flex-col gap-4 overflow-y-auto border-r p-4">
        <div>
          <h1 className="text-sm font-semibold">{t(scenario.nameKey)}</h1>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t(scenario.descKey)}</p>
        </div>

        {/* 后端状态：没配好就提前给原因，别等跑到第一步才静默卡住。 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {status.data?.resolved ? (
              <span className="jev-pill ok">{t(`systemone.backend.${status.data.resolved}`)}</span>
            ) : (
              <span className="jev-pill warn">{t("systemone.backend.none")}</span>
            )}
            <span className="jev-pill free">{t("systemone.free")}</span>
          </div>
          {!status.data?.resolved ? (
            <span className="jev-note error">{t("jev.playground.backend.notReady")}</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={running || done} onClick={() => void start()}>
            <PlayIcon size={12} aria-hidden /> {t("jev.playground.start")}
          </Button>
          <Button size="sm" variant="outline" disabled={running || done || error !== null} onClick={() => void stepOnce()}>
            <PlusCircleIcon size={12} aria-hidden /> {t("jev.playground.step")}
          </Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcwIcon size={12} aria-hidden /> {t("jev.playground.reset")}
          </Button>
          {running ? (
            <span className="text-[11px] text-muted-foreground">
              {t("jev.playground.progress", { n: String(Math.min(stepNumber, totalSteps)), total: String(totalSteps) })}
            </span>
          ) : null}
        </div>

        {/* 盘面设置：只有网格场景有。跑的过程中锁住 —— 半局换盘面没有意义。 */}
        {scenario.id === "grid-runner" ? (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium">{t("jev.playground.grid.settings")}</span>
            <StepperRow
              label={t("jev.playground.grid.size")}
              value={t("jev.playground.grid.sizeValue", { n: String(gridSize) })}
              disabled={running}
              canDecrease={gridSize > GRID_SIZE_MIN}
              canIncrease={gridSize < GRID_SIZE_MAX}
              onDecrease={() => setGridSize(gridSize - 1)}
              onIncrease={() => setGridSize(gridSize + 1)}
            />
            <StepperRow
              label={t("jev.playground.grid.walls")}
              value={String(gridWalls)}
              disabled={running}
              canDecrease={gridWalls > 0}
              canIncrease={gridWalls < maxWallsFor(gridSize)}
              onDecrease={() => setGridWalls(gridWalls - 1)}
              onIncrease={() => setGridWalls(gridWalls + 1)}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              {t("jev.playground.grid.settingsHint", {
                max: String(maxWallsFor(gridSize)),
                steps: String(gridState.maxSteps),
              })}
            </p>
          </div>
        ) : null}

        {/* 模型对这类题没信号时直说 —— 否则界面上只看得到棋子在撞墙。 */}
        {noSignal ? (
          <div className="jev-note warn">
            {t("jev.playground.noSignal", {
              wasted: String(tally.wasted),
              steps: String(tally.steps),
              confidence: (tally.confidence / Math.max(1, tally.steps)).toFixed(3),
            })}
          </div>
        ) : null}

        {/* 行情设置：标的、区间、策略。跑的过程中锁住 —— 半程换标的没有意义。 */}
        {scenario.id === "market-replay" ? (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium">{t("jev.playground.market.settings")}</span>
            <div className="flex flex-wrap gap-1.5">
              {MARKET_SYMBOLS.map((symbol) => (
                <Button
                  key={symbol}
                  size="sm"
                  variant={symbol === marketSymbol ? "secondary" : "ghost"}
                  disabled={running}
                  onClick={() => setMarketSymbol(symbol)}
                >
                  {t(MARKET_META[symbol].nameKey)}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex-1 text-[11px] text-muted-foreground">
                {t("jev.playground.market.from")}
                <Input
                  type="date"
                  className="mt-1 h-7 text-xs"
                  value={marketFrom}
                  min={marketSpanDates.first}
                  max={marketSpanDates.last}
                  disabled={running}
                  onChange={(event) => setMarketRange({ from: event.target.value })}
                />
              </label>
              <label className="flex-1 text-[11px] text-muted-foreground">
                {t("jev.playground.market.to")}
                <Input
                  type="date"
                  className="mt-1 h-7 text-xs"
                  value={marketTo}
                  min={marketSpanDates.first}
                  max={marketSpanDates.last}
                  disabled={running}
                  onChange={(event) => setMarketRange({ to: event.target.value })}
                />
              </label>
            </div>
            <p className="text-[10px] leading-4 text-muted-foreground">
              {marketWindow.truncated
                ? t("jev.playground.market.rangeHintTruncated", {
                    bars: String(marketWindow.bars.length),
                    available: String(marketWindow.available),
                    max: String(MARKET_MAX_BARS),
                  })
                : t("jev.playground.market.rangeHint", {
                    bars: String(marketWindow.bars.length),
                    steps: String(Math.max(0, marketWindow.bars.length - 1)),
                    first: marketSpanDates.first,
                    last: marketSpanDates.last,
                  })}
            </p>
            <span className="text-[11px] font-medium">{t("jev.playground.market.strategy")}</span>
            <Textarea
              className="min-h-20 text-xs"
              value={marketStrategy}
              disabled={running}
              placeholder={t("jev.playground.market.strategyPlaceholder")}
              onChange={(event) => setMarketStrategy(event.target.value)}
            />
            <p className="text-[10px] leading-4 text-muted-foreground">
              {marketStrategy.trim()
                ? t("jev.playground.market.strategyOn")
                : t("jev.playground.market.strategyOff")}
            </p>
            <p className="text-[10px] leading-4 text-muted-foreground">{t("jev.playground.market.disclaimer")}</p>
          </div>
        ) : null}

        {error ? (
          <div className="jev-note error">
            <strong>{t("jev.failed", { status: String(error.status) })}</strong>
            <div>{error.message}</div>
            {!status.data?.resolved ? <div>{t("jev.playground.backend.notReady")}</div> : null}
          </div>
        ) : null}

        {done && !error ? <div className="jev-note ok">{t("jev.playground.done")}</div> : null}
      </section>

      {/* 右：场景可视化 + 运行日志 */}
      <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden p-5">
        <div className="flex flex-none items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{t(scenario.nameKey)}</span>
          {scenario.id === "grid-runner" ? (
            <span className="jev-pill">
              {t("jev.playground.grid.steps", { n: String(gridState.steps), max: String(gridState.maxSteps) })}
            </span>
          ) : scenario.id === "market-replay" ? (
            <span className="jev-pill">
              {t("jev.playground.market.progress", { done: String(marketState.index), total: String(marketTotal) })}
            </span>
          ) : (
            <span className="jev-pill">
              {t("jev.playground.triage.progress", { done: String(answered), total: String(TICKETS.length) })}
            </span>
          )}
        </div>

        {/*
          可视化区**不滚动**：棋盘按可用空间缩放（见 GridView），工单列表自己滚。
          这里以前是 overflow-y-auto + 下面的日志没有高度上限，日志一长就把棋盘挤没了 ——
          看着像"日志盖住了棋盘"。现在日志的高度被钉在下面那一截里，棋盘永远占着剩下的空间。
        */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {scenario.id === "grid-runner" ? (
            <GridView state={gridState} trail={trail} lastMove={lastMove} />
          ) : scenario.id === "market-replay" ? (
            <div className="h-full overflow-y-auto">
              <MarketView state={marketState} marks={marks} />
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <TriageView rows={triageRows} />
            </div>
          )}
        </div>

        <div className="flex max-h-[38%] min-h-0 flex-none flex-col">
          <span className="flex-none text-xs font-semibold text-muted-foreground">{t("jev.playground.log.title")}</span>
          <RunLog entries={log} />
        </div>
      </section>
    </div>
  );
}

/**
 * 一行「标签 − 值 ＋」的小步进器。
 *
 * 用两个按钮而不是滑块：可选值就六七档，按一下加一格比拖着找刻度准；跑的过程中
 * 整行禁用 —— 半局改盘面只会让轨迹和障碍对不上。
 */
function StepperRow({
  label,
  value,
  disabled,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  disabled: boolean;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="size-6 p-0"
          aria-label={`${label} −`}
          disabled={disabled || !canDecrease}
          onClick={onDecrease}
        >
          <MinusIcon size={12} aria-hidden />
        </Button>
        <span className="min-w-12 text-center font-mono text-[11px]">{value}</span>
        <Button
          size="sm"
          variant="outline"
          className="size-6 p-0"
          aria-label={`${label} +`}
          disabled={disabled || !canIncrease}
          onClick={onIncrease}
        >
          <PlusIcon size={12} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
