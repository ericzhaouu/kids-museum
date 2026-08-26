import type { ArtworkVisual as ArtworkVisualName } from "@/lib/museum-data";

type ArtworkVisualProps = {
  visual: ArtworkVisualName;
  title: string;
};

export function ArtworkVisual({ visual, title }: ArtworkVisualProps) {
  return (
    <div
      className={`art-visual art-visual--${visual}`}
      role="img"
      aria-label={`${title}的示意画`}
    >
      <span className="art-shape art-shape--one" />
      <span className="art-shape art-shape--two" />
      <span className="art-shape art-shape--three" />
      <span className="art-shape art-shape--four" />
      <span className="art-stroke art-stroke--one" />
      <span className="art-stroke art-stroke--two" />
    </div>
  );
}
