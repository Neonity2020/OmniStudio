import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * 执行轨迹的运行态 —— 这是"它还在干活吗"在界面上唯一的线索。
 *
 * 已发生的问题：跑动中的轨迹和跑完的轨迹长得一模一样（同样的标题、同样的绿点），
 * 中间几秒没有新事件时更是彻底静止，旁观者分不出它是还在执行还是已经收工。
 * 这里钉住四件事：
 *   1. 跑动中标题带「处理中 · N 秒」，且没有任何新事件时秒数自己往前走；
 *   2. 没有工具在跑时，轨迹末尾有一条"还在干活"的转圈行；
 *   3. 工具自己那行在转圈时不再叠加一条（同一时刻只留一处动画）；
 *   4. 跑完：标题变「已处理 · N 秒」，转圈全部消失。
 */

// happy-dom 提供真实 DOM（定时器 / 查询选择器都要用），afterAll 还原全局。
const dom = new Window({ url: "http://localhost/" });
const DOM_GLOBALS = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Text", "MutationObserver", "CustomEvent", "Event"] as const;
const savedGlobals = new Map<string, unknown>();
for (const key of DOM_GLOBALS) {
  const value = (dom as unknown as Record<string, unknown>)[key];
  if (value === undefined) continue;
  savedGlobals.set(key, (globalThis as unknown as Record<string, unknown>)[key]);
  (globalThis as unknown as Record<string, unknown>)[key] = value;
}
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// 渲染这条消息会连带加载 RPC 客户端（Electroview 需要浏览器环境），这里给个空壳：
// 本测试不点任何按钮，只要模块能加载即可。
mock.module("@lib/rpc", () => ({ rpcClient: {} }));

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AgentAssistantMessage } = await import("./message");
const { useChatStore } = await import("@stores/chat");
const { translate } = await import("../../../shared/i18n");
type AgentEventRow = import("../../../bun/agent").AgentEventRow;

const zh = (key: string, params?: Record<string, string>) => translate("zh", key, params);
const MESSAGE_ID = 10;
const CONVERSATION_ID = 1;

afterAll(() => {
  for (const [key, value] of savedGlobals) {
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  }
  delete (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

afterEach(async () => {
  // 必须卸载：计时器（秒数跳动）不停的话，React 的调度会在 DOM 全局被还原之后再跑一次。
  if (mounted) {
    const { root } = mounted;
    mounted = null;
    await act(async () => {
      root.unmount();
    });
  }
  for (const el of Array.from(document.body.children)) el.remove();
  useChatStore.getState().setActiveConversation(null);
});

/** 当前挂着的这棵树（afterEach 负责卸载）。 */
let mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement } | null = null;

let nextEventId = 1;
function event(overrides: Partial<AgentEventRow> & { kind: AgentEventRow["kind"] }): AgentEventRow {
  return {
    id: nextEventId++,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    toolName: "bash",
    args: JSON.stringify({ command: "ls" }),
    output: "",
    isError: 0,
    subagentId: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** 跑动中的一轮：起点按第一条事件算（刷新窗口后就只有这一份时间可用）。 */
const startedAgo = (ms: number) => Date.now() - ms;

async function renderMessage({
  events,
  streaming,
  content = "",
}: {
  events: AgentEventRow[];
  streaming: boolean;
  content?: string;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AgentAssistantMessage, {
          message: {
            id: MESSAGE_ID,
            conversationId: CONVERSATION_ID,
            role: "assistant" as const,
            content,
            createdAt: startedAgo(3000),
          },
          conversationId: CONVERSATION_ID,
          events,
          artifacts: [],
          streaming,
          onOpenArtifact: () => {},
        }),
      ),
    );
  });
  return container;
}

const label = (container: HTMLElement) => container.querySelector(".tool-group-label")?.textContent ?? "";
/** 标题里的秒数（「处理中 · 3.0 秒」→ 3.0）。 */
function secondsOf(container: HTMLElement): number {
  const match = /·\s*([\d.]+)\s*/.exec(label(container));
  if (!match) throw new Error(`标题里没有秒数：${label(container)}`);
  return Number(match[1]);
}

test("跑动中标题报「处理中 · N 秒」，静默期里秒数自己往前走", async () => {
  const container = await renderMessage({
    streaming: true,
    events: [
      event({ kind: "tool_start", createdAt: startedAgo(3000) }),
      event({ kind: "tool_end", createdAt: startedAgo(2500) }),
    ],
  });

  expect(label(container)).toContain(zh("chat.working.duration", { duration: "3.0 秒" }));

  // 什么都不发生（没有新事件、没有新正文）：秒数也得继续走 —— 等模型决定
  // 下一步的那几秒正是最像"卡死了"的时候。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  });
  expect(secondsOf(container)).toBeGreaterThan(3);
  expect(label(container)).toContain(zh("chat.working.duration", { duration: `${secondsOf(container).toFixed(1)} 秒` }));
});

test("没有工具在跑：轨迹末尾有一条「正在工作中」的转圈行", async () => {
  const container = await renderMessage({
    streaming: true,
    events: [
      event({ kind: "tool_start", createdAt: startedAgo(3000) }),
      event({ kind: "tool_end", createdAt: startedAgo(2500) }),
    ],
  });

  const tail = container.querySelector(".working-indicator");
  expect(tail?.textContent).toContain(zh("agent.working"));
  expect(container.querySelectorAll(".tool-spinner").length).toBe(1); // 标题那一个
});

test("工具自己那行在转圈时，不再叠加一条（同一时刻只有一处动画）", async () => {
  const container = await renderMessage({
    streaming: true,
    events: [event({ kind: "tool_start", createdAt: startedAgo(1000) })],
  });

  expect(container.querySelector(".working-indicator")).toBeNull();
  // 标题 + 那一行工具：转圈在工具行上
  expect(container.querySelectorAll(".tool-spinner").length).toBe(2);
});

test("跑完：标题变「已处理 · N 秒」，转圈全部消失", async () => {
  await act(async () => {
    useChatStore.getState().setActiveConversation(CONVERSATION_ID);
    useChatStore.getState().setMessageStats(CONVERSATION_ID, MESSAGE_ID, {
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      tokens: 120,
      tokensPerSec: 30,
      elapsedMs: 12_000,
      source: "estimate",
    });
  });

  const container = await renderMessage({
    streaming: false,
    content: "干完了",
    events: [
      event({ kind: "tool_start", createdAt: startedAgo(12_000) }),
      event({ kind: "tool_end", createdAt: startedAgo(11_000) }),
    ],
  });

  expect(label(container)).toBe(zh("chat.worked", { duration: "12.0 秒" }));
  expect(container.querySelectorAll(".tool-spinner").length).toBe(0);
  expect(container.querySelector(".working-indicator")).toBeNull();

  await act(async () => {
    useChatStore.getState().removeMessage(CONVERSATION_ID, MESSAGE_ID);
  });
});
