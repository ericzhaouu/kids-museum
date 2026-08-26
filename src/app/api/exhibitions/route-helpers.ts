import { z } from "zod";
import {
  editableExhibitionSchema,
} from "@/lib/exhibition-curation";
import { isExhibitionThemeId } from "@/lib/exhibition-themes";

export const exhibitionRequestSchema = editableExhibitionSchema.superRefine(
  (value, context) => {
    if (!isExhibitionThemeId(value.themeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "展厅主题无效。",
        path: ["themeId"],
      });
    }
  },
);

export function parseExhibitionRequest(input: unknown) {
  return exhibitionRequestSchema.safeParse(input);
}
