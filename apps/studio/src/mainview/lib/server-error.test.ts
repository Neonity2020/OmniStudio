import { describe, expect, it, test } from "bun:test";

import { isEngineMissingError, persistedErrorMessage, serverErrorHint } from "./server-error";

/** 只关心「取到哪个键」，所以把 key 原样返回。 */
const t = (key: string) => key;

describe("isEngineMissingError", () => {
  it("认出各引擎的『没装』报错 —— 本地模型页据此在报错下面挂一键安装（issue #8）", () => {
    const engineMissing = [
      "llama-server not found on PATH",
      "vllm not found. install with pip install vllm",
      "sglang not found",
      "mlx 未安装",
    ];
    for (const error of engineMissing) {
      expect(`${error} → ${isEngineMissingError(error)}`).toBe(`${error} → true`);
    }
  });

  it("别的启动失败不能被当成引擎缺失（否则会挂出装不上的按钮）", () => {
    const other = [
      null,
      undefined,
      "",
      "unknown model architecture: FooForCausalLM",
      "no model configured",
      "server start timed out",
    ];
    for (const error of other) {
      expect(`${String(error)} → ${isEngineMissingError(error)}`).toBe(`${String(error)} → false`);
    }
  });

  it("引擎没装同时给「提示句 + 一键安装」两样：提示句来自这里，按钮靠上面的判定", () => {
    // 「没装」不是引擎启动失败的类别，分类器认不出这句话，所以单独兜一条 ——
    // 界面上一句「推理引擎未安装」+ 一个安装按钮，比只给原文更有用（issue #8）。
    expect(serverErrorHint(t, "llama-server not found on PATH")).toBe("server.error.hint.engine");
    expect(isEngineMissingError("llama-server not found on PATH")).toBe(true);
  });
});

describe("serverErrorHint", () => {
  test("有分类时直接用分类（主进程已经判过，不再就地猜）", () => {
    expect(serverErrorHint(t, "CUDA out of memory. Tried to allocate 2.00 GiB", "vram-insufficient")).toBe(
      "engine.error.hint.vram-insufficient",
    );
    // 即使原文和类型看起来不一致，也以主进程的类型为准：它见过完整日志，这里只有一行。
    expect(serverErrorHint(t, "something odd", "model-format")).toBe("engine.error.hint.model-format");
  });

  test("没有分类时就地分类，用的是同一张规则表", () => {
    expect(serverErrorHint(t, "ModuleNotFoundError: No module named 'mlx_lm'")).toBe(
      "engine.error.hint.missing-dependency",
    );
    expect(serverErrorHint(t, "ERROR: [Errno 98] Address already in use")).toBe(
      "engine.error.hint.port-in-use",
    );
    expect(serverErrorHint(t, "llama_model_load: failed to open model.gguf: bad magic")).toBe(
      "engine.error.hint.model-missing",
    );
  });

  test("架构不支持现在也认（老实现只认 llama.cpp 那一句原文）", () => {
    expect(serverErrorHint(t, "ValueError: Model type deepseek_v41 not supported.")).toBe(
      "engine.error.hint.model-format",
    );
  });

  test("本应用自己的状态文案仍然单独给提示", () => {
    expect(serverErrorHint(t, "No model configured")).toBe("server.error.hint.noModel");
    expect(serverErrorHint(t, "Server start timed out")).toBe("server.error.hint.timeout");
  });

  test("认不出来就不硬给建议，只留原文", () => {
    expect(serverErrorHint(t, "Process exited with code 1")).toBeNull();
    expect(serverErrorHint(t, "")).toBeNull();
    expect(serverErrorHint(t, undefined)).toBeNull();
  });
});

describe("persistedErrorMessage", () => {
  test("从落库的失败消息里取出原文", () => {
    expect(persistedErrorMessage("⚠️ CUDA out of memory")).toBe("CUDA out of memory");
    expect(persistedErrorMessage("正常回答")).toBeNull();
  });
});
