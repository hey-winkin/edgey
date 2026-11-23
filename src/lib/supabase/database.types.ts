import type { Database as GeneratedDatabase } from "./database.generated";

export {
  Constants,
  type CompositeTypes,
  type Enums,
  type Json,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from "./database.generated";

export type StaffPurchaseStatus = "draft" | "sent" | "part_received" | "received" | "closed" | "cancelled";

type Public = GeneratedDatabase["public"];
type Tables = Public["Tables"];
type Views = Public["Views"];
type Functions = Public["Functions"];

type StaffReadOnlyTable =
  | "staff_deliveries"
  | "staff_delivery_lines"
  | "staff_suppliers"
  | "staff_purchase_orders"
  | "staff_purchase_order_costs"
  | "staff_purchase_order_lines"
  | "staff_purchase_order_line_costs"
  | "staff_purchase_order_events"
  | "staff_purchase_buyer_settings"
  | "staff_variant_costs"
  | "staff_receipt_costs"
  | "staff_purchase_receipt_cost_breakdowns"
  | "staff_variant_cost_audit";

type RequiredViewFields<View extends keyof Views, Fields extends keyof Views[View]["Row"]> =
  Omit<Views[View], "Row"> & {
    Row: Views[View]["Row"] & { [Field in Fields]: NonNullable<Views[View]["Row"][Field]> };
  };

type StaffCostFields = "actor_id" | "currency" | "landed_unit_pence" | "recorded_at" | "supplier_unit_minor" | "variant_id";
type CurrentStaffCost = RequiredViewFields<"staff_current_variant_costs", StaffCostFields>;
type StaffViews = {
  staff_current_variant_costs: Omit<CurrentStaffCost, "Row"> & {
    Row: CurrentStaffCost["Row"] & { source: "receipt" | "estimate" };
  };
  staff_effective_receipt_costs: RequiredViewFields<"staff_effective_receipt_costs", StaffCostFields>;
  staff_purchase_order_outstanding: RequiredViewFields<"staff_purchase_order_outstanding", "quantity">;
  staff_purchase_order_stock: RequiredViewFields<"staff_purchase_order_stock", "quantity" | "has_undated">;
};

type NullableFields<Row, Fields extends keyof Row> = {
  [Field in keyof Row]: Field extends Fields ? Row[Field] | null : Row[Field];
};
type NullableArgs<Fn extends keyof Functions, Fields extends keyof Functions[Fn]["Args"]> =
  Omit<Functions[Fn], "Args"> & { Args: NullableFields<Functions[Fn]["Args"], Fields> };

type StaffAuthenticator = Functions["get_staff_authenticator"];
type LastStaffPurchasePrice = Functions["last_staff_purchase_price"];
type StaffFunctions = {
  get_staff_authenticator: Omit<StaffAuthenticator, "Returns"> & {
    Returns: NullableFields<StaffAuthenticator["Returns"][number], "approved_factor_id" | "session_factor_id">[];
  };
  last_staff_purchase_price: Omit<LastStaffPurchasePrice, "Returns"> & { Returns: LastStaffPurchasePrice["Returns"] | null };
  receive_staff_delivery: NullableArgs<"receive_staff_delivery", "p_note">;
  receive_staff_purchase_order: NullableArgs<"receive_staff_purchase_order", "p_note">;
  save_staff_purchase_order: NullableArgs<"save_staff_purchase_order", "p_id">;
  save_staff_supplier: NullableArgs<"save_staff_supplier", "p_id">;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<Public, "Tables" | "Views" | "Functions"> & {
    Tables: {
      [Table in keyof Tables]: Table extends StaffReadOnlyTable
        ? Omit<Tables[Table], "Insert" | "Update"> & {
          Insert: never;
          Update: never;
          Row: Tables[Table]["Row"] & (Table extends "staff_purchase_orders" ? { status: StaffPurchaseStatus } : unknown);
        }
        : Tables[Table];
    };
    Views: Omit<Views, keyof StaffViews> & StaffViews;
    Functions: Omit<Functions, keyof StaffFunctions> & StaffFunctions;
  };
};
