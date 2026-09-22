/**
 * 场景 B 的可视化：工单列表。
 *
 * 每条工单显示：原文、模型选的队列、是否紧急、置信度、对错标记（对标准答案
 * `expectedQueue`）。跑完全部工单后顶部出现 `triageStats()` 的准确率与平均
 * 置信度 —— 这是"批量分类"场景的卖点：不是某一条答对了，而是**可统计**。
 */
import { CheckIcon, XIcon } from "lucide-react";

import { useT } from "@stores/ui-lang";
import { TICKET_QUEUES, type Ticket, type TriageStats } from "./scenarios";

export type TriageRow = {
  ticket: Ticket;
  /** 模型选的队列；还没跑到这条时 undefined。 */
  choice?: string;
  /** noul 答案：是否紧急。 */
  urgent?: boolean;
  /** choice 置信度 0..1。 */
  confidence?: number;
  /** 跑完才有的批量统计（准确率与平均置信度）。 */
  stats?: TriageStats;
};

function QueueBadge({ label }: { label: string }) {
  return (
    <span className="flex-none rounded bg-chip px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{label}</span>
  );
}

export function TriageView({ rows }: { rows: TriageRow[] }) {
  const t = useT();
  const done = rows.filter((row) => row.choice !== undefined).length;
  const finished = done === rows.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* 跑完才显示批量结论（任务书要求：跑完在顶部显示准确率与平均置信度）。 */}
      {finished && rows.some((row) => row.stats) ? (
        <div className="jev-note ok flex-none">
          {t("jev.playground.triage.summary", {
            accuracy: `${Math.round((rows[0]!.stats!.accuracy ?? 0) * 100)}%`,
            confidence: `${Math.round((rows[0]!.stats!.meanConfidence ?? 0) * 100)}%`,
            total: String(rows.length),
            correct: String(rows[0]!.stats!.correct ?? 0),
          })}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
        {rows.map((row) => {
          const { ticket, choice, urgent, confidence } = row;
          const correct = choice !== undefined && choice === ticket.expectedQueue;
          return (
            <div key={ticket.id} className="jev-card flex-none">
              <div className="flex items-center gap-2">
                <span className="flex-none font-mono text-[10px] text-muted-foreground">#{ticket.id}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{ticket.subject}</span>
                {choice !== undefined ? (
                  <>
                    <QueueBadge label={choice} />
                    <QueueBadge label={t("jev.playground.triage.expected", { queue: ticket.expectedQueue })} />
                    {correct ? (
                      <span className="flex-none text-emerald-600" title={t("jev.playground.triage.correct")}>
                        <CheckIcon size={13} aria-hidden />
                      </span>
                    ) : (
                      <span className="flex-none text-destructive" title={t("jev.playground.triage.wrong")}>
                        <XIcon size={13} aria-hidden />
                      </span>
                    )}
                  </>
                ) : (
                  <span className="flex-none text-[10px] text-muted-foreground">{t("jev.playground.triage.pending")}</span>
                )}
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">{ticket.body}</p>
              {choice !== undefined ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span>
                    {t("jev.playground.triage.urgent")}: {urgent === undefined ? "—" : t(`jev.playground.triage.urgent.${String(urgent)}`)}
                  </span>
                  <span>
                    {t("jev.playground.triage.confidence")}: {confidence === undefined ? "—" : `${Math.round(confidence * 100)}%`}
                  </span>
                  {correct ? (
                    <span className="text-emerald-600">{t("jev.playground.triage.correct")}</span>
                  ) : (
                    <span className="text-destructive">{t("jev.playground.triage.wrong")}</span>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* 队列图例：四个队列各一行说明（来自场景数据，英文 —— 发给模型的那份）。 */}
      <div className="flex-none border-t pt-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {TICKET_QUEUES.map((queue) => (
            <span key={queue} className="truncate text-[10px] text-muted-foreground">
              <span className="font-mono font-semibold">{queue}</span> · {t(`jev.playground.triage.queue.${queue}`)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
