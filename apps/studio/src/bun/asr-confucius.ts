/**
 * Confucius4-R2T2 本地 ASR 引擎（llama.cpp 专用实例）。
 *
 * 网易有道 Confucius4-R2T2 是 Qwen3-ASR-1.7B 微调的流式语音识别模型，
 * Mac 本地跑 GGUF：主模型 + 音频编码器（按 llama.cpp 的 mmproj 惯例发布）。
 * 这里用一个**专用** llama-server 实例（与聊天/嵌入的推理服务互不干扰）：
 *
 *   llama-server -m <main.gguf> --mmproj <mmproj.gguf> \
 *     --host 127.0.0.1 --port <ASR_CONFUCIUS_PORT> --ctx-size 8192 --parallel 1
 *
 * 转写走 llama.cpp 原生支持 `/v1/chat/completions` 的 `input_audio` 内容块
 * （miniaudio 解码 wav/flac/mp3），与 OpenAI 官方 SDK 的音频消息同构。
 * 引擎本体是 app 已托管的 llama.cpp（设置 → 模型引擎），本模块只负责
 * 模型文件、实例生命周期与转写，不新增引擎。
 */
import { existsSync, readFileSync, readdirSync, rmSync } from "fs";
import path from "path";

import {
  ASR_CONFUCIUS_PORT_KEY,
  CONFUCIUS_ASR_CATALOG,
  CONFUCIUS_ASR_REPO,
  CONFUCIUS_ENGINE_ID,
  DEFAULT_ASR_CONFUCIUS_PORT,
  confuciusModelEntry,
  type ConfuciusAsrModel,
} from "../shared/asr-confucius";
import { logEvent } from "./app-log";
import { getSetting, updateSettings } from "./db/settings";
import { llamaCppBinaryPath, engineVersionFilePath } from "./engine-paths";
import { installedModelSize, isModelInstalled, localModelPath } from "./modelscope";
import { toWav } from "./tts-local";

export type AsrConfuciusModelInfo = ConfuciusAsrModel & {
  /** 主模型 + mmproj 都已下载才算齐。 */
  downloaded: boolean;
  mainInstalled: boolean;
  mmprojInstalled: boolean;
  totalInstalledSize: number | null;
  installedMainPath: string | null;
  active: boolean;
};

export type AsrConfuciusStatus = {
  /** 能否解析 llama-server（托管目录 → 系统 PATH）。 */
  engineInstalled: boolean;
  binaryPath: string | null;
  /** 托管安装的 llama.cpp 构建号（VERSION 标记），PATH 版为 null。 */
  llamaVersion: string | null;
  serverRunning: boolean;
  /** 引擎当前是否启用（ASR_ENGINE === "confucius"）。 */
  active: boolean;
  activeModelId: string | null;
  port: number;
};

// ---------------------------------------------------------------------------
// 实例生命周期（模块级状态，与 whisper-server 在 asr.ts 里的模式一致）
// ---------------------------------------------------------------------------

let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let serverStatus: "stopped" | "starting" | "running" | "error" = "stopped";
let serverError = "";

async function resolveServerBin(): Promise<string | null> {
  const managed = llamaCppBinaryPath();
  if (existsSync(managed)) return managed;
  return Bun.which("llama-server") ?? null;
}

function confuciusPort(): number {
  return Number(getSetting(ASR_CONFUCIUS_PORT_KEY) || DEFAULT_ASR_CONFUCIUS_PORT);
}

/** 专用 llama-server 的启动参数（纯函数，便于测试）。 */
export function buildConfuciusServerArgs(input: {
  bin: string;
  mainPath: string;
  mmprojPath: string;
  port: number;
}): string[] {
  return [
    input.bin,
    "-m", input.mainPath,
    "--mmproj", input.mmprojPath,
    "--host", "127.0.0.1",
    "--port", String(input.port),
    "--ctx-size", "8192",
    "--parallel", "1",
  ];
}

