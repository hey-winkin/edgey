import { AdminHeading, AdminLink } from "@/app/admin/ui";
import { PurchaseEditor } from "../../new/purchase-editor";
import { loadPurchaseEditor } from "../../new/editor-load";

export const metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({ params, searchParams }: PageProps<"/admin/purchase-orders/[id]/edit">) {
  const [{ id }, { variant }] = await Promise.all([params, searchParams]);
  const editor = await loadPurchaseEditor(id, typeof variant === "string" ? variant : undefined);
  const record = `/admin/purchase-orders/${id}`;
  const draft = editor.initial.status === "draft";

  return <>
    <AdminHeading title={`${draft ? "Edit" : "Amend"} ${editor.number}`}
      description={draft ? "Update the order before you mark it sent." : "Changes are recorded. The supplier and currency stay fixed after sending."} />
    <AdminLink href={record}>Back to {editor.number}</AdminLink>
    <PurchaseEditor {...editor} permalink={`${record}/edit`} />
  </>;
}
