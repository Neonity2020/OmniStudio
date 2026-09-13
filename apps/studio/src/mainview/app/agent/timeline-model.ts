import type { AgentEventRow } from "../../../bun/agent";

/** 时间线上的一项：工具调用 / 状态行 / 授权卡片 / 提问卡片 / 子智能体分组。 */
export type TimelineItem =
  | { type: "tool"; start: AgentEventRow; end?: AgentEventRow }
  | { type: "status"; event: AgentEventRow }
  | { type: "permission"; ask: AgentEventRow; settle?: AgentEventRow }
  | { type: "question"; ask: AgentEventRow; settle?: AgentEventRow }
  | { type: "subagent"; start: AgentEventRow; end?: AgentEventRow; children: AgentEventRow[] };

/** 从事件 args 里取交互 id（授权 / 提问的请求与结果都带）。 */
export function parseEventId(event: AgentEventRow): string | undefined {
  if (!event.args) return undefined;
  try {
    const parsed = JSON.parse(event.args) as { id?: string };
    return typeof parsed?.id === "string" ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把一次运行的事件流整理成时间线（纯函数，UI 只负责画）。
 *
 * 配对工具调用时**不能只看列表最后一项**：工具执行前可能要等用户授权，
 * 于是 `permission_request` / `permission` 这两条事件会插在 tool_start 与
 * tool_end 之间；上下文压缩、排队提示这些 status 行同样会插进来。
 * 只看最后一项会配不上，那一行就永远停在转圈的「运行中」状态 —— 会话早就跑完
 * 甚至早就结束了，界面上却像还在执行。所以这里往回找最近一个同名、还没配对的
 * 工具行（并行执行同一批工具时也能各自配对）。
 */
export function buildTimelineItems(events: AgentEventRow[]): TimelineItem[] {
  const rendered: TimelineItem[] = [];

  // 子智能体事件按 subagentId 归类，主 Agent 的事件按顺序配对。
  const subagents = new Map<string, { start?: AgentEventRow; end?: AgentEventRow; children: AgentEventRow[] }>();
  const subagentOrder: string[] = [];
  for (const event of events) {
    if (event.subagentId) {
      const bucket = subagents.get(event.subagentId) ?? { children: [] };
      if (event.kind === "subagent_start") bucket.start = event;
      else if (event.kind === "subagent_end") bucket.end = event;
      else bucket.children.push(event);
      subagents.set(event.subagentId, bucket);
      if (!subagentOrder.includes(event.subagentId)) subagentOrder.push(event.subagentId);
    }
  }

  // 授权 / 提问：请求事件与结果事件按 id 配对（两条都落在库里，回看历史也在）。
  const settleByRequestId = new Map<string, AgentEventRow>();
  const requestIds = new Set<string>();
  for (const event of events) {
    if (event.toolName === "permission_request" || event.toolName === "question_request") {
      const id = parseEventId(event);
      if (id) requestIds.add(id);
    } else if (event.toolName === "permission" || event.toolName === "question") {
      const id = parseEventId(event);
      if (id) settleByRequestId.set(id, event);
    }
  }

  for (const event of events) {
    if (event.subagentId) continue;
    if (event.kind === "tool_start") {
      rendered.push({ type: "tool", start: event });
    } else if (event.kind === "tool_end") {
      const pending = findUnpairedTool(rendered, event.toolName);
      if (pending) pending.end = event;
      else rendered.push({ type: "tool", start: event, end: event });
    } else if (event.toolName === "permission_request" || event.toolName === "question_request") {
      const id = parseEventId(event);
      rendered.push({
        type: event.toolName === "permission_request" ? "permission" : "question",
        ask: event,
        settle: id ? settleByRequestId.get(id) : undefined,
      });
    } else if (event.toolName === "permission" || event.toolName === "question") {
      // 结果事件已经被请求卡片消费掉了：没有对应请求（理论上不会）才单独显示。
      const id = parseEventId(event);
      if (!id || !requestIds.has(id)) rendered.push({ type: "status", event });
    } else {
      rendered.push({ type: "status", event });
    }
  }

  for (const id of subagentOrder) {
    const bucket = subagents.get(id)!;
    if (!bucket.start) continue;
    rendered.push({ type: "subagent", start: bucket.start, end: bucket.end, children: bucket.children });
  }

  return rendered;
}

/** 最近一个同名、还没有配到结果的工具行（从后往前）。 */
function findUnpairedTool(
  items: TimelineItem[],
  toolName: string | null,
): Extract<TimelineItem, { type: "tool" }> | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.type !== "tool") continue;
    if (item.end) continue;
    if (item.start.toolName === toolName) return item;
  }
  return undefined;
}
