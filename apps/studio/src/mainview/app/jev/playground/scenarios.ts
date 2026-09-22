/**
 * 演练场（Playground）的两个内置场景 —— **纯逻辑层**。
 *
 * 与侧栏内置示例（`../examples.ts`）的分工：那边是"给编辑器装一份请求"，这里是
 * "自动跑完一串判定，把每一步摊开看"。所以本文件只有纯函数：局面推进、请求构造、
 * 结果统计，不含任何 React / rpcClient —— UI（Task 2/3）负责按自己的节奏调
 * `rpcClient.systemoneRun` 并拿这里的数据来渲染。
 *
 * **发给模型的文本一律英文**：JEV 官方模型卡写明主训练语言是英语，CJK 准确率明显更低。
 * 演练场要展示模型的"真实表现"，场景数据里掺中文会把展示结果拖下水；界面文案才走 i18n
 * 双语（`nameKey` / `descKey`，Task 3 补文案）。
 *
 * 注意 RPC 侧 `state` 的参数类型是 `string`：这里的序列化函数返回对象（协议本身允许
 * 对象），发请求前在 UI 层 `JSON.stringify` 即可，纯逻辑层不替调用方做这步。
 */
import type {
  SystemOneChoiceQuestion,
  SystemOneNoulQuestion,
  SystemOneQuestions,
} from "../../../../shared/systemone";

// ---------------------------------------------------------------------------
// 场景 A：grid-runner（5×5 网格寻路 —— 连续决策）
//
// 每一步都是一次独立的 `systemoneRun`：state 随局面变化，问题也随局面变化（撞墙 /
// 撞障碍的方向会在 criteria 里被点名）。跑完一条轨迹后，用户能看到"同一类问题
// 在不同局面下，模型的选择与置信度如何漂移"。
// ---------------------------------------------------------------------------

export type GridDirection = "up" | "down" | "left" | "right";

/** 方向 → 行 / 列偏移（行 0 是上边）。 */
const GRID_DELTA: Record<GridDirection, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/**
 * 固定的两个障碍：(1,2) 与 (2,3)。
 *
 * 选它们的原因：都离起点不远（几步之内就会真的撞上去，模型才有机会"看"到障碍），
 * 又都不堵死任何一行一列 —— 存在大量可行路线（可解）。
 */
export const GRID_SIZE = 5;
export const GRID_START: [number, number] = [0, 0];
export const GRID_GOAL: [number, number] = [4, 4];
export const GRID_WALLS: readonly [number, number][] = [[1, 2], [2, 3]];
/** 默认尺寸（5×5）下的步数上限；别的尺寸走 `gridMaxSteps`。 */
export const GRID_MAX_STEPS = 20;

/**
 * 可调范围。下限 4 是"还能看出寻路"的最小盘，上限 10 是格子缩到看不清之前的极限
 * （10×10 = 100 格，每步仍只问一个四选一的问题，跑满也就几十次判定）。
 */
export const GRID_SIZE_MIN = 4;
export const GRID_SIZE_MAX = 10;

/**
 * 步数上限随盘面走：最短路是 `2 * (size - 1)` 步，给两倍半的余量 —— 够撞几次墙、
 * 绕一段远路，又不至于让一条走不出去的轨迹拖到几十次判定。
 * 默认的 5×5 正好回到 20，和以前一模一样。
 */
export function gridMaxSteps(size: number): number {
  return (size - 1) * 5;
}

/**
 * 一个盘面最多摆几个障碍：四分之一的格子。再多就很容易把盘面切成两半 —— 那时
 * 生成器只能一个个试着放弃，用户拖到头却发现障碍没变多，不如把上限说清楚。
 */
export function maxWallsFor(size: number): number {
  return Math.floor((size * size) / 4);
}

/** 值夹在范围里（界面传进来的都是用户点出来的，越界就贴边）。 */
export function clampGridSize(size: number): number {
  if (!Number.isFinite(size)) return GRID_SIZE;
  return Math.min(GRID_SIZE_MAX, Math.max(GRID_SIZE_MIN, Math.floor(size)));
}

