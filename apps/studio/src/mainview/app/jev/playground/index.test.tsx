/**
 * 演练场的运行回归测试。
 *
 * 盯住一件事：**「开始」必须真的一步步往前走**。
 *
 * 第一版里 `advance` 从 React state 读局面，而「开始」是在一个闭包里连着调它的 ——
 * 整轮循环读到的都是点下按钮那一刻的那一份，于是每一步都基于同一个旧局面：棋子
 * 原地不动、工单永远在判第一条，界面上看起来像"模型每次都选一样的方向"，很难
 * 想到是循环的问题。这种错只有把组件挂起来连跑几步才抓得到。
 */
import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const DOM_GLOBALS = [
  "window", "document", "navigator", "location", "history", "localStorage",
  "HTMLElement", "HTMLDivElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement",
  "HTMLSelectElement", "Element", "Node", "Text", "DocumentFragment", "SVGElement", "DOMRect",
  "CustomElementRegistry", "Event", "CustomEvent", "MouseEvent", "PointerEvent", "KeyboardEvent",
  "FocusEvent", "InputEvent", "MutationObserver", "ResizeObserver", "NodeFilter",
  "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia",
] as const;
const savedGlobals = new Map<string, unknown>();
for (const key of DOM_GLOBALS) {
  const value = (dom as unknown as Record<string, unknown>)[key];
  if (value === undefined) continue;
  savedGlobals.set(key, (globalThis as unknown as Record<string, unknown>)[key]);
  (globalThis as unknown as Record<string, unknown>)[key] = value;
}
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 收到的每一份 state：用来断言"每一步问的是新局面"。 */
const seen: { row: number; col: number }[] = [];

mock.module("@lib/rpc", () => ({
  rpcClient: {
    systemoneStatus: async () => ({ resolved: "cloud", backend: "cloud", cloudConfigured: true, localModels: [], models: [], pricing: { inputPerMTok: 0, outputPerMTok: 0 } }),
    /**
     * 一个会走路的假模型。网格：先往下、再往右 —— 8 步到终点（绕开 (1,2) / (2,3)）；
     * 工单：随手挑 criteria 里的第一个队列。两个场景共用一个 mock，按问题名分流。
     */
    systemoneRun: async ({ state, questions }: { state: string; questions: Record<string, { type: string; criteria?: Record<string, unknown> }> }) => {
      const answers: Record<string, unknown> = {};
      for (const [name, question] of Object.entries(questions)) {
        if (question.type === "noul") {
          answers[name] = { type: "noul", noul: 0.8 };
          continue;
        }
        const options = Object.keys(question.criteria ?? {});
        let pick = options[0] ?? "";
        if (name === "next_move") {
          const parsed = JSON.parse(state) as { current: { row: number; col: number }; goal: { row: number; col: number } };
          seen.push(parsed.current);
          pick = parsed.current.row < parsed.goal.row ? "down" : "right";
        }
        answers[name] = { type: "choice", choice: pick, confidence: 0.9, probabilities: { [pick]: 0.9 } };
      }
      return {
        ok: true,
        response: { model: "jev-latest", answers, usage: { input_tokens: 10, output_tokens: 0 } },
        backend: "cloud",
        requestId: "req_x",
      };
    },
    getSettings: async () => ({ settings: {} }),
    updateSettings: async () => ({ ok: true }),
  },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { JevPlayground } = await import("./index");
const { useJevStore } = await import("@stores/jev");
const { translate } = await import("../../../../shared/i18n");

const zh = (key: string) => translate("zh", key);

afterAll(() => {
  for (const [key, value] of savedGlobals) (globalThis as unknown as Record<string, unknown>)[key] = value;
});

async function mountPlayground(): Promise<{ container: HTMLElement; unmount: () => void }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root: ReturnType<typeof createRoot>;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={client}>
        <JevPlayground />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`没找到按钮：${label}`);
  return found as HTMLButtonElement;
}

test("「开始」一步步把棋子走到终点（守住「整轮循环都在同一个局面上」那个坑）", async () => {
  seen.length = 0;
  useJevStore.getState().setScenarioId("grid-runner");
  const { container, unmount } = await mountPlayground();
  try {
    await act(async () => {
      button(container, zh("jev.playground.start")).click();
    });
    // 循环每步之间让出一帧，等它跑完。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // 每一步问的都是**新**局面：起点只出现一次，后面的位置各不相同。
    expect(seen.length).toBeGreaterThan(4);
    expect(seen[0]).toEqual({ row: 0, col: 0 });
    expect(seen[1]).not.toEqual(seen[0]);
    const unique = new Set(seen.map((p) => `${p.row},${p.col}`));
    expect(unique.size).toBe(seen.length);

    // 走到终点就该停，并报完成。
    const text = container.textContent ?? "";
    expect(text).toContain(zh("jev.playground.done"));
    // 8 步：down×4 + right×4。
    expect(seen).toHaveLength(8);
  } finally {
    unmount();
    useJevStore.getState().setScenarioId(null);
  }
});

test("「单步」只走一步，棋子换了格子", async () => {
  seen.length = 0;
  useJevStore.getState().setScenarioId("grid-runner");
  const { container, unmount } = await mountPlayground();
  try {
    await act(async () => {
      button(container, zh("jev.playground.step")).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(seen).toHaveLength(1);
    // 第二次单步问的是走完之后的局面，不是起点。
    await act(async () => {
      button(container, zh("jev.playground.step")).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ row: 1, col: 0 });
  } finally {
    unmount();
    useJevStore.getState().setScenarioId(null);
  }
});

test("工单分派：连着跑会一条条往下判，而不是反复判第一条", async () => {
  useJevStore.getState().setScenarioId("ticket-triage");
  const { container, unmount } = await mountPlayground();
  try {
    await act(async () => {
      button(container, zh("jev.playground.start")).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const text = container.textContent ?? "";
    expect(text).toContain(zh("jev.playground.done"));
  } finally {
    unmount();
    useJevStore.getState().setScenarioId(null);
  }
});
