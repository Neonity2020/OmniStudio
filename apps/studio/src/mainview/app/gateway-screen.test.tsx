import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * 网关页「API Key」小节的回归测试。
 *
 * 锁住当时提的两条明确要求：
 *   1. 密钥默认**掩码**展示 —— 列表里不能出现明文；
 *   2. 新建要先填名字，并且新建 / 停用 / 删除都写回主进程（不经过「保存并重启」）。
 *
 * happy-dom 提供真实 DOM（Radix 的 Dialog 需要），afterAll 还原全局。
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

const PLAIN_KEY = "osk-abcdefghijklmnopqrstuvwx";
const keys = [
  { id: "k1", name: "笔记本", key: PLAIN_KEY, enabled: true, createdAt: 1_700_000_000_000 },
  { id: "k2", name: "CI", key: "osk-zzzzzzzzzzzzzzzzzzzzzzzz", enabled: false, createdAt: 1_700_000_100_000 },
];
const createCalls: { name: string }[] = [];
const toggleCalls: { id: string; enabled: boolean }[] = [];
const deleteCalls: string[] = [];

mock.module("@lib/rpc", () => ({
  rpcClient: {
    getGatewayStatus: async () => ({
      enabled: true,
      status: "running" as const,
      host: "127.0.0.1",
      port: 10000,
      configuredPort: 10000,
      url: "http://127.0.0.1:10000",
      upstreamStatus: { status: "stopped" as const },
    }),
    getSettings: async () => ({ settings: { GATEWAY_ENABLED: "1", GATEWAY_PORT: "10000" } }),
    listGatewayKeys: async () => ({ keys }),
    createGatewayKey: async (params: { name: string }) => {
      createCalls.push(params);
      return { ok: true, key: { id: "k3", ...params, key: PLAIN_KEY, enabled: true, createdAt: Date.now() } };
    },
    setGatewayKeyEnabled: async (params: { id: string; enabled: boolean }) => {
      toggleCalls.push(params);
      return { ok: true };
    },
    deleteGatewayKey: async (params: { id: string }) => {
      deleteCalls.push(params.id);
      return { ok: true };
    },
    openGatewayDocs: async () => ({ ok: true }),
    updateSettings: async () => ({ ok: true }),
    restartGateway: async () => ({ ok: true }),
    startGateway: async () => ({ ok: true }),
    stopGateway: async () => ({ ok: true }),
  },
}));

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { TooltipProvider } = await import("@ui/tooltip");
const { GatewayScreen } = await import("./gateway-screen");
const { translate } = await import("../../shared/i18n");

const zh = (key: string, params?: Record<string, string>) => translate("zh", key, params);

afterAll(() => {
  for (const [key, value] of savedGlobals) {
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  }
  delete (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

async function renderGateway() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TooltipProvider, null, createElement(GatewayScreen)),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    text: container.textContent ?? "",
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** 按文案找按钮（happy-dom 里没有 testing-library，手写一份等价的）。 */
function buttonByText(root: ParentNode, label: string): HTMLElement | undefined {
  return [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as
    | HTMLElement
    | undefined;
}

/** 图标按钮没有文字标签，按 aria-label / title 找。 */
function iconButton(root: ParentNode, label: string): HTMLElement | undefined {
  return [...root.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.getAttribute("title") === label,
  ) as HTMLElement | undefined;
}

/** Radix 弹窗挂在 document.body 的 portal 上，不在渲染容器里（关掉的那个不算）。 */
function dialogButton(label: string): HTMLElement | undefined {
  const dialog = document.querySelector('[role="dialog"]:not([data-state="closed"])');
  return dialog ? buttonByText(dialog, label) : undefined;
}

/**
 * 往受控输入框里打字。React 在元素实例上覆写了 value 的 setter 用于变更追踪，
 * 直接赋值再派发 input 事件会被它判成"没变"、不触发 onChange —— 必须走原型上的
 * 原生 setter（testing-library 内部也是这么做的）。
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input) as object,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("密钥默认掩码展示：列表里没有明文，点「显示」才出现", async () => {
  const { container, text, cleanup } = await renderGateway();

  expect(text).toContain("笔记本");
  expect(text).toContain("osk-************");
  expect(text).not.toContain(PLAIN_KEY);

  const reveal = iconButton(container, zh("settings.gateway.keys.reveal"));
  expect(reveal).toBeDefined();
  await act(async () => {
    reveal!.click();
  });
  await settle();
  expect(container.textContent ?? "").toContain(PLAIN_KEY);
  // 只有被点开的那一把明文可见，其它行照旧掩码。
  expect(container.textContent ?? "").toContain("osk-************");

  await cleanup();
});

test("新建密钥：不填名字不能保存，填了才把名字交给主进程", async () => {
  const { container, cleanup } = await renderGateway();

  const newButton = buttonByText(container, zh("settings.gateway.keys.new"));
  expect(newButton).toBeDefined();
  await act(async () => {
    newButton!.click();
  });
  await settle();

  const saveButton = dialogButton(zh("settings.gateway.keys.save"));
  expect(saveButton).toBeDefined();
  expect(saveButton!.hasAttribute("disabled")).toBe(true);

  const nameInput = document.querySelector<HTMLInputElement>("#gateway-key-name");
  expect(nameInput).not.toBeNull();
  await act(async () => {
    typeInto(nameInput!, "CI runner");
  });
  await settle();

  const enabledSave = dialogButton(zh("settings.gateway.keys.save"));
  expect(enabledSave!.hasAttribute("disabled")).toBe(false);
  await act(async () => {
    enabledSave!.click();
  });
  await settle();
  expect(createCalls).toEqual([{ name: "CI runner" }]);

  await cleanup();
});

test("停用 / 删除直达主进程（停用最后一把要确认）", async () => {
  const { container, cleanup } = await renderGateway();

  // 已停用的那一把只提供「启用」，点了立即写回。
  const enable = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === zh("settings.gateway.keys.enable"),
  );
  expect(enable).toBeDefined();
  await act(async () => {
    enable!.click();
  });
  await settle();
  expect(toggleCalls).toEqual([{ id: "k2", enabled: true }]);

  // 唯一的启用 Key 点「停用」先弹确认，确认后才落库。
  const disable = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === zh("settings.gateway.keys.disable"),
  );
  expect(disable).toBeDefined();
  await act(async () => {
    disable!.click();
  });
  await settle();
  expect(document.body.textContent ?? "").toContain(
    zh("settings.gateway.keys.disableLastTitle"),
  );
  expect(toggleCalls).toHaveLength(1);

  const confirmDisable = dialogButton(zh("settings.gateway.keys.disable"));
  expect(confirmDisable).toBeDefined();
  await act(async () => {
    confirmDisable!.click();
  });
  await settle();
  expect(toggleCalls).toHaveLength(2);

  const del = iconButton(container, zh("settings.gateway.keys.delete"));
  expect(del).toBeDefined();
  await act(async () => {
    del!.click();
  });
  await settle();
  expect(document.body.textContent ?? "").toContain(zh("settings.gateway.keys.deleteTitle"));

  const deleteConfirm = dialogButton(zh("settings.gateway.keys.delete"));
  expect(deleteConfirm).toBeDefined();
  await act(async () => {
    deleteConfirm!.click();
  });
  await settle();
  expect(deleteCalls).toEqual(["k1"]);

  await cleanup();
});