export function clampWallCount(size: number, count: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.min(maxWallsFor(size), Math.max(0, Math.floor(count)));
}

export type GridRunnerState = {
  size: number;
  /** [row, col]，行 0 在上、列 0 在左。 */
  pos: [number, number];
  goal: [number, number];
  walls: [number, number][];
  /** 已经用掉的步数（非法移动也计数 —— 撞墙也是有代价的，这正是想展示给用户的）。 */
  steps: number;
  /** 这一局的步数上限（随尺寸变，见 `gridMaxSteps`）。 */
  maxSteps: number;
  atGoal: boolean;
  over: boolean;
};

export type GridRunnerMove = {
  next: GridRunnerState;
  /** 移动后是否还在界内（撞墙 = false）。 */
  inBounds: boolean;
  /** 目标格是否是障碍。 */
  hitsWall: boolean;
  target: [number, number];
  /** 撞墙 / 撞障碍：位置不变，但步数照计。 */
  moved: boolean;
};

/** 32 位小 PRNG：同样的 seed 永远给同一串数，所以"同一档设置 = 同一个盘面"。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 起点能不能走到终点（BFS，把 `walls` 当不可通行）。 */
function gridSolvable(size: number, walls: readonly [number, number][]): boolean {
  const blocked = new Set(walls.map(([r, c]) => `${r},${c}`));
  const goal = `${size - 1},${size - 1}`;
  if (blocked.has("0,0") || blocked.has(goal)) return false;
  const seen = new Set(["0,0"]);
  const queue: [number, number][] = [[0, 0]];
  while (queue.length > 0) {
    const [row, col] = queue.shift() as [number, number];
    if (`${row},${col}` === goal) return true;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const r = row + dr;
      const c = col + dc;
      const key = `${r},${c}`;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      if (blocked.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push([r, c]);
    }
  }
  return false;
}

/**
 * 按尺寸与数量摆障碍。
 *
 * 两条硬要求：**盘面必须可解**（每放一个都用 BFS 验一遍，堵死了就换一格），
 * 同一档设置**必须摆出同一个盘面**（seed 只由 size 与 count 决定）—— 否则用户
 * 点一下「重置」盘面就变了，没法比较"同一局面下模型的选择"。
 *
 * 起点与终点不放障碍；要的数量放不下时就放到放不下为止（上限见 `maxWallsFor`）。
 */
export function buildGridWalls(size: number, count: number): [number, number][] {
  const wanted = clampWallCount(size, count);
  if (wanted === 0) return [];
  const cells: [number, number][] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (row === 0 && col === 0) continue;
      if (row === size - 1 && col === size - 1) continue;
      cells.push([row, col]);
    }
  }
  // Fisher–Yates，随机源是那个定死 seed 的 PRNG。
  const rand = mulberry32(size * 1000 + wanted);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = cells[i] as [number, number];
    const b = cells[j] as [number, number];
    cells[i] = b;
    cells[j] = a;
  }
  const walls: [number, number][] = [];
  for (const cell of cells) {
    if (walls.length >= wanted) break;
    const candidate: [number, number][] = [...walls, cell];
    if (gridSolvable(size, candidate)) walls.push(cell);
  }
  return walls.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * 开局（纯函数：任何时刻可以从一个局面重新开局）。
 *
 * 不带参数就是默认的 5×5 两障碍 —— 那两个位置 (1,2) / (2,3) 是挑过的（见上面的
 * 注释），不交给生成器重摆。改过尺寸或障碍数才按设置生成。
 */
export function newGridRunner(options?: { size?: number; walls?: number }): GridRunnerState {
  const size = clampGridSize(options?.size ?? GRID_SIZE);
  const wallCount = clampWallCount(size, options?.walls ?? GRID_WALLS.length);
  const isDefault = size === GRID_SIZE && wallCount === GRID_WALLS.length;
  return {
    size,
    pos: [...GRID_START],
    goal: [size - 1, size - 1],
    walls: isDefault ? GRID_WALLS.map(([r, c]) => [r, c]) : buildGridWalls(size, wallCount),
    steps: 0,
    maxSteps: gridMaxSteps(size),
    atGoal: false,
    over: false,
  };
}

