/**
 * 演练场场景的纯逻辑测试（`scenarios.ts`）。
 *
 * 守的是三件"错了很难从界面上看出来"的事：
 * 1. 网格移动的合法性判定与计步规则（撞墙 / 出界不移动但计步，到达终点即停）；
 * 2. 发给模型的 `state` / `questions` 必须是**官方协议能过的形状**（`validateSystemOneRequest`
 *    直接验）且字段完整 —— 演练场是要自动连跑十几次的，一次 422 会让整条轨迹中断；
 * 3. 准确率统计的算法，含 0 条与全对两个边界（NaN 或除零会悄悄把统计页带崩）。
 */
import { describe, expect, test } from "bun:test";

import { validateSystemOneRequest } from "../../../../shared/systemone";
import type {
  SystemOneChoiceQuestion,
  SystemOneNoulQuestion,
} from "../../../../shared/systemone";
import {
  applyMove,
  gridRunnerQuestions,
  gridRunnerState,
  newGridRunner,
  PLAYGROUND_SCENARIOS,
  TICKETS,
  triageStats,
  ticketQuestions,
  ticketState,
  type GridDirection,
  type TriageOutcome,
} from "./scenarios";

// ---------------------------------------------------------------------------
// 场景 A：grid-runner
// ---------------------------------------------------------------------------

describe("grid-runner：移动与计步", () => {
  test("开局：起点 (0,0)、步数 0、未结束", () => {
    const start = newGridRunner();
    expect(start.pos).toEqual([0, 0]);
    expect(start.goal).toEqual([4, 4]);
    expect(start.size).toBe(5);
    expect(start.steps).toBe(0);
    expect(start.atGoal).toBe(false);
    expect(start.over).toBe(false);
    // 两个障碍都在界内且不等于起点 / 终点。
    for (const [row, col] of start.walls) {
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(5);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(5);
      expect([row, col]).not.toEqual([0, 0]);
      expect([row, col]).not.toEqual([4, 4]);
    }
  });

  test("合法移动：位置更新、步数 +1", () => {
    const start = newGridRunner();
    const move = applyMove(start, "right");
    expect(move.moved).toBe(true);
    expect(move.inBounds).toBe(true);
    expect(move.hitsWall).toBe(false);
    expect(move.next.pos).toEqual([0, 1]);
    expect(move.next.steps).toBe(1);
    expect(move.next.over).toBe(false);
  });

  test("纯函数：原局面不被修改", () => {
    const start = newGridRunner();
    const before = JSON.stringify(start);
    applyMove(start, "right");
    expect(JSON.stringify(start)).toBe(before);
  });

  test("非法移动（出界）：位置不变但计步", () => {
    const start = newGridRunner();
    const move = applyMove(start, "up"); // 第 0 行再往上 = 出界
    expect(move.moved).toBe(false);
    expect(move.inBounds).toBe(false);
    expect(move.hitsWall).toBe(false);
    expect(move.next.pos).toEqual([0, 0]);
    expect(move.next.steps).toBe(1);
  });

  test("非法移动（撞障碍）：位置不变但计步", () => {
    // (1,0) → right → (1,1)：再 right 就会撞到固定障碍 (1,2)。
    const atWall = applyMove(applyMove(newGridRunner(), "down").next, "right").next;
    expect(atWall.pos).toEqual([1, 1]);
    const move = applyMove(atWall, "right");
    expect(move.moved).toBe(false);
    expect(move.inBounds).toBe(true);
    expect(move.hitsWall).toBe(true);
    expect(move.next.pos).toEqual([1, 1]);
    expect(move.next.steps).toBe(atWall.steps + 1);
  });

  test("到达终点：atGoal 与 over 同时置真", () => {
    // (0,0) → down×4 → (4,0) → right×4 → (4,4)：底行 + 右列，绕开两个固定障碍 (1,2) / (2,3)。
    const dirs: GridDirection[] = ["down", "down", "down", "down", "right", "right", "right", "right"];
    const path = dirs.reduce((state, dir) => applyMove(state, dir).next, newGridRunner());
    expect(path.pos).toEqual([4, 4]);
    expect(path.atGoal).toBe(true);
    expect(path.over).toBe(true);
  });

  test("超过 20 步强制结束（即使没到终点）", () => {
    // 左右来回磨步数：永远不会到终点，但 20 步后必须 over。
    const dirs: GridDirection[] = ["right", "left"];
    let state = newGridRunner();
    for (let i = 0; i < GRID_STEPS_FOR_TEST; i++) {
      state = applyMove(state, dirs[i % 2]!).next;
    }
    expect(state.steps).toBe(20);
    expect(state.over).toBe(true);
    expect(state.atGoal).toBe(false);
  });
});

