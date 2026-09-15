import { describe, expect, test } from "bun:test";

import {
  DEFAULT_REALTIME_BASE_URL,
  isRealtimeModelId,
  realtimeBaseUrlForProvider,
} from "./realtime-voice";

/**
 * 实时通话的「地址从厂商推、模型只列实时族」两条规则。
 *
 * 以前这两件事都压在用户身上：地址要手填一个 wss（换厂商不会跟着换，填错只表现为
 * "连不上"），模型下拉把厂商清单里的对话 / 生图模型一起列出来（选中后连接时才报错）。
 */
describe("realtimeBaseUrlForProvider", () => {
  test("百炼（DashScope）的兼容地址能推出实时端点", () => {
    expect(realtimeBaseUrlForProvider("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(
      DEFAULT_REALTIME_BASE_URL,
    );
    expect(realtimeBaseUrlForProvider("https://bailian.aliyuncs.com/v1")).toBe(
      "wss://bailian.aliyuncs.com/api-ws/v1/realtime",
    );
  });

  test("认不出的主机不猜：自建中转 / 第三方聚合保持用户填的值", () => {
    expect(realtimeBaseUrlForProvider("https://api.siliconflow.cn/v1")).toBeNull();
    expect(realtimeBaseUrlForProvider("http://127.0.0.1:11434/v1")).toBeNull();
    expect(realtimeBaseUrlForProvider("")).toBeNull();
    expect(realtimeBaseUrlForProvider(null)).toBeNull();
    expect(realtimeBaseUrlForProvider("不是一个地址")).toBeNull();
  });
});

describe("isRealtimeModelId", () => {
  test("实时族放行（realtime / omni 两族）", () => {
    expect(isRealtimeModelId("qwen-audio-3.0-realtime-plus")).toBe(true);
    expect(isRealtimeModelId("qwen3.5-omni-flash-realtime")).toBe(true);
  });

  test("对话 / 生图 / 嵌入模型挡掉", () => {
    expect(isRealtimeModelId("qwen-max")).toBe(false);
    expect(isRealtimeModelId("wanx-v1")).toBe(false);
    expect(isRealtimeModelId("text-embedding-v3")).toBe(false);
  });
});
