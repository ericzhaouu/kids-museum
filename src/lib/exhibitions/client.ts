import type {
  EditableExhibition,
  ExhibitionAiSuggestion,
} from "@/lib/exhibition-curation";

export type ExhibitionListResponse = {
  exhibitions: EditableExhibition[];
  activeExhibitionId: string | null;
};

export async function fetchExhibitions() {
  const response = await fetch("/api/exhibitions", { cache: "no-store" });
  const body = (await response.json()) as ExhibitionListResponse | { error: string };
  if (!response.ok || !("exhibitions" in body)) {
    throw new Error("error" in body ? body.error : "展览读取失败。");
  }
  return body;
}

export async function saveExhibitionRequest(payload: EditableExhibition) {
  const response = await fetch("/api/exhibitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as
    | { exhibition: EditableExhibition; publishable: boolean; issues: string[] }
    | { error: string };
  if (!response.ok || !("exhibition" in body)) {
    throw new Error("error" in body ? body.error : "展览保存失败。");
  }
  return body;
}

export async function archiveExhibitionRequest(exhibitionId: string) {
  const response = await fetch(`/api/exhibitions/${exhibitionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "archive" }),
  });
  const body = (await response.json()) as
    | { exhibition: EditableExhibition }
    | { error: string };
  if (!response.ok || !("exhibition" in body)) {
    throw new Error("error" in body ? body.error : "展览归档失败。");
  }
  return body.exhibition;
}

export async function deleteExhibitionRequest(exhibitionId: string) {
  const response = await fetch(`/api/exhibitions/${exhibitionId}`, {
    method: "DELETE",
  });
  const body = (await response.json()) as
    | { deleted: true; activeExhibitionId: string | null }
    | { error: string };
  if (!response.ok || !("deleted" in body)) {
    throw new Error("error" in body ? body.error : "展览删除失败。");
  }
  return body;
}

export async function fetchExhibitionSuggestions(exhibitionId: string) {
  const response = await fetch(`/api/exhibitions/${exhibitionId}/suggestions`, {
    cache: "no-store",
  });
  const body = (await response.json()) as
    | { suggestions: ExhibitionAiSuggestion[]; sourceVersion: number }
    | { error: string };
  if (!response.ok || !("suggestions" in body)) {
    throw new Error("error" in body ? body.error : "策展建议读取失败。");
  }
  return body;
}

export async function generateExhibitionSuggestions(exhibitionId: string) {
  const response = await fetch(`/api/exhibitions/${exhibitionId}/suggestions`, {
    method: "POST",
  });
  const body = (await response.json()) as
    | { suggestions: ExhibitionAiSuggestion[]; sourceVersion: number }
    | { error: string };
  if (!response.ok || !("suggestions" in body)) {
    throw new Error("error" in body ? body.error : "策展建议生成失败。");
  }
  return body;
}

export async function reviewExhibitionSuggestion(
  suggestionId: string,
  action: "accept" | "reject",
) {
  const response = await fetch(`/api/exhibitions/suggestions/${suggestionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = (await response.json()) as
    | { reviewed: true; exhibition: EditableExhibition; suggestions: ExhibitionAiSuggestion[] }
    | { error: string };
  if (!response.ok || !("reviewed" in body)) {
    throw new Error("error" in body ? body.error : "策展建议审核失败。");
  }
  return body;
}
