/**
 * 运行日志：每步一行。
 *
 * 一行 = 一次 `systemoneRun`：步号、问题名、模型的选择、置信度、概率分布条
 *（画法与 `../answers.tsx` 的 `ProbabilityBar` 一致，但那个文件是判定台的
 * 组件，不能为了演练场动它）、以及这一步的耗时（调用前后各取一次
 * `performance.now()`，差值取整）。
 */
import { useT } from "@stores/ui-lang";
import { cn } from "@/mainview/lib/utils";

/** 一步运行的记录（父组件在调用前后各取一次时间戳算出 ms）。 */
export type RunLogEntry = {
  /** 1 起。 */
  step: number;
  /** 问题名（如 `next_move` / `queue` / `urgent`）。 */
  question: string;
  /** choice → 选项名；noul → "true" / "false"。 */
  choice: string;
  /** 0..1；noul 没有单独的 confidence（noul 本身即置信度），此时 undefined。 */
  confidence?: number;
  /** 该问题的概率分布（noul 是 { true, false }）。 */
  probabilities: Record<string, number>;
  /** 本步耗时（ms）。 */
  ms: number;
};

function ProbabilityBar({ label, value }: { label: string; value: number }) {
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("jev-prob")}>
      <span className="jev-prob-label" title={label}>
        {label}
      </span>
      <span className="jev-prob-track">
        <span className="jev-prob-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="jev-prob-value">{percent.toFixed(1)}%</span>
    </div>
  );
}

export function RunLog({ entries }: { entries: RunLogEntry[] }) {
  const t = useT();
  if (entries.length === 0) {
    return <p className="px-1 text-[11px] text-muted-foreground">{t("jev.playground.log.empty")}</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
      {entries.map((entry) => {
        const probs = Object.entries(entry.probabilities).sort((a, b) => b[1] - a[1]);
        return (
          <div key={entry.step} className="jev-card flex-none">
            <div className="flex items-center gap-2">
              <span className="flex-none font-mono text-[10px] text-muted-foreground">
                {t("jev.playground.log.step", { n: String(entry.step) })}
              </span>
              <span className="jev-answer-name">{entry.question}</span>
              <span className="jev-answer-headline">{entry.choice}</span>
              <span className="flex-none text-[10px] text-muted-foreground">
                {entry.confidence !== undefined
                  ? `${t("jev.playground.log.confidence", { value: entry.confidence.toFixed(3) })}`
                  : ""}
                {" · "}
                {entry.ms} ms
              </span>
            </div>
            <div className="jev-probs">
              {probs.map(([label, value]) => (
                <ProbabilityBar key={label} label={label} value={value} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
