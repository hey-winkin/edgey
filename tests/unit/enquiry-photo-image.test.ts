import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { sanitiseEnquiryPhoto } from "@/lib/requests/photo-image";
import { photoByteLimit, photoEdgeLimit } from "@/lib/requests/photo-limits";

vi.mock("server-only", () => ({}));

function photo(data: Buffer, type = "image/jpeg") {
  return new File([new Uint8Array(data)], "fixture.jpg", { type });
}

describe("enquiry photo sanitisation", () => {
  it("honours rotation and discards source EXIF, GPS, XMP and ICC", async () => {
    const source = await sharp({ create: { width: 96, height: 48, channels: 3, background: "#809090" } })
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD0: { Artist: "Synthetic camera metadata" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "1/1 2/1 3/1" },
      })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')
      .jpeg().toBuffer();
    const before = await sharp(source).metadata();
    expect(before.exif?.length).toBeGreaterThan(0);
    expect(before.xmp?.length).toBeGreaterThan(0);
    expect(before.icc?.length).toBeGreaterThan(0);
    const clean = await sanitiseEnquiryPhoto(photo(source));
    expect(clean).not.toBeNull();
    const after = await sharp(clean!).metadata();
    expect(after).toMatchObject({ format: "jpeg", width: 48, height: 96 });
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
  });

  it("rejects non-JPEG bytes, malformed JPEGs, and pixel or byte limit violations", async () => {
    const image = sharp({ create: { width: photoEdgeLimit + 1, height: 2, channels: 3, background: "#fff" } });
    expect(await sanitiseEnquiryPhoto(photo(await image.clone().png().toBuffer()))).toBeNull();
    expect(await sanitiseEnquiryPhoto(photo(Buffer.from([255, 216, 255, 0])))).toBeNull();
    expect(await sanitiseEnquiryPhoto(photo(await image.jpeg().toBuffer()))).toBeNull();
    expect(await sanitiseEnquiryPhoto(photo(Buffer.alloc(photoByteLimit + 1)))).toBeNull();
  });
});
