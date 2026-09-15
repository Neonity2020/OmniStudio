// 分段切换控件（互斥选项）。原本在 OCR 与 Skills 各有一份逐字相同的实现。
//
// 这里只收「相同实现」的那种（带内边距的 detached 版）。另有若干处
// `flex overflow-hidden rounded-lg border` 的 attached 版按钮组样式略有差异，
// 待各自菜单处理时再统一（见 docs/feature-audit.md 的跨菜单债）。
import type { ReactNode } from "react";

import { cn } from "@/mainview/lib/utils";

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
