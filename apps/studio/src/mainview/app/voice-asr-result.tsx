import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  ListIcon,
  PauseIcon,
  PlayIcon,
  ScrollTextIcon,
  SpellCheckIcon,
  TimerIcon,
  UsersIcon,
} from "lucide-react";
import type { AsrSegment } from "../../bun/asr";
import { useT } from "@stores/ui-lang";
import { Button } from "@ui/button";
import { Markdown } from "@components/markdown";
import { buildMinutesMarkdown } from "@lib/minutes";
import { findActiveSegment } from "@lib/segments";
import { cn } from "@/mainview/lib/utils";

/**
 * 每句话说话人的配色（静态 tailwind 类，保证 JIT 能拾取）。
 * 说话人 id 对数组长度取模，保证任意人数都有可用配色。
 */
const SPEAKER_STYLES = [
  { bar: "bg-sky-500", dot: "bg-sky-500", chip: "border-sky-500/30 bg-sky-500/10 text-sky-600", edge: "border-sky-400/60" },
  { bar: "bg-rose-500", dot: "bg-rose-500", chip: "border-rose-500/30 bg-rose-500/10 text-rose-600", edge: "border-rose-400/60" },
  { bar: "bg-amber-500", dot: "bg-amber-500", chip: "border-amber-500/30 bg-amber-500/10 text-amber-600", edge: "border-amber-400/60" },
  { bar: "bg-emerald-500", dot: "bg-emerald-500", chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600", edge: "border-emerald-400/60" },
  { bar: "bg-violet-500", dot: "bg-violet-500", chip: "border-violet-500/30 bg-violet-500/10 text-violet-600", edge: "border-violet-400/60" },
  { bar: "bg-cyan-500", dot: "bg-cyan-500", chip: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600", edge: "border-cyan-400/60" },
  { bar: "bg-orange-500", dot: "bg-orange-500", chip: "border-orange-500/30 bg-orange-500/10 text-orange-600", edge: "border-orange-400/60" },
  { bar: "bg-fuchsia-500", dot: "bg-fuchsia-500", chip: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600", edge: "border-fuchsia-400/60" },
];

export function speakerStyle(speaker: number) {
  return SPEAKER_STYLES[speaker % SPEAKER_STYLES.length]!;
}

/**
 * 合并两次实时轮询的分段：按开始时间相近去重，后到的（更完整、更精确的）
 * 结果替换旧片段，保持按时间排序。实时转写每次都会重转整段已录音频，因此
 * 之前已展示的片段可能被修正，这里用时间相似度做锚点去重。
 */
export function mergeSegments(prev: AsrSegment[], next: AsrSegment[]): AsrSegment[] {
  if (prev.length === 0) return [...next];
  const out = [...prev];
  for (const seg of next) {
    const idx = out.findIndex((p) => Math.abs(p.start - seg.start) < 1.2);
    if (idx >= 0) out[idx] = seg;
    else out.push(seg);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 媒体时间轴时钟：m:ss 或 h:mm:ss。 */
export function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(segments: AsrSegment[], hasSpeakers: boolean, speakerLabel: string): string {
  return segments
    .map((s, i) => {
      const label =
        hasSpeakers && s.speaker != null ? `[${speakerLabel} ${s.speaker + 1}] ` : "";
      return `${i + 1}\n${fmtSrtTime(s.start)} --> ${fmtSrtTime(s.end)}\n${label}${s.text}`;
    })
    .join("\n\n");
}

function niceStep(total: number): number {
  if (total <= 15) return 5;
  if (total <= 60) return 10;
  if (total <= 180) return 30;
  if (total <= 600) return 60;
  return 120;
}

/** 带时间刻度的分段条带：每段按起止时间与说话人着色，点击跳到对应句子。 */
function SegmentTimeline({
  segments,
  speakerMode,
  hasSpeakers,
  onJump,
  currentTime,
}: {
  segments: AsrSegment[];
  speakerMode: boolean;
  hasSpeakers: boolean;
  onJump: (index: number) => void;
  /** 播放位置（秒）；有值时显示红色播放游标。 */
  currentTime?: number;
}) {
  const total = Math.max(segments[segments.length - 1]?.end ?? 0, 1);
  const step = niceStep(total);
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);
  if (ticks[ticks.length - 1]! < total - 0.5) ticks.push(total);

  return (
    <div className="select-none">
      <div className="relative h-9 w-full overflow-hidden rounded-lg bg-muted/60">
        {segments.map((s, i) => {
          const spk = speakerMode && hasSpeakers && s.speaker != null ? s.speaker : 0;
          const st = speakerStyle(spk);
          const left = Math.max(0, (s.start / total) * 100);
          const width = Math.max(((s.end - s.start) / total) * 100, 1.2);
          return (
            <button
              key={`${i}-${s.start.toFixed(2)}`}
              type="button"
              onClick={() => onJump(i)}
              title={`${fmtClock(s.start)} – ${fmtClock(s.end)} · ${s.text.slice(0, 40)}`}
              className={cn("absolute inset-y-1 rounded-md transition-[filter] hover:brightness-110", st.bar, "opacity-90")}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
        {currentTime != null && currentTime > 0 && (
          <span
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.8)]"
            style={{ left: `${Math.min((currentTime / total) * 100, 100)}%` }}
          />
        )}
      </div>
      <div className="relative mt-0.5 h-3.5 text-[9px] text-muted-foreground tabular-nums">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2 first:translate-x-0 last:translate-x-[-100%]"
            style={{ left: `${(tick / total) * 100}%` }}
          >
            {fmtClock(tick)}
          </span>
        ))}
      </div>
    </div>
  );
}

function useCopyFeedback(): [string | null, (kind: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const copy = (kind: string, text: string) => {
    void navigator.clipboard.writeText(text).catch(() => {});
    setCopied(kind);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600) as unknown as number;
  };
  return [copied, copy];
}

/**
 * 音频 ↔ 文字对齐的播放状态：一个 audio 元素 + 播放位置轮询。
 * 放在 TranscriptViewer 顶层，播放头（进度 + 时间轴游标）与逐句列表的高亮
 * 共用同一份 playCur。
 */
function useAudioPlayback(url: string | undefined) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playCur, setPlayCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioDur, setAudioDur] = useState(0);

  useEffect(() => {
    const el = document.createElement("audio");
    if (url) {
      el.src = url;
      el.preload = "metadata";
    }
    el.addEventListener("timeupdate", () => setPlayCur(el.currentTime));
    el.addEventListener("play", () => setPlaying(true));
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("loadedmetadata", () => setAudioDur(Number.isFinite(el.duration) ? el.duration : 0));
    el.addEventListener("ended", () => setPlaying(false));
    audioRef.current = el;
    return () => {
      el.pause();
      el.src = "";
      audioRef.current = null;
    };
  }, [url]);

  const seekTo = (t: number) => {
    const el = audioRef.current;
    if (!el || !url) return;
    el.currentTime = Math.max(0, t);
    setPlayCur(el.currentTime);
    void el.play().catch(() => {});
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el || !url) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };

  return { playCur, playing, audioDur, seekTo, toggle };
}

