import { z } from "zod";

export const DELETE_MUSEUM_CONFIRMATION_PHRASE = "DELETE MUSEUM";
export const NO_MUSEUM_PROFILE_MESSAGE =
  "当前账号尚未初始化博物馆，请先创建新的馆藏空间。";

export const initializeMuseumPayloadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  artistNickname: z.string().trim().min(1).max(40),
  themeId: z.string().trim().min(1).max(80).default("warm-gallery"),
});

export const deleteMuseumPayloadSchema = z.object({
  confirmationText: z.string().trim().min(1).max(160),
});

export type CuratorMuseumProfile = {
  id: string;
  name: string;
  artistNickname: string;
  themeId: string;
  themeVersion: number;
  createdAt: string;
  updatedAt: string;
};

export function matchesMuseumDeleteConfirmation(
  confirmationText: string,
  museumName: string,
) {
  const normalizedInput = confirmationText.trim().toLowerCase();
  const normalizedMuseumName = museumName.trim().toLowerCase();
  return (
    normalizedInput === normalizedMuseumName ||
    normalizedInput === DELETE_MUSEUM_CONFIRMATION_PHRASE.toLowerCase()
  );
}
