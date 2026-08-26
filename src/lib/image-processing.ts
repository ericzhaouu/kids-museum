import {
  ARTWORK_IMAGE_EDGE_LIMITS,
  type ProcessedArtworkImage,
} from "@/lib/artworks/contracts";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type ImageEditorState = {
  rotation: 0 | 90 | 180 | 270;
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  focusX: number;
  focusY: number;
};

export type SanitizedImagePreview = {
  dataUrl: string;
  width: number;
  height: number;
};

export type SanitizedImageBundle = ProcessedArtworkImage & {
  preview: SanitizedImagePreview;
};

export const defaultImageEditorState: ImageEditorState = {
  rotation: 0,
  crop: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  },
  focusX: 0.5,
  focusY: 0.5,
};

export async function buildArtworkImageBundle(
  file: File,
  editorState: ImageEditorState = defaultImageEditorState,
): Promise<SanitizedImageBundle> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("仅支持 JPG、PNG 和 WebP 图片。");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("图片不能超过 20 MB。");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const orientedCanvas = renderRotatedImage(image, editorState.rotation);
    const crop = normalizeCrop(editorState.crop);
    const cropRect = cropToPixels(orientedCanvas, crop);

    const original = encodeVariant(orientedCanvas, ARTWORK_IMAGE_EDGE_LIMITS.original);
    const displaySource = cropImage(orientedCanvas, cropRect);
    const display = encodeVariant(displaySource, ARTWORK_IMAGE_EDGE_LIMITS.display);
    const thumbnail = encodeVariant(displaySource, ARTWORK_IMAGE_EDGE_LIMITS.thumbnail);

    return {
      original,
      display,
      thumbnail,
      rotation: editorState.rotation,
      crop,
      focusX: clamp(editorState.focusX),
      focusY: clamp(editorState.focusY),
      preview: display,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("文件读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
}

export function normalizeCrop(crop: ImageEditorState["crop"]) {
  const x = clamp(crop.x);
  const y = clamp(crop.y);
  const width = clamp(crop.width, 0.05, 1);
  const height = clamp(crop.height, 0.05, 1);
  return {
    x: Math.min(x, 1 - width),
    y: Math.min(y, 1 - height),
    width,
    height,
  };
}

function encodeVariant(source: HTMLCanvasElement, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法处理图片。");
  }

  context.drawImage(source, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL("image/webp", maxEdge >= 2000 ? 0.94 : 0.86),
    width,
    height,
  };
}

function cropImage(
  source: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
) {
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法处理图片。");
  }
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  return canvas;
}

function cropToPixels(
  canvas: HTMLCanvasElement,
  crop: ReturnType<typeof normalizeCrop>,
) {
  const x = Math.round(canvas.width * crop.x);
  const y = Math.round(canvas.height * crop.y);
  const width = Math.max(1, Math.round(canvas.width * crop.width));
  const height = Math.max(1, Math.round(canvas.height * crop.height));
  return {
    x: Math.min(x, Math.max(0, canvas.width - width)),
    y: Math.min(y, Math.max(0, canvas.height - height)),
    width,
    height,
  };
}

function renderRotatedImage(
  image: HTMLImageElement,
  rotation: ImageEditorState["rotation"],
) {
  const canvas = document.createElement("canvas");
  const swap = rotation === 90 || rotation === 270;
  canvas.width = swap ? image.height : image.width;
  canvas.height = swap ? image.width : image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法处理图片。");
  }

  context.save();
  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(image, 0, 0);
  context.restore();
  return canvas;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取这张图片，请更换文件。"));
    image.src = source;
  });
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}
