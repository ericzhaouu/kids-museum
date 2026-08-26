import type { Artwork } from "@/lib/museum-data";

export type PosterTemplate = "wechat-card" | "xiaohongshu-poster";

export type PosterPrivacyPayload = {
  title: string;
  age: string;
  medium: string;
  description: string;
  childQuote: string;
};

type PosterRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PosterLayout = {
  template: PosterTemplate;
  label: string;
  orientation: "horizontal" | "vertical";
  width: number;
  height: number;
  margin: number;
  headerY: number;
  artwork: PosterRect;
  content: PosterRect;
  footerY: number;
};

export const POSTER_TEMPLATE_OPTIONS = [
  {
    value: "wechat-card",
    label: "微信横版卡片",
    description: "适合微信聊天与朋友圈横向预览",
  },
  {
    value: "xiaohongshu-poster",
    label: "小红书竖版海报",
    description: "适合小红书与手机竖屏浏览",
  },
] as const satisfies ReadonlyArray<{
  value: PosterTemplate;
  label: string;
  description: string;
}>;

const POSTER_LAYOUTS: Record<PosterTemplate, PosterLayout> = {
  "wechat-card": {
    template: "wechat-card",
    label: "微信横版卡片",
    orientation: "horizontal",
    width: 1200,
    height: 900,
    margin: 60,
    headerY: 48,
    artwork: { x: 60, y: 150, width: 620, height: 650 },
    content: { x: 730, y: 170, width: 410, height: 600 },
    footerY: 854,
  },
  "xiaohongshu-poster": {
    template: "xiaohongshu-poster",
    label: "小红书竖版海报",
    orientation: "vertical",
    width: 1080,
    height: 1440,
    margin: 72,
    headerY: 62,
    artwork: { x: 72, y: 190, width: 936, height: 720 },
    content: { x: 72, y: 960, width: 936, height: 400 },
    footerY: 1400,
  },
};

const URL_PATTERN =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s，。；;）)\]}]+|\bdata:[^\s，。；）)\]}]+|\bblob:[^\s，。；;）)\]}]+/giu;
const STORAGE_PATH_PATTERN =
  /(?:\b[a-z]:\\|\/(?:var|home|users?|srv|mnt|media|private|data|storage|uploads?|museum-private)\/)[^\s，。；;）)\]}]+|(?:[\w.-]+[\\/])+(?:[\w.-]+\.(?:avif|gif|heic|jpe?g|pdf|png|svg|webp))\b/giu;
const TOKEN_PATTERN =
  /\b(?:(?:visitor|access|share)\s+token|[\w.-]*token|jwt)\s*[:：=]\s*[^\s，。；;]+/giu;
const BEARER_TOKEN_PATTERN = /\bbearer\s+[a-z0-9._~+/-]+=*/giu;
const EXACT_DATE_PATTERN =
  /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b|(?:19|20)\d{2}年(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12]\d|3[01])日/gu;
const SENSITIVE_LABEL_PATTERN =
  /(?:真实姓名|姓名|出生日期|出生年月日|生日|家长备注|父母备注|true\s+name|birth\s*date|parent\s+notes?)\s*[:：=]\s*[^，。；;\n]+/giu;

export function redactPosterText(value: string) {
  return value
    .replace(URL_PATTERN, "（已隐藏）")
    .replace(STORAGE_PATH_PATTERN, "（已隐藏）")
    .replace(TOKEN_PATTERN, "（已隐藏）")
    .replace(BEARER_TOKEN_PATTERN, "（已隐藏）")
    .replace(EXACT_DATE_PATTERN, "（已隐藏）")
    .replace(SENSITIVE_LABEL_PATTERN, "（已隐藏）")
    .replace(/\s+/g, " ")
    .trim();
}

export function createPosterPrivacyPayload(
  artwork: Pick<
    Artwork,
    "title" | "age" | "medium" | "description" | "childQuote"
  >,
): PosterPrivacyPayload {
  return {
    title: redactPosterText(artwork.title),
    age: redactPosterText(artwork.age),
    medium: redactPosterText(artwork.medium),
    description: redactPosterText(artwork.description),
    childQuote: redactPosterText(artwork.childQuote),
  };
}

export function getPosterLayout(template: PosterTemplate): PosterLayout {
  const layout = POSTER_LAYOUTS[template];
  return {
    ...layout,
    artwork: { ...layout.artwork },
    content: { ...layout.content },
  };
}

export function createPosterFilename(
  title: string,
  template: PosterTemplate,
) {
  const redactedTitle = redactPosterText(title);
  let safeTitle = redactedTitle
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 48)
    .trim();

  if (
    !safeTitle ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(safeTitle)
  ) {
    safeTitle = "作品";
  }

  const templateName =
    template === "wechat-card" ? "微信横版" : "小红书竖版";
  return `${safeTitle}-${templateName}.png`;
}

