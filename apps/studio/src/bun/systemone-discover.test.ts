/**
 * 自动发现的后端测试。
 *
 * 盯住的是真实世界里最容易踩空的那一种配置：判定服务**不在根路径上**。网关
 * （LiteLLM 这类）把 `/v1/models` 留给自己代理的聊天模型，判定服务转发在
 * `/jev/<名字>` 下面 —— 只看根路径的人会得出"这台机器没有 JEV"的错误结论。
 *
 * 另一半是探测手法本身：空请求体换回 422 才算"这个地址认判定协议"，而且这一下
 * 不产生任何判定。把它写死在测试里，免得以后有人图省事改成发一条真请求。
 */
import { afterEach, expect, test } from "bun:test";

import { discoverSystemOne } from "./systemone";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Route = { status: number; body: unknown };

/** 按 `方法 URL` 摆一张路由表，没列到的一律 404（跟真服务一致）。 */
function stubFetch(routes: Record<string, Route>): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url}`;
    calls.push(key);
    const route = routes[key] ?? { status: 404, body: { detail: "Not Found" } };
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

const CHAT_ONLY = {
  object: "list",
  data: [
    { id: "deepseek-v4-flash", object: "model", owned_by: "openai", max_input_tokens: 1_000_000 },
    { id: "qwen3.8-27b", object: "model", owned_by: "openai", max_input_tokens: 262_144 },
  ],
};

const VALIDATION_422 = { detail: [{ type: "missing", loc: ["body", "state"], msg: "Field required" }] };

test("判定端点在子路径上：根路径说没有，候选里把它找出来", async () => {
  const { calls } = stubFetch({
    "GET http://gw.test/v1/models": { status: 200, body: CHAT_ONLY },
    "POST http://gw.test/v1/systemone": { status: 404, body: { detail: "Not Found" } },
    "GET http://gw.test/openapi.json": {
      status: 200,
      body: { paths: { "/v1/models": {}, "/jev/laya": {}, "/jev/laya/{subpath}": {} } },
    },
    "POST http://gw.test/jev/laya/v1/systemone": { status: 422, body: VALIDATION_422 },
    "GET http://gw.test/jev/laya/v1/models": {
      status: 200,
      body: { models: [{ name: "jev-latest", description: "Jev", release_date: "2026-09-15" }] },
    },
  });

  const found = await discoverSystemOne({ baseUrl: "http://gw.test/v1/", apiKey: "sk-test" });

  // 地址归一化：用户粘的 `/v1/` 结尾被去掉，拼接由我们自己做。
  expect(found.base).toBe("http://gw.test");
  expect(found.systemone).toBe("no");
  // 根路径上读到的是聊天模型，它们不该被说成判定模型。
  expect(found.models.jev).toHaveLength(0);
  expect(found.models.others.map((m) => m.name)).toEqual(["deepseek-v4-flash", "qwen3.8-27b"]);
  // 真正能判定的那条被找了出来，连同它自己的模型清单。
  expect(found.candidates).toHaveLength(1);
  expect(found.candidates[0]?.base).toBe("http://gw.test/jev/laya");
  expect(found.candidates[0]?.systemone).toBe("yes");
  expect(found.candidates[0]?.models.map((m) => m.name)).toEqual(["jev-latest"]);
  // 探测用的是空请求体，不是一条真判定请求。
  expect(calls).toContain("POST http://gw.test/jev/laya/v1/systemone");
});

test("根路径就是判定服务：直接说可用，不再去翻 openapi", async () => {
  const { calls } = stubFetch({
    "GET http://jev.test/v1/models": {
      status: 200,
      body: { models: [{ name: "jev-1.13.0", description: "flagship", release_date: "2026-09-15" }] },
    },
    "POST http://jev.test/v1/systemone": { status: 422, body: VALIDATION_422 },
  });

  const found = await discoverSystemOne({ baseUrl: "http://jev.test", apiKey: "sk-test" });

  expect(found.systemone).toBe("yes");
  expect(found.models.jev.map((m) => m.name)).toEqual(["jev-1.13.0"]);
  expect(found.candidates).toHaveLength(0);
  expect(calls).not.toContain("GET http://jev.test/openapi.json");
});

test("路由在但 Key 没放行：说成「权限」而不是「地址错了」", async () => {
  // 实测过的坑：网关对没授权的 pass-through 路由回 403，地址其实是对的。
  stubFetch({
    "GET http://gw.test/v1/models": { status: 403, body: { error: { message: "not allowed" } } },
    "POST http://gw.test/v1/systemone": { status: 403, body: { error: { message: "not allowed" } } },
    "GET http://gw.test/openapi.json": { status: 200, body: { paths: {} } },
  });

  const found = await discoverSystemOne({ baseUrl: "http://gw.test", apiKey: "sk-nope" });

  expect(found.systemone).toBe("forbidden");
  expect(found.message).toBe("HTTP 403");
});
