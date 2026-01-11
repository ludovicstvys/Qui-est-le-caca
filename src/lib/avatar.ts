export async function fileToAvatarDataUrl(file: File, size = 128, quality = 0.82): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Image trop lourde (max 5MB).");

  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non supporté.");

  const { sx, sy, sSize } = computeCoverCrop(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, size, size);

  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;

  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Impossible de lire l'image."));
    img.src = url;
  });
}

function computeCoverCrop(w: number, h: number) {
  const sSize = Math.min(w, h);
  const sx = Math.floor((w - sSize) / 2);
  const sy = Math.floor((h - sSize) / 2);
  return { sx, sy, sSize };
}