export async function downloadArtworkPoster(
  artwork: Artwork,
  template: PosterTemplate = "xiaohongshu-poster",
) {
  const layout = getPosterLayout(template);
  const payload = createPosterPrivacyPayload(artwork);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法生成分享海报。");
  }

  const palette = readPosterPalette();
  context.fillStyle = palette.background;
  context.fillRect(0, 0, layout.width, layout.height);

  drawPosterHeader(context, layout, palette);
  await drawPosterArtwork(context, artwork, layout.artwork, palette);
  drawPosterCopy(context, payload, layout, palette);
  drawPosterFooter(context, layout, palette);

  const blob = await canvasToBlob(canvas);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = createPosterFilename(payload.title, template);
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

type PosterPalette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
};

function readPosterPalette(): PosterPalette {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    background: color("--cp-bg", "#f5f1e8"),
    surface: color("--cp-surface", "#fffdf7"),
    text: color("--cp-text", "#292723"),
    muted: color("--cp-text-muted", "#716c63"),
    accent: color("--cp-accent", "#b35432"),
    border: color("--cp-border", "#d8d0c3"),
  };
}

function drawPosterHeader(
  context: CanvasRenderingContext2D,
  layout: PosterLayout,
  palette: PosterPalette,
) {
  const sealSize = 64;
  context.fillStyle = palette.accent;
  context.fillRect(layout.margin, layout.headerY, sealSize, sealSize);
  context.fillStyle = palette.surface;
  context.font = '700 32px "Segoe UI", "Microsoft YaHei", sans-serif';
  context.textAlign = "center";
  context.fillText(
    "童",
    layout.margin + sealSize / 2,
    layout.headerY + sealSize - 18,
  );

  context.textAlign = "left";
  context.fillStyle = palette.text;
  context.font = '600 27px "Segoe UI", "Microsoft YaHei", sans-serif';
  context.fillText(
    "小小博物馆",
    layout.margin + sealSize + 22,
    layout.headerY + 28,
  );
  context.fillStyle = palette.muted;
  context.font = '16px Consolas, "Courier New", monospace';
  context.fillText(
    "A LITTLE MUSEUM OF BIG IDEAS",
    layout.margin + sealSize + 22,
    layout.headerY + 54,
  );

  context.textAlign = "right";
  context.fillStyle = palette.accent;
  context.font = '700 17px "Segoe UI", "Microsoft YaHei", sans-serif';
  context.fillText(
    layout.label,
    layout.width - layout.margin,
    layout.headerY + 38,
  );
  context.textAlign = "left";
}

async function drawPosterArtwork(
  context: CanvasRenderingContext2D,
  artwork: Artwork,
  rect: PosterRect,
  palette: PosterPalette,
) {
  if (artwork.imageUrl?.trim()) {
    const image = await loadArtworkImage(artwork.imageUrl);
    drawRealArtwork(context, image, rect, palette);
    return;
  }

  if (artwork.visual) {
    drawSampleArtwork(context, artwork.visual, rect, palette);
    return;
  }

  throw new Error(
    "这件作品没有可用于海报的图片。示例图形仅用于本地样例作品。",
  );
}

function loadArtworkImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image);
        return;
      }
      reject(new Error("作品图片内容无效，无法生成海报。"));
    };
    image.onerror = () =>
      reject(
        new Error(
          "作品图片加载失败。图片授权可能已过期，或图片服务未允许跨域读取（CORS）；请刷新展览后重试。",
        ),
      );
    image.src = imageUrl;
  });
}

function drawRealArtwork(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: PosterRect,
  palette: PosterPalette,
) {
  const frame = 14;
  const mat = 24;
  context.fillStyle = palette.text;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.fillStyle = palette.surface;
  context.fillRect(
    rect.x + frame,
    rect.y + frame,
    rect.width - frame * 2,
    rect.height - frame * 2,
  );

  const imageRect = {
    x: rect.x + frame + mat,
    y: rect.y + frame + mat,
    width: rect.width - (frame + mat) * 2,
    height: rect.height - (frame + mat) * 2,
  };
  context.fillStyle = palette.background;
  context.fillRect(
    imageRect.x,
    imageRect.y,
    imageRect.width,
    imageRect.height,
  );

  const scale = Math.min(
    imageRect.width / image.naturalWidth,
    imageRect.height / image.naturalHeight,
  );
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(
    image,
    imageRect.x + (imageRect.width - width) / 2,
    imageRect.y + (imageRect.height - height) / 2,
    width,
    height,
  );
}

