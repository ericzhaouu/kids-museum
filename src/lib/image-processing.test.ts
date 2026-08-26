import { describe, expect, it } from "vitest";
import { normalizeCrop } from "@/lib/image-processing";

describe("image editor helpers", () => {
  it("clamps crop values into safe normalized bounds", () => {
    const crop = normalizeCrop({ x: 0.9, y: -1, width: 0.8, height: 2 });
    expect(crop.x).toBeCloseTo(0.2);
    expect(crop).toMatchObject({
      y: 0,
      width: 0.8,
      height: 1,
    });
  });
});