/** 转写请求体（llama.cpp 原生 input_audio 内容块，纯函数便于测试）。 */
export function buildConfuciusRequestBody(wavBase64: string): {
  model: string;
  messages: { role: string; content: { type: string; input_audio: { data: string } }[] }[];
  max_tokens: number;
  temperature: number;
} {
  return {
    model: "confucius4-r2t2",
    messages: [
      {
        role: "user",
        content: [{ type: "input_audio", input_audio: { data: wavBase64 } }],
      },
    ],
    max_tokens: 1024,
    temperature: 0,
  };
}

// ---------------------------------------------------------------------------
// 模型清单与状态
// ---------------------------------------------------------------------------

export function listAsrConfuciusModels(): AsrConfuciusModelInfo[] {
  const activeEngine = getSetting("ASR_ENGINE") === CONFUCIUS_ENGINE_ID;
  const activeModel = getSetting("ASR_CONFUCIUS_MODEL");
  return CONFUCIUS_ASR_CATALOG.map((m) => {
    const mainPath = localModelPath(CONFUCIUS_ASR_REPO, m.mainFile);
    const mainInstalled = isModelInstalled(CONFUCIUS_ASR_REPO, m.mainFile);
    const mmprojInstalled = isModelInstalled(CONFUCIUS_ASR_REPO, m.mmprojFile);
    const downloaded = mainInstalled && mmprojInstalled;
    const mainSize = mainInstalled ? (installedModelSize(CONFUCIUS_ASR_REPO, m.mainFile) ?? 0) : 0;
    const mmprojSize = mmprojInstalled ? (installedModelSize(CONFUCIUS_ASR_REPO, m.mmprojFile) ?? 0) : 0;
    return {
      ...m,
      mainInstalled,
      mmprojInstalled,
      downloaded,
      totalInstalledSize: downloaded ? mainSize + mmprojSize : null,
      installedMainPath: downloaded ? mainPath : null,
      active: activeEngine && downloaded && activeModel === m.id,
    };
  });
}

export async function getAsrConfuciusStatus(): Promise<AsrConfuciusStatus> {
  const bin = await resolveServerBin();
  const versionFile = engineVersionFilePath("llama.cpp");
  return {
    engineInstalled: !!bin,
    binaryPath: bin,
    llamaVersion: existsSync(versionFile) ? readFileText(versionFile) : null,
    serverRunning: serverStatus === "running",
    active: getSetting("ASR_ENGINE") === CONFUCIUS_ENGINE_ID,
    activeModelId: serverStatus === "running" ? getSetting("ASR_CONFUCIUS_MODEL") || null : null,
    port: confuciusPort(),
  };
}

