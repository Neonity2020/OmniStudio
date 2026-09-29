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
  joinTranscriptParts,
  sliceWav16kToChunks,
} from "./asr-confucius";

/** 构造 16k mono 16-bit PCM 测试 WAV：正弦波（响）+ 可选中段静音。 */
function makeWav16k(seconds: number, silence: { from: number; to: number }[] = []): Buffer {
  const sampleCount = seconds * 16000;
  const data = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / 16000;
    const inSilence = silence.some((s) => t >= s.from && t < s.to);
    const v = inSilence ? 0 : Math.round(Math.sin(t * 2 * Math.PI * 220) * 8000);
    data.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

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
      "--ctx-size", "32768",
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

describe("cleanTranscriptText", () => {  test("中文实测输出：切掉 language 声明与 <asr_text>，保留纯文本", () => {
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

describe("sliceWav16kToChunks", () => {
  test("短音频（≤块长 1.2 倍）不切，原样返回", () => {
    const wav = makeWav16k(60);
    const chunks = sliceWav16kToChunks(wav);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(wav);
  });

  test("长音频切成 ≤120s 的多块，总时长守恒，切点落在静音处", () => {
    // 300 秒，在第 115–130 秒与 235–250 秒放静音（贴近预期切点 120/240）
    const wav = makeWav16k(300, [
      { from: 114, to: 131 },
      { from: 234, to: 251 },
    ]);
    const chunks = sliceWav16kToChunks(wav);
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    let totalSamples = 0;
    for (const c of chunks) {
      // 头部修正校验：RIFF size 与 data size 都要和实际字节一致
      const dataOffset = c.indexOf("data", 12) + 8;
      expect(c.readUInt32LE(4)).toBe(c.length - 8);
      expect(c.readUInt32LE(dataOffset - 4)).toBe(c.length - dataOffset);
      totalSamples += (c.length - dataOffset) / 2;
      // 单块不超过块长 + 静音对齐的搜索余量（±4s）
      expect((c.length - dataOffset) / 2 / 16000).toBeLessThanOrEqual(124);
    }
    expect(totalSamples).toBe(300 * 16000);
  });

  test("缺 data 块的输入报错", () => {
    const junk = Buffer.alloc(100, 1);
    expect(() => sliceWav16kToChunks(junk)).toThrow(/data 块/);
  });
});

describe("joinTranscriptParts", () => {
  test("CJK 边界直接相连，西文边界补空格，空块跳过", () => {
    expect(joinTranscriptParts(["你好，", "欢迎来到", "频道。"])).toBe("你好，欢迎来到频道。");
    expect(joinTranscriptParts(["hello world", "from the model"])).toBe("hello world from the model");
    expect(joinTranscriptParts(["第一段。", "", "  ", "第二段。"])).toBe("第一段。第二段。");
  });

  test("全部为空返回空串", () => {
    expect(joinTranscriptParts(["", "  "])).toBe("");
  });
});
