import { describe, expect, it } from "vitest";
import {
  createPosterFilename,
  createPosterPrivacyPayload,
  getPosterLayout,
} from "@/lib/share-poster";

describe("poster privacy payload", () => {
  it("keeps only gallery-safe fields and redacts embedded private references", () => {
    const artworkWithPrivateFields = {
      title: "月亮花园",
      age: "6 岁",
      medium: "油画棒",
      description:
        "作品说明 file:///C:/Users/demo/art.png，路径 C:\\Users\\demo\\child.png 和 family/private/art.webp，日期 2020-01-02",
      childQuote:
        "访问 token=plain-secret、data:image/png;base64,secret 或 Bearer header.payload.signature 后看星星",
      imageUrl: "https://private.example/signed-image?token=secret",
      createdAt: "2020-01-02",
      hasAudio: false,
      trueName: "不应分享",
      exactBirthDate: "2020-01-02",
      parentNotes: "不应分享",
      visitorToken: "visitor-secret",
      storagePath: "museum-private/family/art.png",
    };
    const payload = createPosterPrivacyPayload(artworkWithPrivateFields);

    expect(Object.keys(payload).sort()).toEqual([
      "age",
      "childQuote",
      "description",
      "medium",
      "title",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /file:|C:\\Users|family\/private|plain-secret|base64|header\.payload|signed-image|2020-01-02|不应分享|museum-private/u,
    );
    expect(payload.description).toContain("（已隐藏）");
    expect(payload.childQuote).toContain("（已隐藏）");
  });
});

describe("poster filenames", () => {
  it("creates template-specific filesystem-safe names", () => {
    expect(createPosterFilename("  <我的:/作品?>  ", "wechat-card")).toBe(
      "我的-作品-微信横版.png",
    );
    expect(
      createPosterFilename("月亮花园", "xiaohongshu-poster"),
    ).toBe("月亮花园-小红书竖版.png");
  });

  it("does not leak URLs and handles reserved Windows names", () => {
    expect(
      createPosterFilename(
        "https://private.example/storage/art.png",
        "wechat-card",
      ),
    ).not.toContain("private.example");
    expect(createPosterFilename("CON", "wechat-card")).toBe(
      "作品-微信横版.png",
    );
  });
});

describe("poster layouts", () => {
  it("provides distinct horizontal and vertical template bounds", () => {
    const wechat = getPosterLayout("wechat-card");
    const xiaohongshu = getPosterLayout("xiaohongshu-poster");

    expect(wechat.orientation).toBe("horizontal");
    expect(wechat.width).toBeGreaterThan(wechat.height);
    expect(xiaohongshu.orientation).toBe("vertical");
    expect(xiaohongshu.height).toBeGreaterThan(xiaohongshu.width);
    expect(wechat.template).not.toBe(xiaohongshu.template);

    for (const layout of [wechat, xiaohongshu]) {
      expect(layout.artwork.x).toBeGreaterThanOrEqual(0);
      expect(layout.artwork.y).toBeGreaterThanOrEqual(0);
      expect(layout.artwork.x + layout.artwork.width).toBeLessThanOrEqual(
        layout.width,
      );
      expect(layout.artwork.y + layout.artwork.height).toBeLessThanOrEqual(
        layout.height,
      );
      expect(layout.footerY).toBeLessThan(layout.height);
    }
  });

  it("returns layout copies that callers cannot use to alter future layouts", () => {
    const layout = getPosterLayout("wechat-card");
    layout.artwork.x = -100;

    expect(getPosterLayout("wechat-card").artwork.x).toBe(60);
  });
});
