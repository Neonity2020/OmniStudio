/**
 * Confucius4-R2T2 本地 ASR 引擎的共享常量（主进程与 webview 共用）。
 *
 * 网易有道 Confucius4-R2T2（“Real Real-Time Transcription”）是基于
 * Qwen3-ASR-1.7B 的流式语音识别模型：中英多语言、内部统一 16kHz、
 * 80ms–2s 分块、追加式输出。Mac 本地走 llama.cpp —— 音频编码器按
 * llama.cpp 的 mmproj 惯例与主模型分开发布（`mmproj-*.gguf`），
 * 由 llama-server 以 `--mmproj` 挂载，与视觉模型的投影器同机制。
 *
 * 引擎本体就是 app 已托管的 llama.cpp（设置 → 模型引擎），这里只有
 * 模型目录与端口常量 —— 不新增引擎行。
 */
export const CONFUCIUS_ASR_REPO = "netease-youdao/Confucius4-R2T2-GGUF";

/** 模型许可（权重是非 OSI 的 NetEase 模型使用许可，代码才是 Apache-2.0）。 */
export const CONFUCIUS_ASR_LICENSE_URL = `https://huggingface.co/${CONFUCIUS_ASR_REPO}`;

/** ASR 引擎选择设置 `ASR_ENGINE` 的取值。 */
export const CONFUCIUS_ENGINE_ID = "confucius";

/** 专用 llama-server 实例监听端口（避开 18080 TTS / 18081 whisper / 18190 / 19782 图像）。 */
export const ASR_CONFUCIUS_PORT_KEY = "ASR_CONFUCIUS_PORT";
export const DEFAULT_ASR_CONFUCIUS_PORT = "18085";

export type ConfuciusAsrModel = {
  id: string;
  name: string;
  /** 主模型 GGUF（LLM + 权重量化）。 */
  mainFile: string;
  /** 音频编码器 mmproj（与主模型同量化或更轻，任何主模型量化均可配对）。 */
  mmprojFile: string;
  /** 两个文件合计（用于展示与下载进度口径）。 */
  totalSizeBytes: number;
  quant: string;
  languages: string[];
  description: string;
};

/**
 * Confucius4-R2T2-GGUF 仓库精选量化。Q8_0 是默认（准确度优先，合计约 2.0 GB），
 * Q4_K_M 作为轻量选项（配对 Q8_0 的 mmproj —— 音频编码器与主模型量化无关，
 * 只需下载一次 mmproj）。文件与大小已对照仓库实际文件核对。
 */
export const CONFUCIUS_ASR_CATALOG: readonly ConfuciusAsrModel[] = [
  {
    id: "confucius4-r2t2-q8",
    name: "Confucius4-R2T2 Q8_0",
    mainFile: "Confucius4-R2T2-Q8_0.gguf",
    mmprojFile: "mmproj-Confucius4-R2T2-Q8_0.gguf",
    totalSizeBytes: 1_834_422_208 + 348_336_544,
    quant: "Q8_0",
    languages: ["中文", "English", "日本語", "한국어", "Français", "Deutsch", "Español", "Русский", "العربية"],
    description: "网易有道实时流式语音识别（Qwen3-ASR-1.7B 微调），中英多语言，追加式低延迟输出。",
  },
  {
    id: "confucius4-r2t2-q4k",
    name: "Confucius4-R2T2 Q4_K_M",
    mainFile: "Confucius4-R2T2-Q4_K_M.gguf",
    mmprojFile: "mmproj-Confucius4-R2T2-Q8_0.gguf",
    totalSizeBytes: 1_107_404_736 + 348_336_544,
    quant: "Q4_K_M",
    languages: ["中文", "English", "日本語", "한국어", "Français", "Deutsch", "Español", "Русский", "العربية"],
    description: "同一模型的轻量量化（主模型约 1.0 GB），内存紧张时使用。",
  },
];

export function confuciusModelEntry(modelId: string | null | undefined): ConfuciusAsrModel | undefined {
  return CONFUCIUS_ASR_CATALOG.find((m) => m.id === modelId) ?? undefined;
}
