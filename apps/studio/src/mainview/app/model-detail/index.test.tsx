import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * 模型详情页的下载单元是**整个模型**，不是单个文件。
 *
 * safetensors / MLX 仓库的十几个分片 + config / tokenizer 必须一起下完才能加载，
 * 所以界面上要回答的是「这个模型整体下了多少」：一张卡、一个进度、一个主按钮。
 * 之前每个文件一条进度条 + 「排队中 · 前面还有 N 个」+ 各自的暂停/重试，把整体
 * 进度整个淹掉了 —— 这个文件锁住聚合后的样子。
 *
 * happy-dom 提供真实 DOM（Radix 需要），afterAll 还原全局。
 */
const dom = new Window({ url: "http://localhost/" });
const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSpanElement",
  "Element",
  "Node",
  "Text",
  "DocumentFragment",
  "SVGElement",
  "DOMRect",
  "CustomElementRegistry",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "FocusEvent",
  "InputEvent",
  "MutationObserver",
  "ResizeObserver",
  "NodeFilter",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "matchMedia",
] as const;
const savedGlobals = new Map<string, unknown>();
for (const key of DOM_GLOBALS) {
  const value = (dom as unknown as Record<string, unknown>)[key];
  if (value === undefined) continue;
  savedGlobals.set(key, (globalThis as unknown as Record<string, unknown>)[key]);
  (globalThis as unknown as Record<string, unknown>)[key] = value;
}
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = "mlx-community/MiniCPM5-2B-mlx-4Bit";

/** 一个典型的多文件仓库：2 个权重分片 + config / tokenizer。 */
const FILES = [
  { name: "config.json", path: "config.json", size: 900, kind: "other" as const, isWeight: false },
  { name: "tokenizer.json", path: "tokenizer.json", size: 21_000_000, kind: "other" as const, isWeight: false },
  {
    name: "model-00001-of-00002.safetensors",
    path: "model-00001-of-00002.safetensors",
    size: 4_000_000_000,
    kind: "safetensors" as const,
    isWeight: true,
  },
  {
    name: "model-00002-of-00002.safetensors",
    path: "model-00002-of-00002.safetensors",
    size: 3_000_000_000,
    kind: "safetensors" as const,
    isWeight: true,
  },
];

/** 这个模型的 4 个文件：2 个下完、2 个还在下（就是出问题时的现场）。 */
const TASKS = [
  {
    id: "t1",
    repo: REPO,
    fileName: "config.json",
    source: "modelscope" as const,
    status: "completed" as const,
    received: 900,
    total: 900,
    percent: 100,
    speed: 0,
    createdAt: 3,
    size: 900,
  },
  {
    id: "t2",
    repo: REPO,
    fileName: "tokenizer.json",
    source: "modelscope" as const,
    status: "completed" as const,
    received: 21_000_000,
    total: 21_000_000,
    percent: 100,
    speed: 0,
    createdAt: 2,
    size: 21_000_000,
  },
  {
    id: "t3",
    repo: REPO,
    fileName: "model-00001-of-00002.safetensors",
    source: "modelscope" as const,
    status: "downloading" as const,
    received: 2_000_000_000,
    total: 4_000_000_000,
    percent: 50,
    speed: 12_000_000,
    createdAt: 1,
    size: 4_000_000_000,
  },
  {
    id: "t4",
    repo: REPO,
    fileName: "model-00002-of-00002.safetensors",
    source: "modelscope" as const,
    status: "queued" as const,
    received: 0,
    total: 3_000_000_000,
    percent: 0,
    speed: 0,
    createdAt: 0,
    size: 3_000_000_000,
  },
];

const startCalls: Array<{ fileName: string }> = [];
mock.module("@lib/rpc", () => ({
  // 详情页会通过 use-engine / 已装列表 等拉设置与模型，未实现的统一给 ok。
  rpcClient: new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "listModelFiles") return async () => ({ files: FILES });
        if (prop === "getSettings") return async () => ({ settings: { INFERENCE_ENGINE: "vllm" } });
        if (prop === "listInstalledModels") return async () => ({ models: [] });
        if (prop === "listDownloads") return async () => ({ tasks: [] });
        if (prop === "startModelDownload") {
          return async (args: { fileName: string }) => {
            startCalls.push({ fileName: args.fileName });
            return { ok: true };
          };
        }
        return async () => ({ ok: true });
      },
    },
  ),
}));