function drawSampleArtwork(
  context: CanvasRenderingContext2D,
  visual: NonNullable<Artwork["visual"]>,
  rect: PosterRect,
  palette: PosterPalette,
) {
  const frame = Math.max(12, Math.round(rect.width * 0.015));
  const mat = Math.max(28, Math.round(rect.width * 0.04));
  context.fillStyle = palette.text;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.fillStyle = palette.surface;
  context.fillRect(
    rect.x + frame,
    rect.y + frame,
    rect.width - frame * 2,
    rect.height - frame * 2,
  );

  const art = {
    x: rect.x + frame + mat,
    y: rect.y + frame + mat,
    width: rect.width - (frame + mat) * 2,
    height: rect.height - (frame + mat) * 2,
  };
  context.fillStyle = palette.background;
  context.fillRect(art.x, art.y, art.width, art.height);

  const centerX = art.x + art.width / 2;
  const centerY = art.y + art.height / 2;
  context.fillStyle = palette.accent;

  if (visual === "rainbow-city" || visual === "paper-forest") {
    const gap = art.width * 0.035;
    const itemWidth = (art.width - gap * 6) / 5;
    for (let index = 0; index < 5; index += 1) {
      const itemHeight = art.height * (0.36 + (index % 3) * 0.12);
      context.fillRect(
        art.x + gap + index * (itemWidth + gap),
        art.y + art.height - gap - itemHeight,
        itemWidth,
        itemHeight,
      );
    }
  } else if (visual === "moon-garden" || visual === "blue-cat") {
    const radius = Math.min(art.width, art.height) * 0.29;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.surface;
    context.beginPath();
    context.arc(
      centerX - radius * 0.34,
      centerY - radius * 0.14,
      radius * 0.12,
      0,
      Math.PI * 2,
    );
    context.arc(
      centerX + radius * 0.34,
      centerY - radius * 0.14,
      radius * 0.12,
      0,
      Math.PI * 2,
    );
    context.fill();
  } else {
    context.beginPath();
    context.ellipse(
      centerX,
      centerY,
      art.width * 0.36,
      art.height * 0.22,
      -0.12,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = palette.border;
    context.fillRect(
      art.x + art.width * 0.08,
      centerY + art.height * 0.27,
      art.width * 0.84,
      6,
    );
  }
}

function drawPosterCopy(
  context: CanvasRenderingContext2D,
  payload: PosterPrivacyPayload,
  layout: PosterLayout,
  palette: PosterPalette,
) {
  const isHorizontal = layout.orientation === "horizontal";
  const { x, y, width } = layout.content;
  let cursorY = y;

  context.fillStyle = palette.accent;
  context.font = '700 17px Consolas, "Courier New", monospace';
  context.fillText("PRIVATE GALLERY EDITION", x, cursorY);

  cursorY += 48;
  context.fillStyle = palette.text;
  context.font = `${isHorizontal ? 600 : 620} ${
    isHorizontal ? 46 : 52
  }px "Segoe UI", "Microsoft YaHei", sans-serif`;
  cursorY = drawWrappedText(
    context,
    payload.title,
    x,
    cursorY,
    width,
    isHorizontal ? 56 : 58,
    2,
  );

  cursorY += 12;
  context.fillStyle = palette.muted;
  context.font = `${
    isHorizontal ? 20 : 23
  }px "Segoe UI", "Microsoft YaHei", sans-serif`;
  context.fillText(`${payload.age} · ${payload.medium}`, x, cursorY);

  cursorY += 44;
  context.fillStyle = palette.accent;
  context.font = '700 34px Georgia, "Times New Roman", serif';
  context.fillText("“", x, cursorY);
  context.fillStyle = palette.text;
  context.font = `${
    isHorizontal ? 26 : 27
  }px "Segoe UI", "Microsoft YaHei", sans-serif`;
  cursorY = drawWrappedText(
    context,
    payload.childQuote,
    x + 26,
    cursorY,
    width - 26,
    isHorizontal ? 36 : 35,
    isHorizontal ? 3 : 2,
  );

  cursorY += 22;
  context.fillStyle = palette.muted;
  context.font = `${
    isHorizontal ? 19 : 21
  }px "Segoe UI", "Microsoft YaHei", sans-serif`;
  drawWrappedText(
    context,
    payload.description,
    x,
    cursorY,
    width,
    isHorizontal ? 28 : 29,
    isHorizontal ? 6 : 3,
  );
}

function drawPosterFooter(
  context: CanvasRenderingContext2D,
  layout: PosterLayout,
  palette: PosterPalette,
) {
  context.fillStyle = palette.border;
  context.fillRect(
    layout.margin,
    layout.footerY - 30,
    layout.width - layout.margin * 2,
    1,
  );
  context.fillStyle = palette.muted;
  context.font = '16px "Segoe UI", "Microsoft YaHei", sans-serif';
  context.fillText(
    "隐私安全分享 · 不含姓名、生日、访问链接或二维码",
    layout.margin,
    layout.footerY,
  );
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const lines: string[] = [];
  let line = "";
  let truncated = false;

  for (const character of Array.from(text)) {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
      if (lines.length === maxLines) {
        truncated = true;
        break;
      }
    } else {
      line = candidate;
    }
  }

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  if (truncated && lines.length > 0) {
    let lastLine = `${lines.at(-1)}…`;
    while (
      lastLine.length > 1 &&
      context.measureText(lastLine).width > maxWidth
    ) {
      lastLine = `${lastLine.slice(0, -2)}…`;
    }
    lines[lines.length - 1] = lastLine;
  }

  lines.forEach((item, index) => {
    context.fillText(item, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("海报导出失败，请重试。")),
        "image/png",
        0.96,
      );
    } catch {
      reject(
        new Error(
          "海报导出被浏览器阻止。图片服务需要允许跨域导出（CORS），请联系馆长检查图片设置。",
        ),
      );
    }
  });
}
