import { classifyStartupError, type StartupErrorKind } from "../../shared/engine-errors";

type T = (key: string) => string;

/**
 * 这条启动失败是不是「推理引擎没装」这一类。
 *
 * 单独暴露给界面用：本地模型页碰到这种错误时要直接把「一键安装」摆到报错旁边，
 * 而不是只念一句 `brew install llama.cpp` —— 已经装过模型、走完了引导页的机器
 * 不会再去引导页，光给命令用户找不到界面上的路（issue #8）。
 */
export function isEngineMissingError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /not found on path|not found\. install with|vllm not found|sglang not found|mlx 未安装/i.test(error);
}

/**
 * 把后端给的启动错误映射成一句能照做的中文（或英文）提示。
 *
 * 分类的**唯一判据在 `shared/engine-errors.ts`**，主进程在失败时就把类型算好
 * （`ServedModelInfo.errorKind` / `getServerStatus().errorKind`），这里优先用它。
 * 拿不到类型时才就地分一次类 —— 用的是同一张规则表，所以同一个错误在聊天里、
 * 在控制台里、在模型页里给的建议不会各说各话（这正是以前那四个正则的老毛病：
 * 它们和主进程各判各的，`unknown model architecture` 之外几乎都认不出来）。
 *
 * 仍然就地判的两条不是「引擎启动失败」的类别，而是本应用自己的状态文案，
 * 所以留在分类器之外。
 */
export function serverErrorHint(
  t: T,
  error: string | null | undefined,
  kind?: StartupErrorKind,
): string | null {
  if (!error) return null;
  if (kind) return t(`engine.error.hint.${kind}`);

  const classified = classifyStartupError(error);
  if (classified !== "unknown") return t(`engine.error.hint.${classified}`);

  // 引擎没装不是「引擎启动失败」的类别（分类器认不出 `llama-server not found on PATH`
  // 这种原文），但它对用户是有用的一句：本地模型页据此在原文下面同时挂「一键安装」。
  if (isEngineMissingError(error)) return t("server.error.hint.engine");

  if (/no model configured/i.test(error)) return t("server.error.hint.noModel");
  if (/timed out/i.test(error)) return t("server.error.hint.timeout");
  return null;
}

/** Backend persists assistant failure messages as "⚠️ <raw error>". Extract the raw error. */
export function persistedErrorMessage(content: string): string | null {
  if (!content.startsWith("⚠️")) return null;
  return content.slice(2).trim();
}