// 上面那个来回测试用到的步数（写常量是为了不让"20"这个魔法数在测试里散落）。
const GRID_STEPS_FOR_TEST = 20;

// `Record<string, Question>` 的索引在 strict 下是「可能不存在」的，但演练场的问题名
// 是自己写死的（`next_move` / `queue` / `urgent`）—— 这里统一收窄，避免每个用例都加 `!`。
function gridMoveQuestion(state: ReturnType<typeof gridRunnerQuestions>) {
  const question = state.next_move;
  if (!question || question.type !== "choice") throw new Error("expected a choice question named next_move");
  return question as SystemOneChoiceQuestion;
}

function ticketQuestionsTyped(qs: ReturnType<typeof ticketQuestions>) {
  const queue = qs.queue;
  const urgent = qs.urgent;
  if (!queue || queue.type !== "choice") throw new Error("expected a choice question named queue");
  if (!urgent || urgent.type !== "noul") throw new Error("expected a noul question named urgent");
  return { queue, urgent: urgent as SystemOneNoulQuestion };
}

describe("grid-runner：序列化（state / questions）", () => {
  test("state 字段完整（尺寸 / 坐标 / 障碍 / 步数 / 四方向）", () => {
    const state = newGridRunner();
    const payload = gridRunnerState(state);
    expect(payload).toBeTypeOf("object");
    expect(payload).not.toBeInstanceOf(Array);
    expect(payload.grid_size).toBe(5);
    expect(payload.current).toEqual({ row: 0, col: 0 });
    expect(payload.goal).toEqual({ row: 4, col: 4 });
    expect(payload.start).toEqual({ row: 0, col: 0 });
    expect(payload.obstacles).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 3 },
    ]);
    expect(payload.steps_used).toBe(0);
    expect(payload.at_goal).toBe(false);
    expect(payload.finished).toBe(false);
    // 四个方向都在，且每个都有 in_bounds / legal 判定。
    const moves = payload.moves as Record<GridDirection, { in_bounds: boolean; legal: boolean }>;
    for (const dir of ["up", "down", "left", "right"] as const) {
      const move = moves[dir]!;
      expect(move.in_bounds).toBeTypeOf("boolean");
      expect(move.legal).toBeTypeOf("boolean");
    }
  });

  test("state 是英文（发给模型的文本不能混入 CJK）", () => {
    const payload = gridRunnerState(newGridRunner());
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/[\u4e00-\u9fa5]/);
  });

  test("state 能直接通过官方协议校验（对象形态的 state）", () => {
    const state = newGridRunner();
    const validated = validateSystemOneRequest({
      state: gridRunnerState(state),
      model: "jev-latest",
      questions: gridRunnerQuestions(state),
    });
    expect(validated.ok).toBe(true);
  });

  test("questions 是四个方向的 choice，criteria 与 state.moves 同义不矛盾", () => {
    const question = gridMoveQuestion(gridRunnerQuestions(newGridRunner()));
    expect(Object.keys(question.criteria).sort()).toEqual(["down", "left", "right", "up"]);
    // 起点 (0,0)：up / left 出界 → 说明里必须点明撞边界；down / right 可走。
    expect(String(question.criteria.up)).toMatch(/boundary|leaves the grid/);
    expect(String(question.criteria.left)).toMatch(/boundary|leaves the grid/);
    expect(String(question.criteria.down)).toMatch(/empty cell/);
    expect(String(question.criteria.right)).toMatch(/empty cell/);
  });
});

// ---------------------------------------------------------------------------
// 场景 B：ticket-triage
// ---------------------------------------------------------------------------

