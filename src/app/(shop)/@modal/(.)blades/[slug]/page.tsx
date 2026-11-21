import { getFamily } from "@/lib/catalogue/server";
import { ProductDetail } from "@/components/product-detail";
import { ProductDialog } from "@/components/product-dialog";
import { queryValue, type RouteQuery } from "@/lib/catalogue";


type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RouteQuery>;
};

// A card opened from a catalogue page shows the approved dialog over it.
// A direct visit to the same address renders the full blade page.
export default async function ProductModal({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const family = await getFamily(slug);
  if (!family) {
    return (
      <ProductDialog>
        <div className="dialog-scroll">
          <h2 id="detail-title">Blade not available</h2>
          <p>This blade is no longer listed. Close this window and refresh the catalogue to see the current range.</p>
        </div>
      </ProductDialog>
    );
  }
  const variant = queryValue(query.variant);
  return (
    <ProductDialog>
      <ProductDetail key={family.slug + variant} family={family} initialSku={variant} mode="dialog" />
    </ProductDialog>
  );
}
