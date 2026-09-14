import { beforeEach, expect, test } from "bun:test";

import { useAgentStore } from "./agent";

/**
 * 运行态（`running`）的权威来源是后端：只有它知道"刷新窗口之后还在不在跑"、
 * "自动化在后台起的这一轮算不算数"。这里钉住它不被两件事带偏：
 *   1. 别的会话的推送 —— 后台会话跑完不该让当前这一屏停止转圈；
 *   2. 刚点发送的那一瞬间 —— 请求还在路上、后端尚未登记，此时把状态清掉
 *      会让秒数和停止按钮闪一下就没（看着像"自己停了"）。
 */

const store = () => useAgentStore.getState();

beforeEach(() => {
  store().clear();
  store().setConversationId(1);
});

test("后端说在跑：点亮运行态", () => {
  store().setRunningFor(1, true);
  expect(store().running).toBe(true);
});

test("后端说没在跑：解除运行态", () => {
  store().setRunningFor(1, true);
  useAgentStore.setState({ runningSince: Date.now() - 60_000 });
  store().setRunningFor(1, false);
  expect(store().running).toBe(false);
});

test("别的会话的运行态不改变当前这一屏", () => {
  store().setRunningFor(2, true);
  expect(store().running).toBe(false);

  store().setRunningFor(1, true);
  store().setRunningFor(2, false);
  expect(store().running).toBe(true);
});

test("刚发出的一轮：后端还没登记时不清运行态", () => {
  store().setRunning(true); // 点发送
  store().setRunningFor(1, false); // 请求还在路上，后端此刻还是"没在跑"
  expect(store().running).toBe(true);
});

test("后端确认过在跑之后，收尾立刻生效（短回合在宽限窗口内跑完也不会留着转圈）", () => {
  store().setRunning(true);
  store().setRunningFor(1, true); // 后端登记了：这一轮确实在跑
  store().setRunningFor(1, false); // 两秒后跑完，推送到达 —— 此刻仍在宽限窗口内
  expect(store().running).toBe(false);
});

test("宽限过后：后端说停了就停（漏掉一条推送也能自己纠正）", () => {
  store().setRunning(true);
  // 把"刚发出"的时刻往前拨，等价于等过了宽限窗口。
  useAgentStore.setState({ runningSince: Date.now() - 60_000 });
  store().setRunningFor(1, false);
  expect(store().running).toBe(false);
});

test("本地收尾（停止 / chatDone）立刻生效，不等宽限", () => {
  store().setRunning(true);
  store().setRunning(false);
  expect(store().running).toBe(false);
  expect(store().runningSince).toBeNull();
});

test("切会话：运行态跟着清（上一个会话在跑 ≠ 这个会话在跑）", () => {
  store().setRunningFor(1, true);
  store().setConversationId(2);
  expect(store().running).toBe(false);
  // 迟到的推送属于上一个会话：不能把新会话点亮。
  store().setRunningFor(1, true);
  expect(store().running).toBe(false);
});
