import "server-only";
import sharp from "sharp";
import { photoByteLimit, photoEdgeLimit } from "./photo-limits";

export async function sanitiseEnquiryPhoto(file: File): Promise<Buffer | null> {
  if (file.type !== "image/jpeg" || file.size < 3 || file.size > photoByteLimit) return null;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    if (input[0] !== 0xff || input[1] !== 0xd8 || input[2] !== 0xff) return null;
    const image = sharp(input, { limitInputPixels: photoEdgeLimit ** 2, failOn: "warning" });
    const { width, height, format } = await image.metadata();
    if (format !== "jpeg" || !width || !height || Math.max(width, height) > photoEdgeLimit) return null;
    for (const quality of [82, 66, 50]) {
      const output = await image.clone().autoOrient().jpeg({ quality, mozjpeg: true }).toBuffer();
      if (output.length <= photoByteLimit) return output;
    }
    return null;
  } catch {
    return null;
  }
}

export async function enquiryPhotoThumbnail(photo: ArrayBuffer) {
  return sharp(Buffer.from(photo)).resize(320, 240, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer();
}
