import { photoByteLimit, photoEdgeLimit } from "./photo-limits";

const types = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const photoAccept = [...types, ".heic", ".heif"].join(",");
const originalLimit = 24 * 1024 * 1024;

export async function prepareEnquiryPhoto(file: File) {
  if (!types.includes(file.type) && !(!file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))) {
    throw new Error("Choose a JPEG, PNG, WebP or HEIC photo.");
  }
  if (file.size > originalLimit) throw new Error("Choose a photo under 24 MB.");

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("This photo couldn’t be opened. Try a JPEG or PNG.");
    }
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width * height > 60_000_000) throw new Error("This photo is too large to prepare. Try a smaller one.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Photos can’t be prepared in this browser.");
    for (const edge of [photoEdgeLimit, 1120, 800]) {
      const scale = Math.min(1, edge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.7, 0.56]) {
        const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (jpeg?.type === "image/jpeg" && jpeg.size <= photoByteLimit) return jpeg;
      }
    }
    throw new Error("This photo couldn’t be made small enough. Try a smaller one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
