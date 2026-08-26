import { describe, expect, it } from "vitest";
import {
  DELETE_MUSEUM_CONFIRMATION_PHRASE,
  matchesMuseumDeleteConfirmation,
} from "@/lib/museum-management";

describe("museum deletion confirmation", () => {
  it("accepts either the museum name or the fixed destructive phrase", () => {
    expect(matchesMuseumDeleteConfirmation("兮爷的小小博物馆", "兮爷的小小博物馆")).toBe(true);
    expect(
      matchesMuseumDeleteConfirmation(
        DELETE_MUSEUM_CONFIRMATION_PHRASE,
        "兮爷的小小博物馆",
      ),
    ).toBe(true);
  });

  it("rejects unrelated confirmation text", () => {
    expect(matchesMuseumDeleteConfirmation("delete", "兮爷的小小博物馆")).toBe(false);
  });
});