function isWall(state: GridRunnerState, row: number, col: number): boolean {
  return state.walls.some(([r, c]) => r === row && c === col);
}

/**
 * 局面 → JEV 的 `state`（英文 JSON **对象**，不拍平成字符串）。
 *
 * 字段刻意把"四个方向各自会走到哪、是否可走"摊开：JEV 是 encoder 类小模型，
 * 把可推导的信息直接写进 state 比指望它自己算坐标差值稳得多。
 */
export function gridRunnerState(state: GridRunnerState): Record<string, unknown> {
  const { size, pos, goal, walls, steps, over, atGoal } = state;
  return {
    // 盘面大小与步数上限都跟着设置走：state 里写的数字必须就是这一局真正的规则，
    // 不然模型按"20 步"盘算，实际却在第 45 步才结束。
    task: `${size}x${size} grid pathfinding`,
    description:
      "A single agent moves on a grid. It starts at the start cell and must reach the goal cell. " +
      "It may move one cell per step: up, down, left or right. A step into a wall or an obstacle " +
      "does not move the agent, but it still costs one step. The walk ends when the agent reaches " +
      `the goal cell, or when it has used more than ${state.maxSteps} steps.`,
    grid_size: size,
    start: { row: GRID_START[0], col: GRID_START[1] },
    current: { row: pos[0], col: pos[1] },
    goal: { row: goal[0], col: goal[1] },
    obstacles: walls.map(([row, col]) => ({ row, col })),
    steps_used: steps,
    max_steps: state.maxSteps,
    at_goal: atGoal,
    finished: over,
    moves: {
      // 顺序固定：界面与模型看到的顺序一致。
      up: gridMoveInfo(state, "up"),
      down: gridMoveInfo(state, "down"),
      left: gridMoveInfo(state, "left"),
      right: gridMoveInfo(state, "right"),
    },
  };
}

function gridMoveInfo(state: GridRunnerState, dir: GridDirection) {
  const [dr, dc] = GRID_DELTA[dir];
  const row = state.pos[0] + dr;
  const col = state.pos[1] + dc;
  const inBounds = row >= 0 && row < state.size && col >= 0 && col < state.size;
  if (!inBounds) {
    return {
      direction: dir,
      in_bounds: false,
      target: null,
      blocked: "wall",
      legal: false,
      note: `Stepping ${dir} leaves the grid (hits the boundary). The agent would stay in place, but the step still counts.`,
    };
  }
  const hitsWall = isWall(state, row, col);
  return {
    direction: dir,
    in_bounds: true,
    target: { row, col },
    blocked: hitsWall ? "obstacle" : null,
    legal: !hitsWall,
    note: hitsWall
      ? `Stepping ${dir} would land on the obstacle at row ${row}, col ${col}. The agent would stay in place, but the step still counts.`
      : `Stepping ${dir} would land on the empty cell at row ${row}, col ${col}.`,
  };
}

/**
 * 局面 → `questions`：一个 `choice`，四个方向各一条英文说明。
 *
 * 说明里带上"会走到哪个格子 / 撞墙还是撞障碍"，与 state.moves 里的 note 同源
 * （共用 `gridMoveInfo`）—— state 和 criteria 不能互相矛盾，否则模型只能猜谁是对的。
 */
export function gridRunnerQuestions(state: GridRunnerState): SystemOneQuestions {
  return {
    next_move: gridChoiceQuestion(state),
  };
}

/** 独立导出：UI 可能只想要"问题本身"（不想要整份 questions 包裹）。 */
export function gridChoiceQuestion(state: GridRunnerState): SystemOneChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Which direction should the agent move next? Pick the move that makes the most progress " +
      "toward the goal while staying clear of walls and obstacles.",
    criteria: {
      up: gridMoveInfo(state, "up").note,
      down: gridMoveInfo(state, "down").note,
      left: gridMoveInfo(state, "left").note,
      right: gridMoveInfo(state, "right").note,
    },
  };
}

