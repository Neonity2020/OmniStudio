import { useMemo, useState } from "react";
import {
  ChevronRightIcon,
  FileSearchIcon,
  GlobeIcon,
  ImageIcon,
  ListTodoIcon,
  MessageCircleQuestionIcon,
  NetworkIcon,
  PencilIcon,
  SparklesIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useT } from "@stores/ui-lang";
import { InlinePermissionCard, InlineQuestionCard } from "./inline-interactions";
import { buildTimelineItems } from "./timeline-model";
import type { AgentEventRow } from "../../../bun/agent";

function parseArgs(args: string | null): Record<string, unknown> {
  if (!args) return {};
  try {
    const parsed = JSON.parse(args) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 相对路径只留文件名（工具行里给的是"改的是哪个文件"，不是完整路径）。 */
function baseName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** apply_patch 的段落头 → 改动到的文件（与 bun/apply-patch.ts 的格式一致）。 */
function patchFilePaths(patch: string): string[] {
  const paths: string[] = [];
  for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const value = match[1]?.trim();
    if (value) paths.push(value);
  }
  return paths;
}

/** 单行化：把命令 / 查询里的换行压成空格，避免工具行被撑成多行。 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type DiffSummary = { added: number; removed: number; lines: { type: "same" | "add" | "del"; text: string }[] };

/**
 * 极简行级 diff：把 old_str / new_str 按行做 LCS，只展示改变的部分（± 前缀）。
 * 编辑类工具卡片据此显示「改了什么」，而不是让用户去读 JSON 参数。
 */
function diffLines(oldText: string, newText: string): DiffSummary["lines"] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  // 超过 400 行就不做 LCS（O(n*m) 会卡住渲染），退化成整段替换。
  if (a.length > 400 || b.length > 400) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffSummary["lines"] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ type: "del", text: a[i]! });
      i += 1;
    } else {
      out.push({ type: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++]! });
  while (j < b.length) out.push({ type: "add", text: b[j++]! });
  return out;
}

/**
 * diff 结果按参数串缓存：LCS 是 O(n×m)，而工具行会在每次流式增量时重渲染
 * （每秒几十次），不缓存的话大文件编辑会把主线程占满。
 */
const diffCache = new Map<string, DiffSummary | null>();

export function summarizeEdit(args: string | null): DiffSummary | null {
  if (!args) return null;
  if (diffCache.has(args)) return diffCache.get(args) ?? null;
  const value = parseArgs(args);
  let summary: DiffSummary | null = null;
  if (typeof value.new_str === "string" && typeof value.old_str === "string") {
    const lines = diffLines(value.old_str, value.new_str);
    summary = {
      lines,
      added: lines.filter((line) => line.type === "add").length,
      removed: lines.filter((line) => line.type === "del").length,
    };
  } else if (typeof value.content === "string") {
    const lines = value.content
      .split("\n")
      .slice(0, 400)
      .map((text) => ({ type: "add" as const, text }));
    summary = { lines, added: lines.length, removed: 0 };
  } else if (typeof value.patch === "string") {
    // apply_patch：补丁文本本身就是 diff，按前缀渲染（+ 新增 / - 删除 / 其余是上下文）。
    const lines = value.patch
      .split("\n")
      .slice(0, 400)
      .map((text) => {
        if (text.startsWith("+") && !text.startsWith("+++")) return { type: "add" as const, text };
        if (text.startsWith("-") && !text.startsWith("---")) return { type: "del" as const, text };
        return { type: "same" as const, text };
      });
    summary = {
      lines,
      added: lines.filter((line) => line.type === "add").length,
      removed: lines.filter((line) => line.type === "del").length,
    };
  }
  // 缓存别无限涨：超出就整体丢掉重来（条目小，重建成本可以忽略）。
  if (diffCache.size > 300) diffCache.clear();
  diffCache.set(args, summary);
  return summary;
}

type ToolMeta = { icon: LucideIcon; labelKey: string; detail: string; file?: string };

