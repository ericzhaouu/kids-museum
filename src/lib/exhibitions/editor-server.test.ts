import { describe, expect, it } from "vitest";
import {
  parseExhibitionSuggestionContent,
  selectActiveExhibitionId,
} from "@/lib/exhibitions/editor-server";

describe("exhibition editor helpers", () => {
  it("prefers the latest draft as active exhibition", () => {
    expect(
      selectActiveExhibitionId([
        {
          id: "1",
          title: "已发布",
          subtitle: "",
          introduction: "",
          status: "published",
          themeId: "warm-gallery",
          rooms: [],
        },
        {
          id: "2",
          title: "草稿",
          subtitle: "",
          introduction: "",
          status: "draft",
          themeId: "warm-gallery",
          rooms: [],
        },
      ]),
    ).toBe("2");
  });

  it("parses fenced exhibition suggestion JSON", () => {
    const parsed = parseExhibitionSuggestionContent(
      '```json\n{"title":"会发光的晚安","introduction":"把孩子今晚想留下来的颜色慢慢挂好，让家人走进来时先听见这场展览的呼吸。","rooms":[{"order":0,"introduction":"先从会飞的念头开始，让观众在轻轻抬头时就看见孩子的大胆想象。"}]}\n```',
    );

    expect(parsed.success).toBe(true);
  });
});