describe("ticket-triage：数据与请求构造", () => {
  test("8 条工单，四类各 2 条，id 互不重复", () => {
    expect(TICKETS).toHaveLength(8);
    const counts: Record<string, number> = {};
    for (const ticket of TICKETS) counts[ticket.expectedQueue] = (counts[ticket.expectedQueue] ?? 0) + 1;
    expect(counts.billing).toBe(2);
    expect(counts.technical).toBe(2);
    expect(counts.account).toBe(2);
    expect(counts.abuse).toBe(2);
    expect(new Set(TICKETS.map((t) => t.id)).size).toBe(TICKETS.length);
  });

  test("工单文本是英文", () => {
    for (const ticket of TICKETS) {
      expect(`${ticket.subject} ${ticket.body}`).not.toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  test("每条工单的两问都能通过官方协议校验（choice + noul）", () => {
    for (const ticket of TICKETS) {
      const { queue, urgent } = ticketQuestionsTyped(ticketQuestions(ticket));
      expect(Object.keys(queue.criteria).sort()).toEqual(["abuse", "account", "billing", "technical"]);
      expect(urgent.criteria?.true).toBeTruthy();
      expect(urgent.criteria?.false).toBeTruthy();
      const validated = validateSystemOneRequest({
        state: ticketState(ticket),
        model: "jev-latest",
        questions: ticketQuestions(ticket),
      });
      expect(validated.ok).toBe(true);
    }
  });

  test("state 字段完整（id / subject / body）", () => {
    const ticket = TICKETS[0]!;
    const payload = ticketState(ticket);
    expect(payload.ticket_id).toBe(ticket.id);
    expect(payload.subject).toBe(ticket.subject);
    expect(payload.body).toBe(ticket.body);
  });
});

describe("ticket-triage：统计（triageStats）", () => {
  test("0 条：total / correct / accuracy / meanConfidence 全 0（不出现 NaN）", () => {
    const stats = triageStats([]);
    expect(stats).toEqual({ total: 0, correct: 0, accuracy: 0, meanConfidence: 0 });
    expect(Number.isNaN(stats.accuracy)).toBe(false);
    expect(Number.isNaN(stats.meanConfidence)).toBe(false);
  });

  test("全对：accuracy = 1，meanConfidence 是各置信度的算术平均", () => {
    const outcomes: TriageOutcome[] = [
      { expected: "billing", actual: "billing", confidence: 0.8 },
      { expected: "technical", actual: "technical", confidence: 0.6 },
      { expected: "account", actual: "account", confidence: 0.4 },
    ];
    const stats = triageStats(outcomes);
    expect(stats.total).toBe(3);
    expect(stats.correct).toBe(3);
    expect(stats.accuracy).toBe(1);
    expect(stats.meanConfidence).toBeCloseTo(0.6);
  });

  test("部分错：correct 只数 expected === actual，accuracy = correct / total", () => {
    const outcomes: TriageOutcome[] = [
      { expected: "billing", actual: "billing", confidence: 0.9 },
      { expected: "technical", actual: "billing", confidence: 0.7 },
      { expected: "account", actual: "account", confidence: 0.5 },
      { expected: "abuse", actual: "technical", confidence: 0.3 },
    ];
    const stats = triageStats(outcomes);
    expect(stats.total).toBe(4);
    expect(stats.correct).toBe(2);
    expect(stats.accuracy).toBe(0.5);
    expect(stats.meanConfidence).toBeCloseTo(0.6);
  });

  test("全错：accuracy = 0，但置信度仍要平均", () => {
    const outcomes: TriageOutcome[] = [
      { expected: "billing", actual: "technical", confidence: 0.99 },
      { expected: "technical", actual: "billing", confidence: 0.51 },
    ];
    const stats = triageStats(outcomes);
    expect(stats.correct).toBe(0);
    expect(stats.accuracy).toBe(0);
    expect(stats.meanConfidence).toBeCloseTo(0.75);
  });
});

// ---------------------------------------------------------------------------
// 场景目录
// ---------------------------------------------------------------------------

describe("PLAYGROUND_SCENARIOS", () => {
  test("两个场景的 id 与 i18n key 都齐", () => {
    expect(PLAYGROUND_SCENARIOS).toHaveLength(2);
    expect(PLAYGROUND_SCENARIOS.map((s) => s.id)).toEqual(["grid-runner", "ticket-triage"]);
    for (const scenario of PLAYGROUND_SCENARIOS) {
      expect(scenario.nameKey).toBeTypeOf("string");
      expect(scenario.descKey).toBeTypeOf("string");
      expect(scenario.nameKey.startsWith("jev.playground.")).toBe(true);
      expect(scenario.descKey.startsWith("jev.playground.")).toBe(true);
    }
  });
});
