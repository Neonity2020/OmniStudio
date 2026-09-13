import { describe, expect, test } from "bun:test";

import { buildTimelineItems } from "./timeline-model";
import type { AgentEventRow } from "../../../bun/agent";

let nextId = 1;
function event(row: Partial<AgentEventRow> & Pick<AgentEventRow, "kind">): AgentEventRow {
  return {
    id: nextId++,
    conversationId: 1,
    messageId: 1,
    toolName: null,
    args: null,
    output: null,
    isError: 0,
    subagentId: null,
    createdAt: 0,
    ...row,
  };
}

describe("buildTimelineItems", () => {
  test("授权卡片插在工具调用中间时，工具行依然配到结果（不再永远转圈）", () => {
    const events = [
      event({ kind: "tool_start", toolName: "read_file", args: '{"path":"a.ts"}' }),
      event({ kind: "status", toolName: "permission_request", args: '{"id":"p1"}' }),
      event({
        kind: "status",
        toolName: "permission",
        args: '{"id":"p1","reply":"workspace"}',
        output: "已允许（写入工作区规则）",
      }),
      event({ kind: "tool_end", toolName: "read_file", output: "ok" }),
    ];

    const items = buildTimelineItems(events);
    const tool = items.find((item) => item.type === "tool") as Extract<
      (typeof items)[number],
      { type: "tool" }
    >;

    expect(tool).toBeDefined();
    expect(tool.end?.output).toBe("ok");
    // 授权卡片仍然成对展示（请求 + 结果）
    const permission = items.find((item) => item.type === "permission") as Extract<
      (typeof items)[number],
      { type: "permission" }
    >;
    expect(permission.settle?.output).toBe("已允许（写入工作区规则）");
  });

  test("status 行插在中间时同样能配对", () => {
    const events = [
      event({ kind: "tool_start", toolName: "bash", args: '{"command":"ls"}' }),
      event({ kind: "status", toolName: "compact", output: "上下文压缩" }),
      event({ kind: "tool_end", toolName: "bash", output: "done" }),
    ];

    const items = buildTimelineItems(events);
    const tools = items.filter((item) => item.type === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.end?.output).toBe("done");
    expect(items.filter((item) => item.type === "status")).toHaveLength(1);
  });

  test("同一批里并行调用同名工具时各自配对（后进先出）", () => {
    const events = [
      event({ kind: "tool_start", toolName: "bash", args: '{"command":"a"}' }),
      event({ kind: "tool_start", toolName: "bash", args: '{"command":"b"}' }),
      event({ kind: "tool_end", toolName: "bash", output: "b done" }),
      event({ kind: "tool_end", toolName: "bash", output: "a done" }),
    ];

    const items = buildTimelineItems(events);
    const tools = items.filter((item) => item.type === "tool") as Extract<
      (typeof items)[number],
      { type: "tool" }
    >[];

    expect(tools).toHaveLength(2);
    expect(tools[0]!.start.args).toBe('{"command":"a"}');
    expect(tools[0]!.end?.output).toBe("a done");
    expect(tools[1]!.start.args).toBe('{"command":"b"}');
    expect(tools[1]!.end?.output).toBe("b done");
  });

  test("没有对应 start 的 tool_end 单独成行（不吞掉结果）", () => {
    const items = buildTimelineItems([event({ kind: "tool_end", toolName: "bash", output: "x" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "tool" });
    expect((items[0] as { start: AgentEventRow }).start.kind).toBe("tool_end");
  });

  test("子智能体的事件收进分组，不混进主线", () => {
    const events = [
      event({ kind: "subagent_start", toolName: "task", subagentId: "s1", output: "探索：找配置" }),
      event({ kind: "tool_start", toolName: "grep", subagentId: "s1" }),
      event({ kind: "tool_end", toolName: "grep", subagentId: "s1", output: "hit" }),
      event({ kind: "subagent_end", toolName: "task", subagentId: "s1", output: "完成：…" }),
    ];

    const items = buildTimelineItems(events);
    expect(items).toHaveLength(1);
    const group = items[0] as Extract<(typeof items)[number], { type: "subagent" }>;
    expect(group.type).toBe("subagent");
    expect(group.children).toHaveLength(2);
  });
});
