import { expect, test, describe } from "bun:test";
import {
  CONFUCIUS_ASR_CATALOG,
  CONFUCIUS_ASR_REPO,
  confuciusModelEntry,
} from "../shared/asr-confucius";
import {
  buildConfuciusRequestBody,
  buildConfuciusServerArgs,
  cleanTranscriptText,
} from "./asr-confucius";

describe("CONFUCIUS_ASR_CATALOG", () => {
  test("q8_0 是默认（第一个）条目，两个文件与 repo 的发布一致", () => {
    const q8 = CONFUCIUS_ASR_CATALOG[0];
    expect(q8?.id).toBe("confucius4-r2t2-q8");
    expect(q8?.quant).toBe("Q8_0");
    // 对照 HF 仓库实际文件：主模型 1,834,422,208 B + 音频编码器 348,336,544 B
    expect(q8?.mainFile).toBe("Confucius4-R2T2-Q8_0.gguf");
    expect(q8?.mmprojFile).toBe("mmproj-Confucius4-R2T2-Q8_0.gguf");
    expect(q8?.totalSizeBytes).toBe(1_834_422_208 + 348_336_544);
  });

  test("id 唯一，文件都落在 CONFUCIUS_ASR_REPO 仓库内语义下", () => {
    const ids = CONFUCIUS_ASR_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of CONFUCIUS_ASR_CATALOG) {
      expect(m.mainFile.endsWith(".gguf")).toBe(true);
      expect(m.mmprojFile.startsWith("mmproj-")).toBe(true);
      // 轻量量化与 Q8_0 共用同一个音频编码器（编码器与主模型量化无关）
      if (m.id !== "confucius4-r2t2-q8") {
        expect(m.mmprojFile).toBe("mmproj-Confucius4-R2T2-Q8_0.gguf");
      }
    }
  });

  test("confuciusModelEntry 精确匹配", () => {
    expect(confuciusModelEntry("confucius4-r2t2-q8")?.name).toBe("Confucius4-R2T2 Q8_0");
    expect(confuciusModelEntry("nope")).toBeUndefined();
    expect(confuciusModelEntry(null)).toBeUndefined();
  });
});

describe("buildConfuciusServerArgs", () => {
  test("主模型 + mmproj + 本机端口 + 固定推理参数", () => {
    const args = buildConfuciusServerArgs({
      bin: "/data/engines/llama.cpp/current/llama-server",
      mainPath: "/data/models/r2t2/Confucius4-R2T2-Q8_0.gguf",
      mmprojPath: "/data/models/r2t2/mmproj-Confucius4-R2T2-Q8_0.gguf",
      port: 18085,
    });
    expect(args).toEqual([
      "/data/engines/llama.cpp/current/llama-server",
      "-m", "/data/models/r2t2/Confucius4-R2T2-Q8_0.gguf",
      "--mmproj", "/data/models/r2t2/mmproj-Confucius4-R2T2-Q8_0.gguf",
      "--host", "127.0.0.1",
      "--port", "18085",
      "--ctx-size", "8192",
      "--parallel", "1",
    ]);
  });
});

describe("buildConfuciusRequestBody", () => {
  test("llama.cpp 原生 input_audio 内容块（Qwen3-ASR 系的标准用法）", () => {
    const body = buildConfuciusRequestBody("aGVsbG8=");
    expect(body.model).toBe("confucius4-r2t2");
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [{ type: "input_audio", input_audio: { data: "aGVsbG8=" } }],
      },
    ]);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBeGreaterThanOrEqual(1024);
  });
});

describe("cleanTranscriptText", () => {
  test("中文实测输出：切掉 language 声明与 <asr_text>，保留纯文本", () => {
    const raw = "language Chinese<asr_text>你好，欢迎使用孔子实时语音识别模型测试，今天天气真不错。";
    expect(cleanTranscriptText(raw)).toBe(
      "你好，欢迎使用孔子实时语音识别模型测试，今天天气真不错。",
    );
  });

  test("英文实测输出同样处理", () => {
    const raw =
      "language English<asr_text>Confucius for real-time transcription engine running with llama cpp on Apple Silicon.";
    expect(cleanTranscriptText(raw)).toBe(
      "Confucius for real-time transcription engine running with llama cpp on Apple Silicon.",
    );
  });

  test("静音（language None）清洗后为空字符串", () => {
    expect(cleanTranscriptText("language None<asr_text>")).toBe("");
    expect(cleanTranscriptText("language None<asr_text>  ")).toBe("");
  });

  test("特殊 token（<|…|> 与 <asr_text> 混排）一并剥掉", () => {
    expect(cleanTranscriptText("<|startofthink|><asr_text> 你好 <|endofthink|>世界")).toBe("你好 世界");
  });

  test("没有 <asr_text> 的普通文本原样保留（仅规整空白）", () => {
    expect(cleanTranscriptText("  直接  的文本  ")).toBe("直接 的文本");
  });
});