function readFileText(p: string): string {
  try {
    return readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// 实例生命周期
// ---------------------------------------------------------------------------

function modelPaths(
  modelId: string,
): { entry: ConfuciusAsrModel; mainPath: string; mmprojPath: string } | { error: string } {
  const entry = confuciusModelEntry(modelId);
  if (!entry) return { error: "未知模型" };
  const mainPath = localModelPath(CONFUCIUS_ASR_REPO, entry.mainFile);
  const mmprojPath = localModelPath(CONFUCIUS_ASR_REPO, entry.mmprojFile);
  if (!existsSync(mainPath)) {
    return { error: `主模型未下载：${entry.mainFile}（需与音频编码器一起下载，合计约 ${(entry.totalSizeBytes / 1e9).toFixed(1)} GB）` };
  }
  if (!existsSync(mmprojPath)) {
    return { error: `音频编码器未下载：${entry.mmprojFile}，请点击下载` };
  }
  return { entry, mainPath, mmprojPath };
}

/**
 * 启用 Confucius4-R2T2 引擎并启动专用 llama-server。
 * 与 whisper / audio.cpp 互斥（同一时刻只运行一个本地 ASR 引擎），
 * 由 RPC 层先停掉另一边；这里只负责本引擎。
 */
export async function startAsrConfucius(
  modelId: string,
): Promise<{ ok: boolean; error?: string }> {
  const resolved = modelPaths(modelId);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { mainPath, mmprojPath } = resolved;

  const bin = await resolveServerBin();
  if (!bin) {
    return { ok: false, error: "未找到 llama-server，请先在 设置 → 模型引擎 安装 llama.cpp" };
  }

  await stopAsrConfuciusServer();

  const port = confuciusPort();
  serverStatus = "starting";
  serverError = "";

  const proc = Bun.spawn(
    buildConfuciusServerArgs({ bin, mainPath, mmprojPath, port }),
    { stdout: "pipe", stderr: "pipe" },
  );
  serverProc = proc;

  const errChunks: Uint8Array[] = [];
  if (proc.stderr && typeof proc.stderr !== "number") {
    void (async () => {
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        errChunks.push(value);
      }
    })();
  }
  proc.exited
    .then((code) => {
      if (serverProc === proc) serverProc = null;
      if (serverStatus === "running" && code !== 0) {
        serverStatus = "error";
        serverError = Buffer.concat(errChunks).toString("utf8").slice(-500);
      } else {
        serverStatus = "stopped";
      }
    })
    .catch(() => {
      if (serverProc === proc) serverProc = null;
      serverStatus = "stopped";
    });

  const health = `http://127.0.0.1:${port}/health`;
  for (let i = 0; i < 120; i++) {
    await Bun.sleep(500);
    const snap = serverStatus as "stopped" | "starting" | "running" | "error";
    if (snap === "error" || (snap === "stopped" && !serverProc)) break;
    try {
      const r = await fetch(health, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        serverStatus = "running";
        updateSettings({ ASR_ENGINE: CONFUCIUS_ENGINE_ID, ASR_CONFUCIUS_MODEL: modelId });
        logEvent({
          source: "asr",
          event: "asr.confucius_started",
          message: `Confucius4-R2T2 引擎已启动（${resolved.entry.quant}，端口 ${port}）`,
          detail: { modelId, port },
        });
        return { ok: true };
      }
    } catch {
      // not ready yet
    }
  }

  if (serverStatus !== "running") {
    serverStatus = "error";
    const error = serverError || "llama-server 启动超时，请检查模型文件是否完整";
    logEvent({
      source: "asr",
      event: "asr.confucius_start_failed",
      message: `Confucius4-R2T2 引擎启动失败：${error}`,
      detail: { modelId, port },
    });
    return { ok: false, error };
  }
  return { ok: true };
}

/** 停掉专用 llama-server（不改 ASR_ENGINE 设置，由调用方决定语义）。 */
export async function stopAsrConfuciusServer(): Promise<void> {
  const proc = serverProc;
  serverProc = null;
  serverStatus = "stopped";
  if (!proc) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // already dead
  }
  await Promise.race([
    proc.exited.then(() => true).catch(() => true),
    Bun.sleep(3000).then(() => false),
  ]);
  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}

/** 停掉引擎并回到 whisper 兜底（与 stopAsrAudioCpp 的语义一致）。 */
export async function stopAsrConfucius(): Promise<void> {
  await stopAsrConfuciusServer();
  updateSettings({ ASR_ENGINE: "whisper", ASR_CONFUCIUS_MODEL: "" });
  logEvent({ source: "asr", event: "asr.confucius_stopped", message: "Confucius4-R2T2 引擎已停止" });
}

