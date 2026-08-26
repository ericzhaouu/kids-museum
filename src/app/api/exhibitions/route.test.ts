import { describe, expect, it } from "vitest";
import { parseExhibitionRequest } from "@/app/api/exhibitions/route-helpers";

describe("exhibition request validation", () => {
  it("accepts nested display config for room artworks", () => {
    const parsed = parseExhibitionRequest({
      title: "会说晚安的美术馆",
      subtitle: "",
      introduction: "把今晚想留下来的画都放进来。",
      status: "draft",
      themeId: "warm-gallery",
      rooms: [
        {
          id: crypto.randomUUID(),
          name: "第一间",
          subtitle: "",
          introduction: "",
          artworks: [
            {
              artworkId: crypto.randomUUID(),
              displayConfig: {
                featured: true,
                size: "large",
                framePreset: "shadow",
              },
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid theme ids and invalid display config values", () => {
    const invalidTheme = parseExhibitionRequest({
      title: "会说晚安的美术馆",
      subtitle: "",
      introduction: "把今晚想留下来的画都放进来。",
      status: "draft",
      themeId: "not-a-theme",
      rooms: [
        {
          id: crypto.randomUUID(),
          name: "第一间",
          subtitle: "",
          introduction: "",
          artworks: [{ artworkId: crypto.randomUUID() }],
        },
      ],
    });
    expect(invalidTheme.success).toBe(false);

    const invalidDisplayConfig = parseExhibitionRequest({
      title: "会说晚安的美术馆",
      subtitle: "",
      introduction: "把今晚想留下来的画都放进来。",
      status: "draft",
      themeId: "warm-gallery",
      rooms: [
        {
          id: crypto.randomUUID(),
          name: "第一间",
          subtitle: "",
          introduction: "",
          artworks: [
            {
              artworkId: crypto.randomUUID(),
              displayConfig: {
                size: "giant",
              },
            },
          ],
        },
      ],
    });

    expect(invalidDisplayConfig.success).toBe(false);
  });
});
