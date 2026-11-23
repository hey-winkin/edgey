import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getFamily } from "@/lib/catalogue/server";
import { shareImageSize } from "@/lib/catalogue/social";
import tokens from "../../../design-tokens.json";

const { dark, light } = tokens.themes;

function svgUrl(svg: string) {
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("blade");
  const family = slug ? await getFamily(slug) : null;
  const sku = searchParams.get("variant");
  const variant = family?.variants.find((item) => item.sku === sku);
  if ((slug !== null || sku !== null) && !variant) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const drawing = variant ? (variant.media ?? family?.media)?.drawing : "drag-line.svg";
  const [mark, artwork, inter, mono] = await Promise.all([
    readFile(join(process.cwd(), "assets", "edgey-wire.svg"), "utf8"),
    drawing && /^[a-z\d][a-z\d_-]*\.svg$/i.test(drawing)
      ? readFile(join(process.cwd(), "public", "line-art", drawing), "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        })
      : null,
    readFile(join(process.cwd(), "src/lib/admin/purchase-fonts/inter/Inter-Regular.ttf")),
    readFile(join(process.cwd(), "src/lib/admin/purchase-fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf")),
  ]);
  const title = family?.name ?? "The cutting room.";
  const titleSize = title.length > 96 ? 38 : title.length > 56 ? 48 : 62;

  return new ImageResponse(
    /* eslint-disable @next/next/no-img-element */
    <div style={{ display: "flex", width: "100%", height: "100%", padding: 60, background: dark.page, color: dark.text, fontFamily: "Inter" }}>
      <div style={{ display: "flex", width: "100%", borderTop: "1px solid " + dark.rule, borderBottom: "1px solid " + dark.rule, alignItems: "center", padding: "34px 0", gap: 42 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", width: 498 }}>
          <img alt="" src={svgUrl(mark.replace("currentColor", dark.text))} width={214} height={75} />
          <div style={{ display: "flex", marginTop: 36, gap: 12, alignItems: "center", color: dark.textMuted, fontFamily: "IBM Plex Mono", fontSize: 20, letterSpacing: "0.08em" }}>
            <div style={{ width: 11, height: 11, border: "1px solid " + dark.textMuted }} />
            {variant ? "EDGEY SKU: " + variant.sku : "DIGITAL CUTTER TOOLING"}
          </div>
          <div style={{ marginTop: 14, fontSize: titleSize, letterSpacing: "-0.055em", lineHeight: 1.05, overflowWrap: "break-word" }}>
            {title}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 540, height: 390, background: light.drawingPlate, color: light.text, border: "1px solid " + light.rule }}>
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
            {artwork
              ? <img alt="" src={svgUrl(artwork)} width={484} height={266} />
              : <span style={{ fontFamily: "IBM Plex Mono", fontSize: 31, letterSpacing: "0.055em", maxWidth: 456, overflowWrap: "break-word" }}>{variant?.sku}</span>}
          </div>
          <div style={{ display: "flex", borderTop: "1px solid " + light.rule, padding: "16px 24px", fontFamily: "IBM Plex Mono", fontSize: 17, letterSpacing: "0.08em", color: light.textMuted }}>
            {variant ? (artwork ? "LINE DRAWING · NOT TO SCALE" : "PART IDENTIFICATION") : "BLADE CATALOGUE"}
          </div>
        </div>
      </div>
    </div>,
    /* eslint-enable @next/next/no-img-element */
    {
      ...shareImageSize,
      fonts: [
        { name: "Inter", data: inter, style: "normal", weight: 400 },
        { name: "IBM Plex Mono", data: mono, style: "normal", weight: 400 },
      ],
      headers: { "Cache-Control": variant ? "no-store" : "public, max-age=86400" },
    },
  );
}
