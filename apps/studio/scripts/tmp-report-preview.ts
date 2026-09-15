/**
 * 临时脚本：拿一份真实历史记录跑一遍导出，产出 /tmp 下的 HTML 供肉眼检查。
 * 只读数据库，不写任何仓库文件。
 */
import { Database } from "bun:sqlite";
import { homedir } from "os";
import { translate } from "../src/shared/i18n";
import { buildBenchmarkReportHtml, reportFileName } from "../src/mainview/app/benchmark/export-html";
import type { DisplayResult } from "../src/mainview/app/benchmark/parts";

const dbPath = `${homedir()}/Library/Application Support/omni-studio.kunpengtalk.com/dev/omni-studio.db`;
const db = new Database(dbPath, { readonly: true });
const rec = db.query("select id, kind, model, engine, server_mode, rows, summary, params, status, duration_ms, created_at from benchmark_records where id = 4").get() as any;

const result: DisplayResult = {
  source: "record",
  kind: rec.kind,
  model: rec.model,
  engine: rec.engine,
  serverMode: rec.server_mode,
  status: rec.status,
  rows: rec.kind === "speed" ? JSON.parse(rec.rows) : [],
  evalRows: rec.kind === "eval" ? JSON.parse(rec.rows) : undefined,
  summary: rec.summary ? JSON.parse(rec.summary) : undefined,
  params: rec.params ? JSON.parse(rec.params) : undefined,
  createdAt: rec.created_at,
  durationMs: rec.duration_ms,
};

const t = (key: string, params?: Record<string, string>) => translate("zh", key, params);
const html = buildBenchmarkReportHtml({ result, t, lang: "zh" });
await Bun.write("/tmp/omni-report-preview.html", html);
console.log("filename:", reportFileName(result));
console.log("bytes:", Buffer.byteLength(html, "utf8"));

const evalResult: DisplayResult = {
  source: "record",
  kind: "eval",
  model: "Qwen3.6-35B-A3B",
  engine: "llama.cpp",
  serverMode: "local",
  status: "done",
  rows: [],
  evalRows: [
    { category: "abstract_algebra", correct: 4, total: 10, accuracy: 40 },
    { category: "college_mathematics", correct: 9, total: 20, accuracy: 45 },
    { category: "high_school_world_history", correct: 27, total: 40, accuracy: 67.5 },
    { category: "机器学习的数学基础", correct: 13, total: 20, accuracy: 65 },
  ],
  summary: {
    avgTps: 0, peakTps: 0, avgTtftMs: 0, bestTtftMs: 0, peakAggTps: 0, peakPrefillTps: 0, totalTokens: 0,
    eval: { suite: "mmlu", accuracy: 55.5, correctCount: 111, totalQuestions: 200, datasetTotal: 14042, failures: 3 },
  },
  params: { suite: "mmlu", sampleSize: 200 },
  createdAt: Date.now() - 3_600_000,
  durationMs: 61_000,
};
await Bun.write("/tmp/omni-report-preview-eval.html", buildBenchmarkReportHtml({ result: evalResult, t, lang: "zh" }));
console.log("eval preview written");
