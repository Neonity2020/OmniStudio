/**
 * 实时语音通话（DashScope Qwen Realtime）的常量。
 *
 * 放在 shared 是因为**两个进程都要用**：主进程拿它们当默认配置，通话页要拿
 * `DEFAULT_REALTIME_MODEL` 去厂商模型清单里挑出对应的那张牌。webview 不能从
 * `bun/realtime-voice.ts` 值导入 —— 那个模块（经 cloud-providers → db → paths）
 * 会在模块级调用 `os.homedir()`，而 webview 里没有 Node 内置模块，一加载就整页白屏。
 * 前端包只允许值导入 shared 与第三方依赖，类型导入不受此限。
 */

/** 可选的云端实时模型（qwen-audio-agent 默认即 plus 档）。 */
export const REALTIME_MODELS = [
  "qwen-audio-3.0-realtime-plus",
  "qwen-audio-3.0-realtime-flash",
  "qwen3.5-omni-flash-realtime",
  "qwen3.5-omni-plus-realtime",
] as const;

export const DEFAULT_REALTIME_BASE_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
export const DEFAULT_REALTIME_MODEL = "qwen-audio-3.0-realtime-plus";
export const DEFAULT_REALTIME_VOICE = "longanqian";

/**
 * 从云厂商的 HTTP 地址推出实时通话的 WebSocket 地址（认得出才推，认不出返回 null）。
 *
 * 实时接口不在 OpenAI 兼容面上（DashScope 自己的 `api-ws/v1/realtime`），所以没法像
 * 生图 / TTS 那样直接拿 `provider.baseUrl` 用。以前的做法是让用户在页面上手填一个
 * wss 地址 —— 换厂商不会跟着换，填错只表现为"连不上"。这里把已知厂商的推导规则写下来：
 * 选了百炼就自动用它的实时端点；自建中转（认不出的主机）仍保留手填值。
 *
 * 放在 shared 是因为通话页（webview）切换厂商时要立刻显示推导结果。
 */
export function realtimeBaseUrlForProvider(providerBaseUrl: string | null | undefined): string | null {
  const base = (providerBaseUrl ?? "").trim();
  if (!base) return null;
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return null;
  }
  if (!/^(dashscope|bailian)\.aliyuncs\.com$/i.test(host)) return null;
  return `wss://${host}/api-ws/v1/realtime`;
}

/**
 * 这个模型名看着像实时语音模型吗（用来把厂商清单里混进来的对话 / 生图模型挡在下拉外）。
 *
 * 实时接口只吃 realtime / omni 两族：把 `qwen-max`、`wanx-v1` 一起列出来，用户选了之后
 * 只会等到连接时报一句看不懂的错。
 */
export function isRealtimeModelId(id: string): boolean {
  return /realtime|omni/i.test(id);
}