/** 推进一步（纯函数、不可变更新）；非法移动位置不变但计步。 */
export function applyMove(state: GridRunnerState, direction: GridDirection): GridRunnerMove {
  const [dr, dc] = GRID_DELTA[direction];
  const row = state.pos[0] + dr;
  const col = state.pos[1] + dc;
  const inBounds = row >= 0 && row < state.size && col >= 0 && col < state.size;
  const hitsWall = inBounds && isWall(state, row, col);
  const moved = inBounds && !hitsWall;

  const steps = state.steps + 1;
  const next: GridRunnerState = {
    ...state,
    pos: moved ? [row, col] : [...state.pos],
    steps,
    atGoal: moved && row === state.goal[0] && col === state.goal[1],
  };
  next.over = next.atGoal || steps >= next.maxSteps;
  return { next, inBounds, hitsWall, target: [row, col], moved };
}

// ---------------------------------------------------------------------------
// 场景 B：ticket-triage（工单分派 —— 批量分类，可算准确率）
//
// 8 条真实风格短句覆盖四个队列（每类 2 条），每条带 `expectedQueue` 标准答案，
// 跑完可以算准确率与平均置信度 —— 这是 JEV"类型化判定"最典型的卖点。
// ---------------------------------------------------------------------------

export type TicketQueue = "billing" | "technical" | "account" | "abuse";

export type Ticket = {
  id: number;
  subject: string;
  body: string;
  /** 标准答案（界面据此标对错）。 */
  expectedQueue: TicketQueue;
};

export const TICKET_QUEUES: readonly TicketQueue[] = ["billing", "technical", "account", "abuse"];

export const TICKET_QUEUE_DESCRIPTIONS: Record<TicketQueue, string> = {
  billing: "Charges, invoices, payments, refunds or subscription plans.",
  technical: "Bugs, crashes, outages or integration problems.",
  account: "Sign-in, passwords, profile, email changes or account access.",
  abuse: "Harassment, threats, spam, or misuse of the platform.",
};

export const TICKETS: readonly Ticket[] = [
  {
    id: 1,
    subject: "Double charged on my Pro subscription",
    body:
      "My card was charged twice for the Pro plan on the 3rd, and I still only have one subscription active. Please refund the duplicate charge.",
    expectedQueue: "billing",
  },
  {
    id: 2,
    subject: "API returns 500 errors since this morning",
    body:
      "Since 09:40 UTC the /v1/records endpoint returns 500 for every request. Retrying does not help, and the status page looks fine on your side.",
    expectedQueue: "technical",
  },
  {
    id: 3,
    subject: "Cannot reset my password",
    body:
      "The reset email never arrives, both in my inbox and spam folder. I am completely locked out of my account and I need access back today.",
    expectedQueue: "account",
  },
  {
    id: 4,
    subject: "User is spamming all project channels",
    body:
      "A user named 'dealz2024' is posting the same spam link in every shared channel and ignoring two moderator warnings. Please suspend the account.",
    expectedQueue: "abuse",
  },
  {
    id: 5,
    subject: "Refund not received after 3 weeks",
    body:
      "I was promised a refund on the 10th, it was marked complete in your system, but the money never reached my card. Three weeks have already passed.",
    expectedQueue: "billing",
  },
  {
    id: 6,
    subject: "Export button crashes the web app",
    body:
      "Clicking 'Export CSV' on the reports page freezes the whole app and eventually throws a blank white screen. Chrome, Firefox and Safari are all affected.",
    expectedQueue: "technical",
  },
  {
    id: 7,
    subject: "My email was changed without consent",
    body:
      "I never requested a change, but the account is now sending notifications to a different email address. I believe my account was compromised.",
    expectedQueue: "account",
  },
  {
    id: 8,
    subject: "Threats in the public forum",
    body:
      "Someone is posting personal details about a community member and telling them to 'leave town'. This has been going on for two days and the member is scared.",
    expectedQueue: "abuse",
  },
];

