export const exhibitionThemeOptions = [
  { value: "warm-gallery", label: "温暖画廊" },
  { value: "white-box", label: "白盒展室" },
  { value: "storybook", label: "童画手帐" },
] as const;

export type ExhibitionThemeId = (typeof exhibitionThemeOptions)[number]["value"];

export function isExhibitionThemeId(
  value: string,
): value is ExhibitionThemeId {
  return exhibitionThemeOptions.some((option) => option.value === value);
}
