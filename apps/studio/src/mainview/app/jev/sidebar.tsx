/**
 * JEV 的侧栏：内置示例清单（对齐语音页侧栏的位置 —— 那里是记录列表，这里是示例）。
 *
 * 为什么用示例而不是记录：判定结果不适合当"历史记录"（同一段文本跑两次的答案一样，
 * 存下来只是一堆重复的概率分布）。而"能直接点的示例"解决了这个页面最大的门槛 ——
 * 用户看到一堆 noul / choice / score 的输入框，第一反应是"我该问什么"。
 */
import { LightbulbIcon, RotateCcwIcon } from "lucide-react";

import { useJevStore } from "@stores/jev";
import { useT, useUILang } from "@stores/ui-lang";
import { Button } from "@ui/button";
import { cn } from "@/mainview/lib/utils";
import { jevExamples } from "./examples";

export function JevSidebar() {
  const t = useT();
  const lang = useUILang((s) => s.lang);
  const exampleId = useJevStore((s) => s.exampleId);
  const applyExample = useJevStore((s) => s.applyExample);
  const reset = useJevStore((s) => s.reset);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <LightbulbIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-semibold">{t("jev.examples")}</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-1.5" onClick={reset}>
          <RotateCcwIcon className="size-3" aria-hidden />
          <span className="text-[11px]">{t("jev.examples.reset")}</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex flex-col gap-1">
          {jevExamples(lang).map((example) => (
            <button
              key={example.id}
              type="button"
              className={cn(
                "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                exampleId === example.id ? "bg-accent/60" : "hover:bg-accent/40",
              )}
              onClick={() => applyExample(example.id)}
            >
              <span className="text-xs font-medium">{t(example.nameKey)}</span>
              <span className="text-[10px] leading-4 text-muted-foreground">{t(example.descKey)}</span>
            </button>
          ))}
        </div>
        <p className="px-2.5 pt-3 text-[10px] leading-4 text-muted-foreground">{t("jev.examples.hint")}</p>
      </div>
    </div>
  );
}