/** 播放头：常驻在结果卡顶部的音频条（播放/暂停 + 可点进度条），下方是时间轴轨道。 */
function AudioHeader({
  playing,
  playCur,
  duration,
  total,
  onToggle,
  onSeek,
  segments,
  speakerMode,
  hasSpeakers,
  onJumpSegment,
}: {
  playing: boolean;
  playCur: number;
  duration: number;
  total: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  segments: AsrSegment[];
  speakerMode: boolean;
  hasSpeakers: boolean;
  onJumpSegment: (index: number) => void;
}) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const dur = duration > 0 ? duration : total;
  const pct = dur > 0 ? Math.min((playCur / dur) * 100, 100) : 0;

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    onSeek(((e.clientX - rect.left) / rect.width) * dur);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-3">
        <Button size="icon-sm" onClick={onToggle} tooltip={playing ? t("voice.asr.pause") : t("voice.asr.play")}>
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </Button>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{fmtClock(playCur)}</span>
        <div
          ref={barRef}
          onClick={seekFromEvent}
          className="group relative h-4 flex-1 cursor-pointer"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={dur}
          aria-valuenow={Math.round(playCur)}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/70 transition-[width] duration-100" style={{ width: `${pct}%` }} />
          </div>
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow transition-[left] duration-100 group-hover:size-3.5"
            style={{ left: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{fmtClock(dur)}</span>
      </div>
      <SegmentTimeline
        segments={segments}
        speakerMode={speakerMode}
        hasSpeakers={hasSpeakers}
        onJump={onJumpSegment}
        currentTime={playCur}
      />
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        点击轨道或进度条跳到对应位置；播放时逐句列表自动跟随高亮。
      </p>
    </div>
  );
}

