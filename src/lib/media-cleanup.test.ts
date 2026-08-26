import { describe, expect, it, vi } from "vitest";
import { deleteObjectPathsInBatches } from "@/lib/media-cleanup";

describe("deleteObjectPathsInBatches", () => {
  it("removes one job in storage batches of at most 1000 paths", async () => {
    const remove = vi.fn(async (paths: string[]) => {
      void paths;
      return {
      error: null,
      };
    });
    const paths = Array.from({ length: 2001 }, (_, index) => `museum/art/${index}.webp`);

    await expect(deleteObjectPathsInBatches(remove, paths)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove.mock.calls[0]?.[0]).toHaveLength(1000);
    expect(remove.mock.calls[1]?.[0]).toHaveLength(1000);
    expect(remove.mock.calls[2]?.[0]).toHaveLength(1);
  });

  it("fails the whole job when any batch deletion fails", async () => {
    const remove = vi
      .fn<(_: string[]) => Promise<{ error: { message: string } | null }>>()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "boom" } });
    const paths = Array.from({ length: 1501 }, (_, index) => `museum/art/${index}.webp`);

    await expect(deleteObjectPathsInBatches(remove, paths)).rejects.toThrow("boom");
  });
});
