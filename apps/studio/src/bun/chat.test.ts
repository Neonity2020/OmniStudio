import { afterAll, expect, mock, test } from "bun:test";

/** 索引访问的辅助函数（tsconfig 开启了 noUncheckedIndexedAccess）。 */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} missing`);
  return v;
}
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "path";
import * as fs from "fs";

const tmpDb = `/tmp/chat-test-${process.pid}.db`;
fs.rmSync(tmpDb, { force: true });
const sqlite = new Database(tmpDb, { create: true });
const db = drizzle({ client: sqlite });
migrate(db, { migrationsFolder: join(import.meta.dir, "db/migrations") });

mock.module("./db", () => ({ db }));
mock.module("./db/settings", () => {
  const getSetting = (key: string) =>
    key === "SERVER_MODE"
      ? "remote"
      : key === "VLLM_API_BASE"
        ? "http://fake:8000"
        : key === "CHAT_MODEL"
          ? "test-model"
          : "";
  return {
    getSetting,
    // knowledge.ts → vllm/vllm.ts 会读重试次数等数值设置。
    getNumericSetting: (key: string) => Number(getSetting(key)),
    updateSettings: () => {},
    getAllSettings: () => ({}),
    getActiveServerPort: () => "18080",
    // 已启动模型注册表（chat.ts → model-servers.ts）会经 runtimes/* 读这两个：
    // 部分 mock 少了它们会让整个模块图命名导入失败（"Export named ... not found"）。
    getServerPort: () => "18080",
    ENGINE_EXTRA_ARGS_KEYS: { "llama.cpp": "", vllm: "", sglang: "", mlx: "" },
  };
});
const realChatModel = await import("./chat-model");
mock.module("./chat-model", () => ({ ...realChatModel, getChatModelName: () => "test-model" }));
// 不 mock ./image-server：bun 的 mock.module 会跨文件泄漏、且 mock.restore() 撤不掉，
// 别的文件（image-server.route.test）拿到被换掉的模块就只能无声跳过——media 403 正是
// 从"本地从没跑到"的路由漏出去的。本文件只用到目录工具函数，真实实现（数据目录已由
// test-preload 隔离）本来就是安全的，起服务也是显式调用才会发生。
mock.module("./stats", () => ({ recordUsage: () => {}, markServerStarted: () => {} }));
mock.module("./server-manager", () => ({
  getStatus: () => "running",
  getLastError: () => null,
  startServer: async () => ({ ok: true }),
}));

// 一段两条 token 的流式 SSE 响应，末尾带 usage。
const sseChunks = [
  `data: ${JSON.stringify({ choices: [{ delta: { content: "你好" } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: "世界" } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 4 } })}\n\n`,
  `data: [DONE]\n\n`,
];
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = mock(async (_url: unknown, init: unknown) => {
  fetchCalls++;
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < sseChunks.length) controller.enqueue(enc.encode(sseChunks[i++]));
      else controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}) as never;

const { createConversation, sendMessage, deleteMessage, regenerateMessage, translateMessage, getConversation, onChatChunk, onChatDone, onChatStats } = await import("./chat");

afterAll(() => {
  // 恢复全局 fetch，避免把 mock 泄漏给同一批次运行的其他测试文件。
  globalThis.fetch = originalFetch;
  fs.rmSync(tmpDb, { force: true });
});

test("sendMessage streams, persists content+tokens and emits stats", async () => {
  const conv = createConversation(undefined, "chat");
  const events: string[] = [];
  const deltas: string[] = [];
  // 增量按 ~40ms 批量下发（减少 IPC 与前端重渲染），事件条数不再等于 token 数：
  // 这里断言真正的不变量 —— 内容一字不丢、done 最后收尾。
  const offChunk = onChatChunk((payload) => {
    events.push("chunk");
    if (payload.kind !== "reasoning") deltas.push(payload.delta);
  });
  const offDone = onChatDone(() => events.push("done"));
  const stats: number[] = [];
  const offStats = onChatStats((s) => stats.push(s.tokens));

  const res = await sendMessage(conv.id, "hello");
  expect(res.ok).toBe(true);
  expect(deltas.join("")).toBe("你好世界");
  expect(events.length).toBeGreaterThan(0);
  expect(events[events.length - 1]).toBe("done");
  expect(stats).toEqual([4]);

  const { messages } = getConversation(conv.id);
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(at(messages, 1).content).toBe("你好世界");
  expect(at(messages, 1).tokens).toBe(4);

  offChunk();
  offDone();
  offStats();
});

test("deleteMessage removes the row", async () => {
  const conv = createConversation(undefined, "chat");
  const res = await sendMessage(conv.id, "to be deleted");
  expect(res.ok).toBe(true);
  const { messages } = getConversation(conv.id);
  const assistantId = at(messages, 1).id;
  expect(deleteMessage(conv.id, assistantId).ok).toBe(true);
  expect(getConversation(conv.id).messages.map((m) => m.id)).toEqual([at(messages, 0).id]);
});

test("regenerateMessage rewinds and produces a new answer", async () => {
  const conv = createConversation(undefined, "chat");
  await sendMessage(conv.id, "q1");
  let { messages } = getConversation(conv.id);
  const firstAssistantId = at(messages, 1).id;
  const callsBefore = fetchCalls;

  const res = await regenerateMessage(conv.id, firstAssistantId);
  expect(res.ok).toBe(true);
  expect(fetchCalls).toBe(callsBefore + 1);

  messages = getConversation(conv.id).messages;
  // 回退后只有 user；旧的 assistant 被删除，新的 assistant 以新 id 追加。
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  const regenerated = at(messages, 1);
  expect(regenerated.id).not.toBe(firstAssistantId);
  expect(regenerated.content).toBe("你好世界");
});

test("translateMessage appends a streamed translation", async () => {
  const conv = createConversation(undefined, "chat");
  await sendMessage(conv.id, "hello in en");
  let { messages } = getConversation(conv.id);
  const assistantId = at(messages, 1).id;
  const countBefore = messages.length;

  const res = await translateMessage(conv.id, assistantId, "zh-CN");
  expect(res.ok).toBe(true);

  messages = getConversation(conv.id).messages;
  expect(messages.length).toBe(countBefore + 1);
  const translated = at(messages, messages.length - 1);
  expect(translated.role).toBe("assistant");
  expect(translated.content).toBe("你好世界");
});
