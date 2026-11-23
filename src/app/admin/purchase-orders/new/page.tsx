import { AdminHeading, AdminLink } from "@/app/admin/ui";
import { PurchaseEditor } from "./purchase-editor";
import { loadPurchaseEditor } from "./editor-load";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({ searchParams }: PageProps<"/admin/purchase-orders/new">) {
  const { variant, variants } = await searchParams;
  const editor = await loadPurchaseEditor(undefined, typeof variant === "string" ? variant : undefined, variants);

  return <>
    <AdminHeading title="New purchase order"
      description="Choose blades from the catalogue, enter the quantities and supplier prices, then save a draft." />
    <AdminLink href="/admin/purchase-orders">Purchase orders</AdminLink>
    <PurchaseEditor {...editor} permalink="/admin/purchase-orders/new" />
  </>;
}
