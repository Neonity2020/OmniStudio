import { expect, test, describe } from "bun:test";
import { buildMinutesMarkdown } from "../lib/minutes";
import { findActiveSegment } from "../lib/segments";
import type { AsrSegment } from "../../bun/asr";

const seg = (start: number, end: number, text: string, speaker?: number): AsrSegment => ({
  start,
  end,
  text,
  ...(speaker != null ? { speaker } : {}),
});

describe("buildMinutesMarkdown", () => {
  test("有说话人：连续同一说话人的句子聚合为一轮，带时间段与说话人标签", () => {
    const md = buildMinutesMarkdown(
      [
        seg(0, 2, "你好", 0),
        seg(2, 4.5, "欢迎来到频道", 0),
        seg(5, 7, "谢谢主持人", 1),
      ],
      true,
      "说话人",
    );
    // 元信息行
    expect(md).toContain("> 0:07 · 3 句 · 2 个说话人");
    // 轮次 1：两句话合并且不加多余空格（CJK 边界）
    expect(md).toContain("**说话人 1** · `0:00 – 0:04`");
    expect(md).toContain("你好欢迎来到频道");
    // 轮次 2
    expect(md).toContain("**说话人 2** · `0:05 – 0:07`");
    expect(md).toContain("谢谢主持人");
  });

  test("无说话人：按句间停顿（>2.5s）分段，时间戳领起", () => {
    const md = buildMinutesMarkdown(
      [
        seg(0, 2, "第一句"),
        seg(2, 4, "第二句"),
        seg(10, 12, "停顿后的新段落"),
      ],
      false,
      "说话人",
    );
    expect(md).toContain("**`0:00`**");
    expect(md).toContain("第一句第二句");
    expect(md).toContain("**`0:10`**");
    expect(md).toContain("停顿后的新段落");
    // 元信息不含说话人
    expect(md).toContain("> 0:12 · 3 句\n");
  });

  test("西文边界拼句子加空格，CJK 边界不加", () => {
    const md = buildMinutesMarkdown(
      [seg(0, 2, "hello world"), seg(2, 4, "from the model"), seg(4, 6, "你好"), seg(6, 8, "世界")],
      false,
      "说话人",
    );
    expect(md).toContain("hello world from the model");
    expect(md).toContain("你好世界");
    expect(md).not.toContain("你好 世界");
  });

  test("空片段返回空串", () => {
    expect(buildMinutesMarkdown([], true, "说话人")).toBe("");
  });
});

describe("findActiveSegment", () => {
  const segs = [
    seg(0, 2, "a"),
    seg(2.5, 5, "b"),
    seg(5, 8, "c"),
  ];

  test("句中返回该句索引", () => {
    expect(findActiveSegment(segs, 1)).toBe(0);
    expect(findActiveSegment(segs, 3)).toBe(1);
    expect(findActiveSegment(segs, 7.9)).toBe(2);
  });

  test("句间空隙归前一句，起点精确命中新句", () => {
    expect(findActiveSegment(segs, 2.2)).toBe(0); // 空隙 2–2.5
    expect(findActiveSegment(segs, 2.5)).toBe(1); // 精确命中
    expect(findActiveSegment(segs, 8.5)).toBe(2); // 结尾之后归最后一句
  });

  test("未开始与空列表返回 -1", () => {
    expect(findActiveSegment(segs, -1)).toBe(-1);
    expect(findActiveSegment([], 3)).toBe(-1);
    expect(findActiveSegment(segs, NaN)).toBe(-1);
  });
});
