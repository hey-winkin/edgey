import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";

type Public = Database["public"];
type Tables = Public["Tables"];
type WithFields<K extends keyof Tables, Fields> = Omit<Tables[K], "Row"> & { Row: Tables[K]["Row"] & Fields };
type Rpc<Args, Returns = string> = { Args: Args; Returns: Returns };

type RequestDatabase = {
  public: Omit<Public, "Tables" | "Functions"> & {
    Tables: Omit<Tables, "enquiries" | "trial_requests" | "order_outbox"> & {
      enquiries: WithFields<"enquiries", { matched_variant_id: string | null }>;
      trial_requests: WithFields<"trial_requests", {
        eligibility: "eligible" | "declined" | null;
        reviewed_variant_ids: string[] | null;
        reviewed_at: string | null;
      }>;
      order_outbox: WithFields<"order_outbox", { message_subject: string | null; message_body: string | null }>;
    };
    Functions: Public["Functions"] & {
      admin_trial_duplicate_evidence: Rpc<{ p_trial_request_id: string }, {
        id: string; company: string; created_at: string;
        same_email: boolean; same_company: boolean; same_postcode: boolean;
      }[]>;
      admin_trial_order_candidates: Rpc<{ p_trial_request_id: string; p_actor_id: string }, {
        id: string; created_at: string; match_kind: "verified_account_email" | "order_email";
      }[]>;
      review_admin_trial: Rpc<{
        p_trial_request_id: string; p_actor_id: string; p_decision: string; p_reason: string;
        p_variant_ids: string[]; p_expected_updated_at: string;
      }>;
      unlink_trial_order: Rpc<{ p_trial_request_id: string; p_order_id: string; p_actor_id: string }>;
      handle_admin_enquiry: Rpc<{
        p_enquiry_id: string; p_actor_id: string; p_action: string; p_expected_updated_at: string;
        p_operation_key?: string; p_reply?: string; p_variant_id?: string; p_candidate_code?: string;
      }>;
    };
  };
};

export type EnquiryMutation = RequestDatabase["public"]["Functions"]["handle_admin_enquiry"]["Args"];

export function requestsDb(db: SupabaseClient<Database> = serviceClient()) {
  return db as unknown as SupabaseClient<RequestDatabase>;
}
