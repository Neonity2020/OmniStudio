// 本地模型页共享工具。
//
// `formatBytes` 只在本页三处使用（已安装列表 / 模型目录 / 默认模型量化表），口径为
// 1e9/1e6/1e3；跨页统一会改变其它页显示，故不动（见 docs/feature-audit.md 跨菜单债）。

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}