/** 删除模型文件（先停服务器；只删 models/ 下的权重，从不碰 llama.cpp 引擎）。 */
export async function deleteAsrConfuciusModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
  const entry = confuciusModelEntry(modelId);
  if (!entry) return { ok: false, error: "未知模型" };

  if (getSetting("ASR_CONFUCIUS_MODEL") === modelId) {
    await stopAsrConfuciusServer();
  }

  const files = [entry.mainFile, entry.mmprojFile];
  const dir = path.dirname(localModelPath(CONFUCIUS_ASR_REPO, entry.mainFile));
  for (const f of files) {
    try {
      rmSync(localModelPath(CONFUCIUS_ASR_REPO, f), { force: true });
    } catch {
      // ignore
    }
  }
  // 清理空的父目录链。
  let d = dir;
  while (d && d !== path.dirname(d)) {
    try {
      const rest = readdirSync(d);
      if (rest.length > 0) break;
      rmSync(d, { force: true });
      d = path.dirname(d);
    } catch {
      break;
    }
  }
  if (getSetting("ASR_CONFUCIUS_MODEL") === modelId) {
    updateSettings({ ASR_CONFUCIUS_MODEL: "" });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 转写
// ---------------------------------------------------------------------------

/** 若是 16k 单声道 16bit PCM WAV 直接返回原路径，否则转成 16k WAV。 */
async function ensure16kWav(src: string): Promise<string> {
  if (path.extname(src).toLowerCase() === ".wav") {
    try {
      const buf = await Bun.file(src).slice(0, 44).arrayBuffer();
      const dv = new DataView(buf);
      if (
        dv.getUint32(0, true) === 0x46464952 &&
        dv.getUint32(8, true) === 0x45564157 &&
        dv.getUint16(20, true) === 1 &&
        dv.getUint16(22, true) === 1 &&
        dv.getUint32(24, true) === 16000 &&
        dv.getUint16(34, true) === 16
      ) {
        return src;
      }
    } catch {
      // fall through to conversion
    }
  }
  return toWav(src, 16000);
}

/**
 * 清洗模型输出。实测 Confucius4-R2T2 的输出形如
 * `language Chinese<asr_text>你好，欢迎…`（英文是 `language English<asr_text>…`，
 * 静音是 `language None<asr_text>` 加空文本）：`<asr_text>` 之前是语言声明，
 * 整段切掉；其余特殊 token（`<|startofthink|>` 等）一并剥掉。空文本视为静音。
 */
export function cleanTranscriptText(text: string): string {
  let s = text;
  const marker = s.indexOf("<asr_text>");
  if (marker >= 0) s = s.slice(marker + "<asr_text>".length);
  s = s.replace(/<\|[^|>]+\|>/g, "").replace(/<[^>]+>/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/** 用 Confucius4-R2T2 本地引擎转写（输入先转成 16k 单声道 WAV）。 */
export async function transcribeWithConfucius(input: {
  audioPath: string;
  language?: string;
}): Promise<{ text: string; engine: string; modelLabel: string }> {
  const modelId = getSetting("ASR_CONFUCIUS_MODEL");
  const resolved = modelPaths(modelId);
  if ("error" in resolved) throw new Error(resolved.error);
  if (getSetting("ASR_ENGINE") !== CONFUCIUS_ENGINE_ID) {
    throw new Error("Confucius4-R2T2 引擎未启用，请先在 ASR 页切换到该引擎");
  }

  // 服务未起时自动拉起（与 whisper 的「转写前确保 server 在跑」一致）。
  if (serverStatus !== "running") {
    const r = await startAsrConfucius(modelId);
    if (!r.ok) throw new Error(r.error);
  }

  const wavPath = await ensure16kWav(input.audioPath);
  const base = `http://127.0.0.1:${confuciusPort()}`;
  const data = await Bun.file(wavPath).arrayBuffer();
  const b64 = Buffer.from(data).toString("base64");

  const body = buildConfuciusRequestBody(b64);

  let res: Response;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logEvent({ source: "asr", event: "asr.confucius_request_failed", message: `Confucius4-R2T2 转写请求失败：${msg}` });
    throw new Error(`Confucius4-R2T2 转写失败：${msg}`, { cause: e });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logEvent({
      source: "asr",
      event: "asr.confucius_error",
      message: `Confucius4-R2T2 转写返回 ${res.status}`,
      detail: { status: res.status, body: detail.slice(-500) },
    });
    throw new Error(`Confucius4-R2T2 转写失败（HTTP ${res.status}）${detail.slice(-200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const text = cleanTranscriptText(raw);
  if (!text) {
    logEvent({ source: "asr", event: "asr.confucius_empty", message: "Confucius4-R2T2 未识别到语音内容" });
    return { text: "", engine: "confucius", modelLabel: resolved.entry.name };
  }
  return { text, engine: "confucius", modelLabel: resolved.entry.name };
}
