import sharp from "sharp";
import { photoByteLimit } from "../../../src/lib/requests/photo-limits";

export async function enquiryPhotoFixture() {
  const drawing = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560">
    <rect width="800" height="560" fill="#344347"/>
    <path fill="#e2ddd0" d="M70 415h660v65H70z"/>
    <path fill="#90a5aa" stroke="#192225" stroke-width="6" d="M120 309l90-99 52-1-5 32h385l41 45-41 46H254l-42 32z"/>
    <path fill="none" stroke="#dce2e1" stroke-width="5" d="M260 252h372l33 34m-527 17l79-86"/>
    <text x="99" y="458" font-size="29" font-family="sans-serif" letter-spacing="4" fill="#263235">DEMO BLADE</text>
    </svg>`);
  return {
    name: "demo-blade.png",
    mimeType: "image/png",
    buffer: await sharp(drawing).resize(2400, 1680).png().toBuffer(),
  };
}

export async function maxSizeEnquiryJpeg() {
  const jpeg = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#546666" } }).jpeg().toBuffer();
  const chunks = [jpeg.subarray(0, 2)];
  let remaining = photoByteLimit - jpeg.length;
  while (remaining > 0) {
    const size = remaining <= 60_004 ? remaining : 60_000;
    const comment = Buffer.alloc(size);
    comment.writeUInt16BE(0xfffe, 0);
    comment.writeUInt16BE(size - 2, 2);
    chunks.push(comment);
    remaining -= size;
  }
  return Buffer.concat([...chunks, jpeg.subarray(2)]).toString("base64");
}
