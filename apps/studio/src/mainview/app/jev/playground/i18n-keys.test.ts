/**
 * 演练场的 i18n 守卫：这份清单 = 演练场 UI（`index.tsx` / `grid-view.tsx` /
 * `triage-view.tsx` / `run-log.tsx` / `../sidebar.tsx`）实际用到的**全部** key，
 * 以及 `scenarios.ts` 钉住的两个场景的 name / desc。
 *
 * 三条断言：
 *   1. key 无重复，且全部以 `jev.playground.` 开头（防止有人随手用别的前缀）；
 *   2. 每个 key 在 `zh` 与 `en` 两个字典里都存在且非空（缺一个、或只翻了一半
 *      —— 界面会回退成英文 / key 原文 —— 都算红）；
 *   3. 占位符与调用处一致（代码按调用签名拼参数，多传的参数会被 `translate`
 *      忽略 —— 所以字典里漏掉一个占位符不会崩，只会把界面写成
 *      `第 {n} / 20 步` 这样的半成品，这里按每个调用处实际传的参数名钉死）。
 */
import { expect, test } from "bun:test";

import { translate } from "../../../../shared/i18n";
import { PLAYGROUND_SCENARIOS } from "./scenarios";

/** `playground/index.tsx` + `grid-view.tsx` + `triage-view.tsx` + `run-log.tsx` + `../sidebar.tsx` 用到的全部 key。 */
const PLAYGROUND_UI_KEYS = [
  // 侧栏切换
  "jev.playground.view.console",
  "jev.playground.view.playground",
  "jev.playground.scenarios",
  "jev.playground.hint",
  // 场景元数据（scenarios.ts 的 nameKey / descKey）
  ...PLAYGROUND_SCENARIOS.flatMap((scenario) => [scenario.nameKey, scenario.descKey]),
  // 未选场景空态
  "jev.playground.empty",
  "jev.playground.empty.hint",
  // 后端状态
  "jev.playground.backend.notReady",
  // 运行控制
  "jev.playground.start",
  "jev.playground.step",
  "jev.playground.reset",
  "jev.playground.progress",
  "jev.playground.done",
  // 右栏标题 / 进度
  "jev.playground.grid.steps",
  "jev.playground.triage.progress",
  "jev.playground.log.title",
  // 棋盘
  "jev.playground.grid.aria",
  "jev.playground.grid.markerHere",
  "jev.playground.grid.markerGoal",
  "jev.playground.grid.markerWall",
  "jev.playground.grid.markerStart",
  "jev.playground.grid.legendHere",
  "jev.playground.grid.legendGoal",
  "jev.playground.grid.legendWall",
  "jev.playground.grid.legendTrail",
  // 工单
  "jev.playground.triage.summary",
  "jev.playground.triage.expected",
  "jev.playground.triage.pending",
  "jev.playground.triage.urgent",
  "jev.playground.triage.urgent.true",
  "jev.playground.triage.urgent.false",
  "jev.playground.triage.confidence",
  "jev.playground.triage.correct",
  "jev.playground.triage.wrong",
  "jev.playground.triage.queue.billing",
  "jev.playground.triage.queue.technical",
  "jev.playground.triage.queue.account",
  "jev.playground.triage.queue.abuse",
  // 运行日志
  "jev.playground.log.empty",
  "jev.playground.log.step",
  "jev.playground.log.confidence",
];

/**
 * key → 各调用处实际传入的占位符名（取自代码里 `t(key, { … })` 的参数名）。
 * 只列有插值的 key；没有的传 `{}` 即可（断言里跳过）。
 */
const PLACEHOLDERS: Record<string, string[][]> = {
  "jev.playground.progress": [["n", "total"]],
  "jev.playground.grid.steps": [["n", "max"]],
  "jev.playground.triage.progress": [["done", "total"]],
  "jev.playground.triage.summary": [["accuracy", "confidence", "total", "correct"]],
  "jev.playground.triage.expected": [["queue"]],
  "jev.playground.log.step": [["n"]],
  "jev.playground.log.confidence": [["value"]],
};

const SAMPLE_VALUES: Record<string, string> = {
  n: "3",
  total: "8",
  max: "20",
  done: "5",
  accuracy: "75%",
  confidence: "80%",
  correct: "6",
  queue: "billing",
  value: "0.902",
};

test("演练场用到的 i18n key 无重复，且全部以 jev.playground. 开头", () => {
  expect(new Set(PLAYGROUND_UI_KEYS).size).toBe(PLAYGROUND_UI_KEYS.length);
  for (const key of PLAYGROUND_UI_KEYS) {
    expect(key.startsWith("jev.playground."), `key 前缀不对: ${key}`).toBe(true);
  }
});

test("演练场用到的 i18n key 在 zh 与 en 两个字典里都存在且非空", () => {
  const missing: string[] = [];
  for (const key of PLAYGROUND_UI_KEYS) {
    for (const lang of ["zh", "en"] as const) {
      // `translate` 缺词条时回退成 key 本身（回退链 zh → en → key）；
      // 这里对两种情况（回退、空串）一起判，任何一处缺文案都会列出来。
      const text = translate(lang, key);
      if (!text || text === key) missing.push(`${lang}:${key}`);
    }
  }
  expect(missing).toEqual([]);
});

test("演练场词条的插值占位符与调用处一致（翻译后不残留 {…}）", () => {
  const bad: string[] = [];
  for (const [key, paramSets] of Object.entries(PLACEHOLDERS)) {
    for (const params of paramSets) {
      for (const lang of ["zh", "en"] as const) {
        const values = Object.fromEntries(params.map((name) => [name, SAMPLE_VALUES[name] ?? "x"]));
        const text = translate(lang, key, values);
        for (const name of params) {
          if (!text.includes(values[name]!)) bad.push(`${lang}:${key} 缺占位符 {${name}} → "${text}"`);
        }
      }
    }
  }
  expect(bad).toEqual([]);
});