const { act } = await import("react");
const { createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { TooltipProvider } = await import("@components/ui/tooltip");
const { ModelDetailScreen } = await import("./index");
const { useModelDownloadStore } = await import("@stores/model-download");
const { useModelDetailStore } = await import("@stores/model-detail");

afterAll(() => {
  for (const [key, value] of savedGlobals) {
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  }
  delete (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

function textOf(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ");
}

async function renderScreen() {
  useModelDetailStore.getState().setSource({
    kind: "search",
    model: {
      id: REPO,
      name: "MiniCPM5 2B MLX 4bit",
      source: "modelscope",
      downloads: 0,
      likes: 0,
      params: 0,
      fileSize: 7_000_000_000,
      fileCount: FILES.length,
      formats: ["safetensors"],
      tags: [],
      tasks: [],
      license: "",
      description: "",
      createdAt: "",
      lastModified: "",
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TooltipProvider, null, createElement(ModelDetailScreen)),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // 格式筛选默认跟随当前引擎（vLLM → safetensors），而引擎来自 settings 查询；
  // 断言前固定选「全部格式」，让文件清单与引擎无关，测试才稳定。
  const allFormats = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "全部格式",
  );
  if (allFormats) {
    await act(async () => {
      allFormats.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return {
    container,
    close: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test("整模型一个进度：聚合到模型级，不是一个文件一条进度", async () => {
  useModelDownloadStore.getState().setTasks(TASKS as never);
  const screen = await renderScreen();
  try {
    const text = textOf(screen.container as unknown as Element);

    // 整模型口径：4 个文件里 2 个下完，字节进度 = (900 + 21e6 + 2e9) / 7.021e9 ≈ 28%
    // ——注意已完成的文件也计入分子分母，否则会显示成剩下 2 个分片的 28.5%→「0%」。
    expect(text).toContain("2/4 个文件");
    expect(text).toContain("28%");
    // 正在下的那个分片的速度出现在模型级那一行。
    expect(text).toContain("12.0 MB/s");

    // 逐文件的噪音必须消失：排队位置、逐文件百分比都不再出现。
    expect(text).not.toContain("排队中");
    expect(text).not.toContain("前面还有");

    // 文件清单本身还在（它现在是「这个模型里有什么」，不是进度表）。
    for (const f of FILES) {
      expect(text).toContain(f.name);
    }
  } finally {
    await screen.close();
  }
});

test("模型级主操作：正在下时给暂停，并带一个整体进度条", async () => {
  useModelDownloadStore.getState().setTasks(TASKS as never);
  const screen = await renderScreen();
  try {
    const container = screen.container as unknown as HTMLElement;
    const text = textOf(container as unknown as Element);
    expect(text).toContain("下载中");
    expect(text).toContain("暂停");

    // 详情页上只有**一个**进度条（模型整体），不是每个文件一条。
    const bars = container.querySelectorAll(".bg-primary.transition-\\[width\\]");
    expect(bars.length).toBe(1);
  } finally {
    await screen.close();
  }
});

test("没有任务时给一个「下载整仓库」入口，一次把整模型排进队列", async () => {
  useModelDownloadStore.getState().setTasks([]);
  startCalls.length = 0;
  const screen = await renderScreen();
  try {
    const container = screen.container as unknown as HTMLElement;
    const text = textOf(container as unknown as Element);
    // 4 个文件（2 个分片 + config + tokenizer）作为一个模型一起下。
    expect(text).toContain("下载整仓库");
    expect(text).toContain("（4 个文件）");

    const start = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("下载整仓库"),
    );
    expect(start).toBeTruthy();
    await act(async () => {
      (start as unknown as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(startCalls.map((c) => c.fileName).sort()).toEqual(
      ["config.json", "tokenizer.json", "model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors"].sort(),
    );
  } finally {
    await screen.close();
  }
});