/** 单条工单 → JEV 的 `state`（英文对象）。 */
export function ticketState(ticket: Ticket): Record<string, unknown> {
  return {
    task: "Support ticket triage",
    description:
      "Classify the customer ticket into the queue that should handle it, and judge how urgent it is. " +
      "Answer from the ticket text only.",
    ticket_id: ticket.id,
    subject: ticket.subject,
    body: ticket.body,
  };
}

/** 单条工单 → `questions`：队列归类（choice）+ 是否紧急（noul）。 */
export function ticketQuestions(ticket: Ticket): SystemOneQuestions {
  return {
    queue: ticketQueueQuestion(ticket),
    urgent: ticketUrgencyQuestion(ticket),
  };
}

export function ticketQueueQuestion(_ticket: Ticket): SystemOneChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Which support queue should handle this ticket? Pick exactly one queue; use the descriptions to decide, " +
      "and choose the queue that owns the main problem, not the most recent sentence.",
    criteria: {
      billing: TICKET_QUEUE_DESCRIPTIONS.billing,
      technical: TICKET_QUEUE_DESCRIPTIONS.technical,
      account: TICKET_QUEUE_DESCRIPTIONS.account,
      abuse: TICKET_QUEUE_DESCRIPTIONS.abuse,
    },
  };
}

export function ticketUrgencyQuestion(_ticket: Ticket): SystemOneNoulQuestion {
  return {
    type: "noul",
    instructions:
      "Is this ticket urgent, meaning it should jump ahead of ordinary tickets in its queue? " +
      "Base the answer on the ticket text only.",
    criteria: {
      true: "Money, legal, security or data loss is already happening, or the customer is fully blocked with no workaround.",
      false: "A normal request a human or the queue can handle in ordinary order.",
    },
  };
}

/**
 * 批量统计（纯函数）。
 *
 * 给一组 `{ expected, actual, confidence }`（actual 是模型选出的队列名，confidence
 * 是 choice 答案的置信度），返回总数 / 正确数 / 准确率 / 平均置信度。
 * 空列表：accuracy 与 meanConfidence 都给 0 —— 调用方用 `total === 0` 自己判"没有数据"，
 * 这里不返回 NaN（NaN 会把下游的展示和测试一起带崩）。
 */
export type TriageOutcome = {
  expected: string;
  actual: string;
  /** 0..1（choice 答案的置信度）。 */
  confidence: number;
};

export type TriageStats = {
  total: number;
  correct: number;
  /** 0..1；total 为 0 时是 0。 */
  accuracy: number;
  /** 0..1；total 为 0 时是 0。 */
  meanConfidence: number;
};

export function triageStats(outcomes: readonly TriageOutcome[]): TriageStats {
  const total = outcomes.length;
  const correct = outcomes.filter((outcome) => outcome.expected === outcome.actual).length;
  const accuracy = total > 0 ? correct / total : 0;
  const meanConfidence =
    total > 0 ? outcomes.reduce((sum, outcome) => sum + outcome.confidence, 0) / total : 0;
  return { total, correct, accuracy, meanConfidence };
}

// ---------------------------------------------------------------------------
// 统一导出
// ---------------------------------------------------------------------------

export type PlaygroundScenario = {
  id: string;
  /** i18n key（Task 3 补文案；先钉住 key 名，避免 UI 先写死字符串）。 */
  nameKey: string;
  descKey: string;
};

export const PLAYGROUND_SCENARIOS: readonly PlaygroundScenario[] = [
  {
    id: "grid-runner",
    nameKey: "jev.playground.gridRunner.name",
    descKey: "jev.playground.gridRunner.desc",
  },
  {
    id: "ticket-triage",
    nameKey: "jev.playground.ticketTriage.name",
    descKey: "jev.playground.ticketTriage.desc",
  },
];
