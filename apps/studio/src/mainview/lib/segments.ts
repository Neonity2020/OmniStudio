/**
 * ASR 逐句片段的播放定位工具（纯函数，无 UI / electrobun 依赖）。
 */
import type { AsrSegment } from "../../bun/asr";

/**
 * 当前播放位置对应的句索引（start <= t < end；t 落在句间空隙时归前一句，返回 -1 表示未开始）。
 * 段数最多几千，4Hz 的 timeupdate 下线性扫完全够，无需二分。
 */
export function findActiveSegment(segments: AsrSegment[], t: number): number {
  if (segments.length === 0 || !Number.isFinite(t) || t < 0) return -1;
  let active = -1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (s.start <= t) active = i;
    else break;
    if (t < s.end) return i;
  }
  return active;
}
