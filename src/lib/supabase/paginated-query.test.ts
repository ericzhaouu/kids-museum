import { describe, expect, it, vi } from "vitest";
import { readAllPages } from "@/lib/supabase/paginated-query";

describe("readAllPages", () => {
  it("keeps paging past Supabase's local 1000-row window until exhausted", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => ({ id: index + 1 }));
    const loadPage = vi.fn(async ({ from, to }: { from: number; to: number }) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));

    await expect(
      readAllPages(loadPage, { pageSize: 500, label: "测试分页" }),
    ).resolves.toHaveLength(1201);
    expect(loadPage).toHaveBeenCalledTimes(3);
    expect(loadPage).toHaveBeenNthCalledWith(1, { from: 0, to: 499 });
    expect(loadPage).toHaveBeenNthCalledWith(2, { from: 500, to: 999 });
    expect(loadPage).toHaveBeenNthCalledWith(3, { from: 1000, to: 1499 });
  });
});