export function TranscriptViewer({
  segments,
  text,
  engine,
  hasSpeakers,
  speakerMode,
  streaming,
  onJump,
  jumpIndex,
  audioUrl,
}: {
  segments: AsrSegment[];
  text: string;
  engine?: string;
  hasSpeakers?: boolean;
  speakerMode: boolean;
  streaming?: boolean;
  onJump?: (index: number) => void;
  jumpIndex?: number | null;
  /** 转写来源音频（staged URL）；有值时顶部常驻播放头并联动高亮。 */
  audioUrl?: string;
}) {
  const t = useT();
  // 默认展示整理稿（Markdown 纪要）；逐句原文与纯文本作为次级视图。
  const [view, setView] = useState<"minutes" | "segments" | "plain">("minutes");
  const [copied, copy] = useCopyFeedback();
  const listRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const hasSegs = segments.length > 0;
  const total = hasSegs ? segments[segments.length - 1]!.end : 0;
  const { playCur, playing, audioDur, seekTo, toggle } = useAudioPlayback(audioUrl);
  const activeSeg = useMemo(
    () => (audioUrl && playing ? findActiveSegment(segments, playCur) : -1),
    [audioUrl, playing, segments, playCur],
  );
  // 播放跟随：当前句变化时把它滚进视野（仅播放中；用户暂停浏览时不抢滚动条）。
  useEffect(() => {
    if (!playing || activeSeg < 0 || view !== "segments") return;
    const el = cardRef.current?.querySelector<HTMLElement>(`[data-seg="${activeSeg}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSeg, playing, view]);
  const speakerCount = useMemo(() => {
    if (!hasSegs) return 1;
    return speakerMode && hasSpeakers
      ? new Set(segments.map((s) => s.speaker ?? 0)).size
      : 1;
  }, [segments, hasSpeakers, speakerMode, hasSegs]);
  const minutes = useMemo(
    () => (hasSegs ? buildMinutesMarkdown(segments, speakerMode && !!hasSpeakers, t("voice.spk")) : ""),
    [segments, hasSpeakers, speakerMode, t],
  );

  const jump = (index: number) => {
    onJump?.(index);
    // 有音频时点轨道 = 定位播放；同时把该句滚进视野。
    if (audioUrl && segments[index]) seekTo(segments[index]!.start);
    requestAnimationFrame(() => {
      const el = cardRef.current?.querySelector<HTMLElement>(`[data-seg="${index}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const fullText = text || segments.map((s) => s.text).join("");
  const srt = buildSrt(segments, speakerMode && !!hasSpeakers, t("voice.spk"));

  if (!fullText && !hasSegs && !streaming) return null;

  return (
    <div ref={cardRef} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      {/* 播放头：常驻顶部（滚动时吸顶），进度条 + 时间轴轨道 + 播放游标 */}
      {audioUrl && hasSegs && (
        <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-1 rounded-t-xl border-b bg-card/95 px-4 py-3 backdrop-blur">
          <AudioHeader
            playing={playing}
            playCur={playCur}
            duration={audioDur}
            total={total}
            onToggle={toggle}
            onSeek={seekTo}
            segments={segments}
            speakerMode={speakerMode}
            hasSpeakers={!!hasSpeakers}
            onJumpSegment={jump}
          />
        </div>
      )}
      {/* Header: stats + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <SpellCheckIcon className="size-3.5 text-primary" />
            {t("voice.asr.result")}
          </span>
          {engine && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {engine}
            </span>
          )}
          {hasSegs && (
            <>
              <span className="flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                <ListIcon className="size-3" />
                {segments.length} {t("voice.asr.count")}
              </span>
              <span className="flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                <TimerIcon className="size-3" />
                {fmtClock(total)}
              </span>
              <span className="flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                <UsersIcon className="size-3" />
                {speakerCount} {t("voice.asr.speakers")}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasSegs && (
            <>
              {view === "minutes" ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy("md", minutes)}>
                  {copied === "md" ? <CheckIcon className="size-3.5 text-primary" /> : <CopyIcon className="size-3.5" />}
                  {copied === "md" ? t("voice.copied") : t("voice.asr.copyMd")}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy("text", fullText)}>
                  {copied === "text" ? <CheckIcon className="size-3.5 text-primary" /> : <CopyIcon className="size-3.5" />}
                  {copied === "text" ? t("voice.copied") : t("voice.asr.copyText")}
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy("srt", srt)}>
                {copied === "srt" ? <CheckIcon className="size-3.5 text-primary" /> : <CopyIcon className="size-3.5" />}
                {copied === "srt" ? t("voice.asr.srtCopied") : t("voice.asr.copySrt")}
              </Button>
              <div className="ml-1 flex items-center rounded-full bg-muted p-0.5">
                {(
                  [
                    { v: "minutes", label: t("voice.asr.viewMinutes") },
                    { v: "segments", label: t("voice.asr.viewSegments") },
                    { v: "plain", label: t("voice.asr.viewPlain") },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setView(o.v)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                      view === o.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Speaker legend */}
      {hasSegs && speakerMode && hasSpeakers && speakerCount > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from(new Set(segments.map((s) => s.speaker ?? 0)))
            .sort((a, b) => a - b)
            .map((spk) => (
              <span key={spk} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn("size-2 rounded-full", speakerStyle(spk).dot)} />
                {t("voice.spk")} {spk + 1}
              </span>
            ))}
        </div>
      )}

      {/* Timeline strip（无音频来源时保留；有播放头时轨道已在顶部，避免重复） */}
      {hasSegs && view === "segments" && !audioUrl && <SegmentTimeline segments={segments} speakerMode={speakerMode} hasSpeakers={!!hasSpeakers} onJump={jump} />}

      {/* No-speaker hint */}
      {hasSegs && speakerMode && !hasSpeakers && (
        <p className="text-[11px] text-muted-foreground/80">{t("voice.asr.noSpkInfo")}</p>
      )}

      {/* Body：整理稿是自然高度（由右侧结果区滚动），逐句与纯文不再内层截断 */}
      {view === "minutes" && hasSegs ? (
        <div className="rounded-lg border bg-background/60 px-5 py-4">
          <Markdown content={minutes} mode="static" />
        </div>
      ) : view === "plain" || !hasSegs ? (
        <p className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-[13px] leading-relaxed">
          {fullText}
          {streaming && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary align-middle" />}
        </p>
      ) : (
        <div ref={listRef} className="rounded-lg">
          <div className="flex flex-col gap-0.5">
            {segments.map((s, i) => {
              const spk = speakerMode && hasSpeakers && s.speaker != null ? s.speaker : 0;
              const st = speakerStyle(spk);
              const active = jumpIndex === i || activeSeg === i;
              return (
                <div
                  key={`${i}-${s.start.toFixed(2)}`}
                  data-seg={i}
                  onClick={() => jump(i)}
                  role="button"
                  title={audioUrl ? "点击播放这一句" : undefined}
                  className={cn(
                    "flex gap-3 rounded-lg border-l-2 px-3 py-2 transition-colors",
                    st.edge,
                    active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/40",
                    audioUrl && "cursor-pointer",
                  )}
                >
                  <div className="mt-0.5 flex w-[6.5rem] shrink-0 flex-col items-start gap-1">
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {fmtClock(s.start)} – {fmtClock(s.end)}
                    </span>
                    <span className={cn("rounded-full border px-1.5 py-px text-[9px] font-medium", st.chip)}>
                      {t("voice.spk")} {(spk + 1).toString()}
                    </span>
                  </div>
                  <p className="min-w-0 flex-1 text-[13px] leading-relaxed">{s.text}</p>
                </div>
              );
            })}
            {streaming && (
              <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                {t("voice.asr.liveStreaming")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