/** 工具 → 一行的「图标 + 动作名 + 关键参数」。 */
function toolMeta(toolName: string, args: string | null): ToolMeta {
  const value = parseArgs(args);
  switch (toolName) {
    case "bash":
      return {
        icon: SquareTerminalIcon,
        labelKey: "agent.tool.terminal",
        detail: oneLine(str(value.command) || str(value.cmd) || ""),
      };
    case "read_file":
      return {
        icon: FileSearchIcon,
        labelKey: "agent.tool.read",
        detail: baseName(str(value.path)),
        file: str(value.path),
      };
    case "list_dir":
      return {
        icon: FileSearchIcon,
        labelKey: "agent.tool.list",
        detail: baseName(str(value.path) || "."),
        file: str(value.path),
      };
    case "glob":
      return { icon: FileSearchIcon, labelKey: "agent.tool.glob", detail: oneLine(str(value.pattern)), file: str(value.pattern) };
    case "grep":
      return { icon: FileSearchIcon, labelKey: "agent.tool.grep", detail: oneLine(str(value.pattern)), file: str(value.pattern) };
    case "write_file":
      return {
        icon: PencilIcon,
        labelKey: "agent.tool.write",
        detail: baseName(str(value.path)),
        file: str(value.path),
      };
    case "edit_file":
      return {
        icon: PencilIcon,
        labelKey: "agent.tool.edit",
        detail: baseName(str(value.path)),
        file: str(value.path),
      };
    case "apply_patch": {
      // 摘要里给"改了几个文件"，比一整段补丁更适合收成一行。
      const paths = patchFilePaths(str(value.patch));
      return {
        icon: PencilIcon,
        labelKey: "agent.tool.applyPatch",
        detail: paths.length ? `${paths.length} 个文件 · ${paths.slice(0, 3).map(baseName).join(", ")}` : "",
        file: paths[0],
      };
    }
    case "view_image":
      return {
        icon: ImageIcon,
        labelKey: "agent.tool.viewImage",
        detail: baseName(str(value.path)),
        file: str(value.path),
      };
    case "web_search":
      return { icon: GlobeIcon, labelKey: "agent.tool.webSearch", detail: oneLine(str(value.query)) };
    case "web_fetch":
      return { icon: GlobeIcon, labelKey: "agent.tool.webFetch", detail: oneLine(str(value.url)) };
    case "knowledge_search":
      return { icon: FileSearchIcon, labelKey: "agent.tool.knowledge", detail: oneLine(str(value.query)) };
    case "todo_write":
      return { icon: ListTodoIcon, labelKey: "agent.tool.todo", detail: "" };
    case "ask_user":
      return { icon: MessageCircleQuestionIcon, labelKey: "agent.tool.ask", detail: "" };
    case "task":
      return { icon: NetworkIcon, labelKey: "agent.tool.task", detail: oneLine(str(value.description) || str(value.prompt)) };
    default: {
      // 媒体类工具（生图 / 生视频 / 语音）走同一套行样式，只是图标不同。
      const isMedia = toolName.startsWith("generate") || toolName.includes("image") || toolName.includes("video");
      return {
        icon: isMedia ? SparklesIcon : WrenchIcon,
        labelKey: `agent.tool.${toolName}`,
        detail: oneLine(str(value.prompt) || str(value.query) || ""),
      };
    }
  }
}

