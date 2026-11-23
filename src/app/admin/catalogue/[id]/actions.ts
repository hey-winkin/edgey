"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/auth";
import { catalogueId, mutateAdminCatalogue } from "@/lib/admin/catalogue";
import { emptyTierPrices, parseTierPrices } from "@/lib/admin/price-tiers";

type State = { message: string; ok: boolean };
class CatalogueInputError extends Error {}

const feedback: Record<string, string> = {
  catalogue_role_required: "Catalogue permission is required.",
  catalogue_stale: "This record changed since you opened it. Reload the page before trying again.",
  catalogue_variant_not_found: "This variant no longer exists.",
  catalogue_mapping_not_found: "This reference does not belong to this variant.",
  catalogue_invalid_selling_data: "Check the selling data, dimensions and price tiers.",
  catalogue_review_evidence_required: "Enter a verified source and a note explaining your decision.",
  catalogue_mapping_brand_required: "Choose the OEM brand before approving a public reference.",
  catalogue_invalid_publication: "An archived variant cannot be published or returned to draft here.",
  catalogue_variant_not_approved: "Approve the variant with supporting evidence before publishing.",
  catalogue_incomplete_selling_data: "Complete the family name and description, supplier details, tool or holder, verified dimensions or specifications and materials. Give each option in a multi-variant family a distinct label.",
  catalogue_verified_fit_required: "Approve at least one public OEM reference with a brand before publishing. Private aliases do not count.",
};

function field(data: FormData, name: string, limit: number) {
  const value = data.get(name);
  if (value === null) return "";
  if (typeof value !== "string" || value.trim().length > limit) throw new CatalogueInputError("Check the length of the entries and try again.");
  return value.trim();
}

function version(data: FormData, name: string) {
  const value = field(data, name, 60);
  if (!value || !Number.isFinite(Date.parse(value))) throw new CatalogueInputError("Reload the page and try again.");
  return value;
}

function dimension(data: FormData, name: string, angle = false) {
  const value = field(data, name, 6);
  if (!value) return null;
  const numeric = Number(value);
  if (!(angle ? /^(?:\d{1,3}|\d{0,3}\.\d)$/ : /^(?:\d{1,3}|\d{0,3}\.\d{1,2})$/).test(value)
    || numeric <= 0 || (angle && numeric >= 180)) {
    throw new CatalogueInputError("Enter positive measurements, with at most one decimal place for angles or two for millimetres.");
  }
  return numeric;
}

function sellingData(data: FormData) {
  const specs = new Map<string, string>();
  for (const line of field(data, "specs", 4000).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    const label = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (colon < 0 || !label || label.length > 80 || !value || value.length > 240 || specs.has(label)) {
      throw new CatalogueInputError("Enter each extra specification on its own line as “Label: value”, with no repeated labels.");
    }
    specs.set(label, value);
  }

  const substrates = data.getAll("substrates").map((value) => {
    if (typeof value !== "string" || !/^[a-z0-9-]{1,100}$/.test(value)) throw new CatalogueInputError("Choose materials from the list.");
    return value;
  });

  const prices = parseTierPrices(data);
  if (!prices.ok) throw new CatalogueInputError(prices.message);

  return {
    name: field(data, "name", 160),
    description: field(data, "description", 2000),
    tool_category: field(data, "tool_category", 100),
    option_label: field(data, "option_label", 160),
    tool: field(data, "tool", 160),
    supplier_name: field(data, "supplier_name", 160),
    supplier_part_number: field(data, "supplier_part_number", 160),
    angle_deg: dimension(data, "angle_deg", true),
    shank_mm: dimension(data, "shank_mm"),
    cutting_depth_mm: dimension(data, "cutting_depth_mm"),
    blade_thickness_mm: dimension(data, "blade_thickness_mm"),
    diameter_mm: dimension(data, "diameter_mm"),
    specs: Object.fromEntries(specs), substrates, ...(prices.value ?? emptyTierPrices),
  };
}

export async function editCatalogueVariant(id: string, _previous: State | null, data: FormData): Promise<State> {
  const { userId } = await requireStaff("catalogue");
  if (!catalogueId.test(id)) return { ok: false, message: "This variant does not exist." };

  const operation = data.get("operation");
  try {
    const args = { p_actor_id: userId, p_variant_id: id, p_expected_updated_at: version(data, "version") };
    if (operation === "save") {
      const result = await mutateAdminCatalogue("admin_catalogue_update", {
        ...args, p_expected_product_updated_at: version(data, "familyVersion"), p_selling: sellingData(data),
      });
      return finish(id, result, "Selling data saved.");
    }
    if (operation === "approve" || operation === "reject") {
      if (operation === "reject" && data.get("confirmReject") !== "yes") {
        return { ok: false, message: "Confirm the consequence before recording a rejection." };
      }
      const mappingId = field(data, "mappingId", 36);
      if (mappingId && !catalogueId.test(mappingId)) return { ok: false, message: "This compatibility reference does not exist." };
      const source = field(data, "source", 240);
      const note = field(data, "note", 2000);
      if (!source || !note) return { ok: false, message: feedback.catalogue_review_evidence_required! };
      const result = await mutateAdminCatalogue("admin_catalogue_review", {
        ...args,
        p_approve: operation === "approve",
        p_evidence_source: source,
        p_evidence_note: note,
        ...(mappingId ? {
          p_compatibility_id: mappingId,
          p_expected_mapping_updated_at: version(data, "mappingVersion"),
          p_evidence_url: field(data, "url", 500) || undefined,
          p_brand: field(data, "brand", 100) || undefined,
          p_machine: field(data, "machine", 160) || undefined,
          p_tool: field(data, "tool", 160) || undefined,
          p_adapter: field(data, "adapter", 160) || undefined,
        } : {}),
      });
      return finish(id, result, operation === "approve" ? "Approval recorded." : "Rejection recorded.");
    }
    if (operation === "publish" || operation === "unpublish") {
      if (operation === "unpublish" && data.get("confirm") !== "yes") {
        return { ok: false, message: "Confirm that this SKU should return to draft." };
      }
      const result = await mutateAdminCatalogue("admin_catalogue_set_publication", { ...args, p_publish: operation === "publish" });
      return finish(id, result, operation === "publish" ? "Variant published." : "Variant unpublished.");
    }
  } catch (error) {
    return { ok: false, message: error instanceof CatalogueInputError ? error.message : "Could not save this catalogue change." };
  }
  return { ok: false, message: "Choose a catalogue action." };
}

function finish(id: string, result: { data: string | null; error: { code: string; message: string } | null }, message: string): State {
  if (result.error || !result.data) {
    const error = result.error;
    if (error?.code === "23514" && error.message.includes("variants_prices_required_outside_draft")) {
      return { ok: false, message: "Set all three price tiers before publishing." };
    }
    const validationError = error?.code === "23503" || error?.code === "22P02" || error?.code === "22003";
    return {
      ok: false,
      message: (error && Object.hasOwn(feedback, error.message) ? feedback[error.message] : undefined)
        ?? (validationError ? "Check the selected options and measurements." : "Could not save this catalogue change."),
    };
  }
  for (const path of ["/", "/blades", `/blades/${result.data}`, "/admin/catalogue", `/admin/catalogue/${id}`]) {
    revalidatePath(path);
  }
  return { ok: true, message };
}
