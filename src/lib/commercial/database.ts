import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { serviceClient } from "@/lib/supabase/service";
import type { ReturnCategory } from "./returns";

type Public = Database["public"];
type Returns = Public["Tables"]["order_returns"];
type ReturnRow = Returns["Row"] & {
  reason_category: ReturnCategory | null;
  reported_lookup_code: string | null;
  reported_public_lookup_code: string | null;
};
type Rpc<Args, Result> = { Args: Args; Returns: Result };

export type CommercialMeasures = {
  finder: { exact: number; suggested: number; unmatched: number; converted: number; linkedWithoutAuthorisation: number; noLink: number };
  trials: { dispatched: number; linked: number; firstPurchases: number };
  dispatch: { total: number; withPromise: number; onTime: number };
  uncategorisedReturns: number;
  wrongFit: { sku: string; code: string | null; units: number; records: number }[];
};

export type TrialMailState = "queued" | "retrying" | "sending" | "sent" | "failed" | "unconfirmed" | "withdrawn";
export type TrialMailKey = "confirmation" | "staff_notification" | "trial_approved" | "trial_declined" | "trial_dispatched";

type CommercialDatabase = {
  public: Omit<Public, "Tables" | "Functions"> & {
    Tables: Omit<Public["Tables"], "order_returns"> & { order_returns: Omit<Returns, "Row"> & { Row: ReturnRow } };
    Functions: Omit<Public["Functions"], keyof CommercialFunctions> & CommercialFunctions;
  };
};

type CommercialFunctions = {
  record_exact_finder_search: Rpc<{ p_code: string; p_variant_ids: string[] }, string | null>;
  link_finder_checkout: Rpc<{ p_event_id: string; p_order_id: string; p_attempt_token: string; p_buyer_id?: string }, boolean>;
  record_structured_return: Rpc<{
    p_order_id: string; p_return_id: string; p_variant_id: string; p_quantity: number;
    p_reason_category: ReturnCategory; p_reason: string; p_reported_lookup_code?: string;
  }, ReturnRow>;
  admin_commercial_measures: Rpc<Record<never, never>, CommercialMeasures>;
  admin_trial_mail_status: Rpc<{ p_trial_request_id: string }, {
    message_key: TrialMailKey; status: TrialMailState; sent_at: string | null;
  }[]>;
  admin_create_draft_variant: Rpc<{
    p_product_id: string; p_sku: string; p_option_label: string | null;
    p_price_1_4: number; p_price_5_9: number; p_price_10_plus: number;
  }, string>;
};

export function commercialDb(db: SupabaseClient<Database> = serviceClient()) {
  return db as unknown as SupabaseClient<CommercialDatabase>;
}