/** diff 块：新增 / 删除分别染色，上下文不着色。 */
function DiffBlock({ summary }: { summary: DiffSummary }) {
  return (
    <div className="tool-diff">
      {summary.lines.map((line, index) => (
        <div key={index} className={`tool-diff-line${line.type === "add" ? " add" : line.type === "del" ? " del" : ""}`}>
          <span style={{ flex: "none", color: "var(--ds-text-muted)" }}>
            {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
          </span>
          <span style={{ minWidth: 0 }}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

/** 工具行的展开区：diff / 命令原文 / 参数 / 输出。 */
function ToolDetail({
  toolName,
  args,
  output,
  pending,
}: {
  toolName: string;
  args: string | null;
  output: string;
  pending: boolean;
}) {
  const t = useT();
  const edit = toolName === "edit_file" || toolName === "write_file" || toolName === "apply_patch";
  const summary = useMemo(() => (edit ? summarizeEdit(args) : null), [edit, args]);
  const parsed = useMemo(() => parseArgs(args), [args]);
  const command = toolName === "bash" ? str(parsed.command) || str(parsed.cmd) : "";
  const rawArgs = JSON.stringify(parsed, null, 2);

  return (
    <div style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 6 }}>
      {summary ? (
        <DiffBlock summary={summary} />
      ) : command ? (
        <div className="tool-block">{command}</div>
      ) : rawArgs !== "{}" ? (
        <div className="tool-block" style={{ color: "var(--ds-text-muted)" }}>
          {rawArgs}
        </div>
      ) : null}
      {output ? (
        <div className="tool-block">{output}</div>
      ) : !pending ? (
        <div className="tool-note">{t("agent.noOutput")}</div>
      ) : null}
    </div>
  );
}

/**
 * 单条工具调用：一行「图标 + 动作名 + 关键参数」，点开看 diff / 命令 / 输出。
 *
 * `live` = 这一轮还在跑：只有还在跑的时候才转圈。跑完（或会话早就结束）却因为
 * 事件没配到结果的行，展示成「没有结果记录」，绝不能一直转圈 —— 那会让人以为
 * 任务还在执行。
 */
function ToolRow({ start, end, live }: { start: AgentEventRow; end?: AgentEventRow; live: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pending = !end && live;
  const missing = !end && !live;
  const failed = (end?.isError ?? 0) === 1;
  const output = end?.output ?? "";
  const toolName = start.toolName ?? "";
  const meta = useMemo(() => toolMeta(toolName, start.args), [toolName, start.args]);
  const summary = useMemo(
    () => (toolName === "edit_file" || toolName === "write_file" ? summarizeEdit(start.args) : null),
    [toolName, start.args],
  );
  const Icon = meta.icon;

  return (
    <div className="tool-row">
      <button
        type="button"
        className="tool-row-header"
        aria-expanded={open}
        title={meta.file || meta.detail}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRightIcon size={13} className={`pi-caret${open ? " open" : ""}`} aria-hidden />
        <Icon size={13} aria-hidden style={{ flex: "none", color: "var(--ds-text-muted)" }} />
        <span className="tool-row-name">{t(meta.labelKey)}</span>
        {meta.detail ? <span className="tool-row-summary">{meta.detail}</span> : null}
        {summary && (summary.added > 0 || summary.removed > 0) ? (
          <span className="review-counters">
            <span className="review-add">+{summary.added}</span>
            {summary.removed > 0 ? <span className="review-del">-{summary.removed}</span> : null}
          </span>
        ) : null}
        {pending ? (
          <span className="tool-spinner" aria-hidden />
        ) : missing ? (
          <span className="tool-row-state">{t("agent.tool.interrupted")}</span>
        ) : (
          <span className={`tool-row-state${failed ? " error" : ""}`}>
            <span className={`tool-row-dot ${failed ? "error" : "ok"}`} aria-hidden />
          </span>
        )}
      </button>
      {open ? (
        <div className="tool-row-body">
          <ToolDetail toolName={toolName} args={start.args} output={output} pending={pending} />
        </div>
      ) : null}
    </div>
  );
}

/** 状态 / 错误 / 授权结果行：一行灰字，不抢正文的注意力。 */
function StatusLine({ event }: { event: AgentEventRow }) {
  const isError = event.kind === "error" || event.isError === 1;
  if (!(event.output ?? "").trim()) return null;
  return (
    <div className={`tool-note${isError ? " error" : ""}`} style={{ margin: "3px 0", whiteSpace: "pre-wrap" }}>
      {event.output}
    </div>
  );
}

/**
 * 子智能体分组：一条 task 派发 → 它自己的工具调用 → 结论，收进一个可折叠块，
 * 主线只留一行「子任务：描述 · N 次工具调用」。
 */
function SubagentGroup({
  start,
  end,
  children,
  live,
}: {
  start: AgentEventRow;
  end?: AgentEventRow;
  children: AgentEventRow[];
  live: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const failed = (end?.isError ?? 0) === 1;
  const running = !end && live;
  const toolCount = children.filter((event) => event.kind === "tool_start").length;

  return (
    <div className="tool-group" style={{ margin: "4px 0" }}>
      <button type="button" className="tool-group-header" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronRightIcon size={13} className={`pi-caret${open ? " open" : ""}`} aria-hidden />
        <NetworkIcon size={13} aria-hidden style={{ flex: "none", color: "var(--ds-purple)" }} />
        <span className="tool-group-label">{t("agent.tool.task")}</span>
        {toolCount > 0 ? (
          <span className="tool-group-count">{t("agent.subagent.tools", { count: String(toolCount) })}</span>
        ) : null}
        {start.output ? <span className="tool-row-summary">{oneLine(start.output)}</span> : null}
        {running ? (
          <span className="tool-spinner" aria-hidden />
        ) : failed ? (
          <span className="tool-row-dot error" aria-hidden />
        ) : null}
      </button>
      <div className={`tool-group-collapse${open ? " open" : ""}`}>
        <div>
          <div className="tool-group-body">
            {children.map((event) => (
              <ToolRow
                key={event.id}
                start={event}
                end={event.kind === "tool_end" ? event : undefined}
                live={live}
              />
            ))}
            {end?.output ? (
              <div className="tool-block" style={{ marginTop: 4 }}>
                {end.output}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 把一次运行的事件流渲染成时间线：
 * 配对逻辑在 timeline-model.ts（纯函数，有单测），这里只负责画。
 * `live` = 这一轮还在跑（只有最后一条消息在流式时才是 true），
 * 用来区分"正在执行"和"没有结果记录"。
 */
export function AgentEventTimeline({
  events,
  live = false,
}: {
  events: AgentEventRow[];
  live?: boolean;
}) {
  const items = useMemo(() => buildTimelineItems(events), [events]);

  if (items.length === 0) return null;

  return (
    <div style={{ display: "flex", minWidth: 0, flexDirection: "column" }}>
      {items.map((item, index) => {
        if (item.type === "tool") {
          return <ToolRow key={`${item.start.id}-${index}`} start={item.start} end={item.end} live={live} />;
        }
        if (item.type === "status") {
          return <StatusLine key={`${item.event.id}-${index}`} event={item.event} />;
        }
        if (item.type === "permission") {
          return (
            <InlinePermissionCard key={`${item.ask.id}-${index}`} askEvent={item.ask} settleEvent={item.settle} />
          );
        }
        if (item.type === "question") {
          return (
            <InlineQuestionCard key={`${item.ask.id}-${index}`} askEvent={item.ask} settleEvent={item.settle} />
          );
        }
        return (
          <SubagentGroup key={`${item.start.id}-${index}`} start={item.start} end={item.end} live={live}>
            {item.children}
          </SubagentGroup>
        );
      })}
    </div>
  );
}

/** 已经处理完的工具调用次数（折叠行的摘要用）。 */
export function countToolCalls(events: AgentEventRow[]): number {
  return events.filter((event) => event.kind === "tool_start").length;
}
