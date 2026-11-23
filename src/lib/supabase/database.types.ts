export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type StaffUnitCost = {
  variant_id: string;
  supplier_unit_minor: number;
  currency: string;
  landed_unit_pence: number;
  exchange_rate: number | null;
  freight_unit_pence: number | null;
  duty_unit_pence: number | null;
  note: string | null;
  actor_id: string;
  recorded_at: string;
};

type ReadOnlyTable<Row, Relationships = []> = { Row: Row; Insert: never; Update: never; Relationships: Relationships };

export type StaffPurchaseStatus = "draft" | "sent" | "part_received" | "received" | "closed" | "cancelled";

export type Database = {
  public: {
    Tables: {
      delivery_calendars: {
        Row: {
          active_from: string;
          active_through: string;
          bank_holidays: string[];
          calendar: string;
          closures: string[];
          cutoff_minutes: number | null;
          working_weekdays: number[];
        };
        Insert: Omit<Database["public"]["Tables"]["delivery_calendars"]["Row"], "cutoff_minutes"> & { cutoff_minutes?: number | null };
        Update: Partial<Database["public"]["Tables"]["delivery_calendars"]["Row"]>;
        Relationships: [];
      };
      delivery_rules: {
        Row: {
          charge_ex_vat_pence: number | null;
          code: string;
          dispatch_carrier: string | null;
          kind: string;
          scope: string;
          service_name: string | null;
          working_days: number | null;
        };
        Insert: {
          charge_ex_vat_pence?: number | null;
          code: string;
          dispatch_carrier?: string | null;
          kind: string;
          scope: string;
          service_name?: string | null;
          working_days?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["delivery_rules"]["Row"]>;
        Relationships: [];
      };
      brands: {
        Row: {
          name: string;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          name: string;
          slug: string;
        };
        Update: {
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      compatibility: {
        Row: {
          adapter: string | null;
          approved_at: string | null;
          approved_by: string | null;
          brand: string | null;
          code: string;
          code_kind: Database["public"]["Enums"]["compatibility_code_kind"];
          code_normalised: string | null;
          created_at: string;
          evidence_note: string | null;
          evidence_source: string | null;
          evidence_url: string | null;
          id: string;
          is_private: boolean;
          machine: string | null;
          rejected_at: string | null;
          rejected_by: string | null;
          tool: string | null;
          updated_at: string;
          variant_id: string;
          verification_state: Database["public"]["Enums"]["verification_state"];
        };
        ComputedFields: never;
        Insert: {
          adapter?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          brand?: string | null;
          code: string;
          code_kind?: Database["public"]["Enums"]["compatibility_code_kind"];
          code_normalised?: never;
          created_at?: string;
          evidence_note?: string | null;
          evidence_source?: string | null;
          evidence_url?: string | null;
          id?: string;
          is_private?: boolean;
          machine?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          tool?: string | null;
          updated_at?: string;
          variant_id: string;
          verification_state?: Database["public"]["Enums"]["verification_state"];
        };
        Update: {
          adapter?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          brand?: string | null;
          code?: string;
          code_kind?: Database["public"]["Enums"]["compatibility_code_kind"];
          code_normalised?: never;
          created_at?: string;
          evidence_note?: string | null;
          evidence_source?: string | null;
          evidence_url?: string | null;
          id?: string;
          is_private?: boolean;
          machine?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          tool?: string | null;
          updated_at?: string;
          variant_id?: string;
          verification_state?: Database["public"]["Enums"]["verification_state"];
        };
        Relationships: [
          {
            foreignKeyName: "compatibility_brand_fkey";
            columns: ["brand"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "compatibility_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_holds: {
        Row: {
          amount_pence: number;
          created_at: string;
          operation_key: string;
          order_id: string;
          resolved_at: string | null;
          status: Database["public"]["Enums"]["credit_hold_status"];
          trade_account_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount_pence: number;
          created_at?: string;
          operation_key: string;
          order_id: string;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["credit_hold_status"];
          trade_account_id: string;
        };
        Update: {
          amount_pence?: number;
          created_at?: string;
          operation_key?: string;
          order_id?: string;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["credit_hold_status"];
          trade_account_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_holds_order_id_trade_account_id_fkey";
            columns: ["order_id", "trade_account_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "trade_account_id"];
          },
        ];
      };
      credit_ledger: {
        Row: {
          actor_id: string | null;
          created_at: string;
          held_delta_pence: number;
          id: number;
          input: NonNullable<Json>;
          kind: Database["public"]["Enums"]["credit_ledger_kind"];
          operation_key: string;
          order_id: string | null;
          outstanding_delta_pence: number;
          trade_account_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          held_delta_pence: number;
          id?: never;
          input: NonNullable<Json>;
          kind: Database["public"]["Enums"]["credit_ledger_kind"];
          operation_key: string;
          order_id?: string | null;
          outstanding_delta_pence: number;
          trade_account_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          held_delta_pence?: number;
          id?: never;
          input?: NonNullable<Json>;
          kind?: Database["public"]["Enums"]["credit_ledger_kind"];
          operation_key?: string;
          order_id?: string | null;
          outstanding_delta_pence?: number;
          trade_account_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_ledger_order_id_trade_account_id_fkey";
            columns: ["order_id", "trade_account_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "trade_account_id"];
          },
          {
            foreignKeyName: "credit_ledger_trade_account_id_fkey";
            columns: ["trade_account_id"];
            isOneToOne: false;
            referencedRelation: "trade_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_ledger_trade_account_id_fkey";
            columns: ["trade_account_id"];
            isOneToOne: false;
            referencedRelation: "trade_credit_position";
            referencedColumns: ["trade_account_id"];
          },
        ];
      };
      enquiries: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          kind: string;
          machine_brand: string | null;
          message: string;
          postcode: string | null;
          query: string | null;
          staff_notes: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          id: string;
          kind: string;
          machine_brand?: string | null;
          message: string;
          postcode?: string | null;
          query?: string | null;
          staff_notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          kind?: string;
          machine_brand?: string | null;
          message?: string;
          postcode?: string | null;
          query?: string | null;
          staff_notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      finance_retry_requests: {
        Row: {
          kind: string;
          requested_at: string;
          requested_by: string;
          result: string | null;
          target_id: string;
          target_updated_at: string;
          worker_token: string | null;
          worker_until: string | null;
        };
        ComputedFields: never;
        Insert: {
          kind: string;
          requested_at?: string;
          requested_by: string;
          result?: string | null;
          target_id: string;
          target_updated_at: string;
          worker_token?: string | null;
          worker_until?: string | null;
        };
        Update: {
          kind?: string;
          requested_at?: string;
          requested_by?: string;
          result?: string | null;
          target_id?: string;
          target_updated_at?: string;
          worker_token?: string | null;
          worker_until?: string | null;
        };
        Relationships: [];
      };
      finder_search_events: {
        Row: {
          created_at: string;
          id: string;
          normalised_query: string | null;
          outcome: string;
          query_fingerprint: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          normalised_query?: string | null;
          outcome: string;
          query_fingerprint?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          normalised_query?: string | null;
          outcome?: string;
          query_fingerprint?: string | null;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          amount_due_pence: number;
          amount_remaining_pence: number;
          currency: string;
          due_at: string;
          issued_at: string;
          order_id: string;
          po_number: string;
          provider_invoice_id: string;
          status: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount_due_pence: number;
          amount_remaining_pence: number;
          currency: string;
          due_at: string;
          issued_at: string;
          order_id: string;
          po_number: string;
          provider_invoice_id: string;
          status?: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id: string;
          updated_at?: string;
        };
        Update: {
          amount_due_pence?: number;
          amount_remaining_pence?: number;
          currency?: string;
          due_at?: string;
          issued_at?: string;
          order_id?: string;
          po_number?: string;
          provider_invoice_id?: string;
          status?: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_order_id_trade_account_id_fkey";
            columns: ["order_id", "trade_account_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "trade_account_id"];
          },
        ];
      };
      order_items: {
        Row: {
          gross_pence: number;
          net_pence: number;
          option_label: string;
          order_id: string;
          quantity: number;
          sku: string;
          tax_pence: number;
          unit_price_pence: number;
          variant_id: string;
        };
        ComputedFields: never;
        Insert: {
          gross_pence: number;
          net_pence: number;
          option_label: string;
          order_id: string;
          quantity: number;
          sku: string;
          tax_pence: number;
          unit_price_pence: number;
          variant_id: string;
        };
        Update: {
          gross_pence?: number;
          net_pence?: number;
          option_label?: string;
          order_id?: string;
          quantity?: number;
          sku?: string;
          tax_pence?: number;
          unit_price_pence?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      order_outbox: {
        Row: {
          attempt_count: number;
          created_at: string;
          delivery_uncertain: boolean;
          enquiry_id: string | null;
          id: string;
          last_error: string | null;
          lease_token: string | null;
          lease_until: string | null;
          message_body: string | null;
          message_key: string;
          message_subject: string | null;
          next_attempt_at: string;
          order_id: string | null;
          provider_message_id: string | null;
          send_in_flight: boolean;
          send_payload: string | null;
          send_provider: string | null;
          send_started_at: string | null;
          sent_at: string | null;
          state: Database["public"]["Enums"]["order_message_state"];
          trade_application_id: string | null;
          trial_request_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attempt_count?: number;
          created_at?: string;
          delivery_uncertain?: boolean;
          enquiry_id?: string | null;
          id?: string;
          last_error?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          message_body?: string | null;
          message_key: string;
          message_subject?: string | null;
          next_attempt_at?: string;
          order_id?: string | null;
          provider_message_id?: string | null;
          send_in_flight?: boolean;
          send_payload?: string | null;
          send_provider?: string | null;
          send_started_at?: string | null;
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["order_message_state"];
          trade_application_id?: string | null;
          trial_request_id?: string | null;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          created_at?: string;
          delivery_uncertain?: boolean;
          enquiry_id?: string | null;
          id?: string;
          last_error?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          message_body?: string | null;
          message_key?: string;
          message_subject?: string | null;
          next_attempt_at?: string;
          order_id?: string | null;
          provider_message_id?: string | null;
          send_in_flight?: boolean;
          send_payload?: string | null;
          send_provider?: string | null;
          send_started_at?: string | null;
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["order_message_state"];
          trade_application_id?: string | null;
          trial_request_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_outbox_enquiry_id_fkey";
            columns: ["enquiry_id"];
            isOneToOne: false;
            referencedRelation: "enquiries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_outbox_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_outbox_trade_application_id_fkey";
            columns: ["trade_application_id"];
            isOneToOne: false;
            referencedRelation: "trade_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_outbox_trial_request_id_fkey";
            columns: ["trial_request_id"];
            isOneToOne: false;
            referencedRelation: "trial_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      order_returns: {
        Row: {
          created_at: string;
          id: string;
          lookup_code: string | null;
          order_id: string;
          quantity: number;
          reason: string;
          recorded_by: string;
          restored_quantity: number;
          variant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id: string;
          lookup_code?: string | null;
          order_id: string;
          quantity: number;
          reason: string;
          recorded_by: string;
          restored_quantity?: number;
          variant_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lookup_code?: string | null;
          order_id?: string;
          quantity?: number;
          reason?: string;
          recorded_by?: string;
          restored_quantity?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_returns_order_id_variant_id_fkey";
            columns: ["order_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["order_id", "variant_id"];
          },
        ];
      };
      orders: {
        Row: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        ComputedFields: never;
        Insert: {
          address_country: string;
          address_line1: string;
          address_line2?: string | null;
          address_postcode: string;
          address_region?: string | null;
          address_town: string;
          authorised_at?: string | null;
          business_name: string;
          buyer_id?: string | null;
          buyer_invoice_url?: string | null;
          buying_for_work: boolean;
          carrier?: string | null;
          checkout_attempt_token: string;
          checkout_session_id?: string | null;
          created_at?: string;
          currency?: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms?: Json | null;
          dispatched_at?: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status?: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id?: string;
          order_reference?: string;
          paid_pence?: number;
          payment_intent_id?: string | null;
          payment_method?: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason?: string | null;
          payment_review_refund_id?: string | null;
          payment_status?: Database["public"]["Enums"]["order_payment_status"];
          phone?: string | null;
          po_number?: string | null;
          promised_dispatch_date: string;
          provider_invoice_id?: string | null;
          recipient_name: string;
          refunded_pence?: number;
          stripe_checkout_account_id?: string | null;
          stripe_checkout_request?: Json | null;
          stripe_checkout_started_at?: string | null;
          stripe_net30_account_id?: string | null;
          stripe_net30_invoice_id?: string | null;
          stripe_net30_sent?: boolean;
          stripe_net30_started_at?: string | null;
          stripe_reconciliation_error?: string | null;
          stripe_replay_after?: string;
          tracking_number?: string | null;
          trade_account_id?: string | null;
          updated_at?: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        Update: {
          address_country?: string;
          address_line1?: string;
          address_line2?: string | null;
          address_postcode?: string;
          address_region?: string | null;
          address_town?: string;
          authorised_at?: string | null;
          business_name?: string;
          buyer_id?: string | null;
          buyer_invoice_url?: string | null;
          buying_for_work?: boolean;
          carrier?: string | null;
          checkout_attempt_token?: string;
          checkout_session_id?: string | null;
          created_at?: string;
          currency?: string;
          delivery_net_pence?: number;
          delivery_service?: string;
          delivery_terms?: Json | null;
          dispatched_at?: string | null;
          email?: string;
          estimated_delivery_date?: string;
          fulfilment_status?: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence?: number;
          gross_pence?: number;
          hold_expires_at?: string;
          id?: string;
          order_reference?: string;
          paid_pence?: number;
          payment_intent_id?: string | null;
          payment_method?: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason?: string | null;
          payment_review_refund_id?: string | null;
          payment_status?: Database["public"]["Enums"]["order_payment_status"];
          phone?: string | null;
          po_number?: string | null;
          promised_dispatch_date?: string;
          provider_invoice_id?: string | null;
          recipient_name?: string;
          refunded_pence?: number;
          stripe_checkout_account_id?: string | null;
          stripe_checkout_request?: Json | null;
          stripe_checkout_started_at?: string | null;
          stripe_net30_account_id?: string | null;
          stripe_net30_invoice_id?: string | null;
          stripe_net30_sent?: boolean;
          stripe_net30_started_at?: string | null;
          stripe_reconciliation_error?: string | null;
          stripe_replay_after?: string;
          tracking_number?: string | null;
          trade_account_id?: string | null;
          updated_at?: string;
          vat_pence?: number;
          vat_rate_bps?: number;
        };
        Relationships: [
          {
            foreignKeyName: "orders_trade_account_id_fkey";
            columns: ["trade_account_id"];
            isOneToOne: false;
            referencedRelation: "trade_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_trade_account_id_fkey";
            columns: ["trade_account_id"];
            isOneToOne: false;
            referencedRelation: "trade_credit_position";
            referencedColumns: ["trade_account_id"];
          },
        ];
      };
      products: {
        Row: {
          created_at: string;
          description: string;
          family_code: string;
          id: string;
          media: NonNullable<Json>;
          name: string;
          slug: string;
          sort_order: number;
          tool_category: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string;
          family_code: string;
          id?: string;
          media?: NonNullable<Json>;
          name: string;
          slug: string;
          sort_order?: number;
          tool_category: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          family_code?: string;
          id?: string;
          media?: NonNullable<Json>;
          name?: string;
          slug?: string;
          sort_order?: number;
          tool_category?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_tool_category_fkey";
            columns: ["tool_category"];
            isOneToOne: false;
            referencedRelation: "tool_categories";
            referencedColumns: ["slug"];
          },
        ];
      };
      provider_events: {
        Row: {
          event_id: string;
          event_type: string;
          last_error: string | null;
          payload: NonNullable<Json>;
          provider: string;
          received_at: string;
          state: Database["public"]["Enums"]["provider_event_state"];
          stripe_replay_after: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          event_id: string;
          event_type: string;
          last_error?: string | null;
          payload: NonNullable<Json>;
          provider: string;
          received_at?: string;
          state?: Database["public"]["Enums"]["provider_event_state"];
          stripe_replay_after?: string;
          updated_at?: string;
        };
        Update: {
          event_id?: string;
          event_type?: string;
          last_error?: string | null;
          payload?: NonNullable<Json>;
          provider?: string;
          received_at?: string;
          state?: Database["public"]["Enums"]["provider_event_state"];
          stripe_replay_after?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      staff_members: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["staff_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          role: Database["public"]["Enums"]["staff_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["staff_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      staff_deliveries: ReadOnlyTable<{
        id: string;
        reference: string;
        received_on: string;
        note: string | null;
        received_at: string;
        actor_id: string;
        line_count: number;
        unit_count: number;
        purchase_order_id: string | null;
      }, [{
        foreignKeyName: "staff_deliveries_purchase_order_id_fkey";
        columns: ["purchase_order_id"];
        isOneToOne: false;
        referencedRelation: "staff_purchase_orders";
        referencedColumns: ["id"];
      }]>;
      staff_delivery_lines: ReadOnlyTable<{
        delivery_id: string;
        position: number;
        variant_id: string;
        sku: string;
        blade_name: string;
        quantity: number;
        stock_movement_id: number;
      }, [
        {
          foreignKeyName: "staff_delivery_lines_delivery_id_fkey";
          columns: ["delivery_id"];
          isOneToOne: false;
          referencedRelation: "staff_deliveries";
          referencedColumns: ["id"];
        },
        {
          foreignKeyName: "staff_delivery_lines_stock_movement_id_fkey";
          columns: ["stock_movement_id"];
          isOneToOne: true;
          referencedRelation: "stock_movements";
          referencedColumns: ["id"];
        },
        {
          foreignKeyName: "staff_delivery_lines_variant_id_fkey";
          columns: ["variant_id"];
          isOneToOne: false;
          referencedRelation: "variants";
          referencedColumns: ["id"];
        },
      ]>;
      staff_suppliers: ReadOnlyTable<{
        id: string;
        name: string;
        contact_name: string | null;
        email: string | null;
        phone: string | null;
        address: string | null;
        default_currency: string | null;
        lead_time_days: number | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
      }>;
      staff_variant_suppliers: ReadOnlyTable<{
        variant_id: string;
        supplier_id: string;
        supplier_part_number: string | null;
        is_usual: boolean;
        updated_at: string;
      }, [
        {
          foreignKeyName: "staff_variant_suppliers_variant_id_fkey";
          columns: ["variant_id"];
          isOneToOne: false;
          referencedRelation: "variants";
          referencedColumns: ["id"];
        },
        {
          foreignKeyName: "staff_variant_suppliers_supplier_id_fkey";
          columns: ["supplier_id"];
          isOneToOne: false;
          referencedRelation: "staff_suppliers";
          referencedColumns: ["id"];
        },
      ]>;
      staff_purchase_orders: ReadOnlyTable<{
        id: string;
        number: string;
        status: StaffPurchaseStatus;
        ordered_on: string;
        expected_on: string | null;
        revision: number;
        document_revision: number;
        created_at: string;
        updated_at: string;
      }>;
      staff_purchase_order_costs: ReadOnlyTable<{
        purchase_order_id: string;
        supplier_id: string | null;
        currency: string;
        exchange_rate: number | null;
        shipping_minor: number;
        duty_minor: number;
        other_minor: number;
        import_vat_minor: number;
        include_import_vat: boolean | null;
        note: string | null;
      }, [
        {
          foreignKeyName: "staff_purchase_order_costs_purchase_order_id_fkey";
          columns: ["purchase_order_id"];
          isOneToOne: true;
          referencedRelation: "staff_purchase_orders";
          referencedColumns: ["id"];
        },
        {
          foreignKeyName: "staff_purchase_order_costs_supplier_id_fkey";
          columns: ["supplier_id"];
          isOneToOne: false;
          referencedRelation: "staff_suppliers";
          referencedColumns: ["id"];
        },
      ]>;
      staff_purchase_order_lines: ReadOnlyTable<{
        purchase_order_id: string;
        variant_id: string;
        position: number;
        sku: string;
        blade_name: string;
        option_label: string | null;
        quantity: number;
        received_quantity: number;
      }, [
        {
          foreignKeyName: "staff_purchase_order_lines_purchase_order_id_fkey";
          columns: ["purchase_order_id"];
          isOneToOne: false;
          referencedRelation: "staff_purchase_orders";
          referencedColumns: ["id"];
        },
      ]>;
      staff_purchase_order_line_costs: ReadOnlyTable<{
        purchase_order_id: string;
        variant_id: string;
        unit_price_minor: number | null;
        supplier_part_number: string | null;
        note: string | null;
        base_unit_pence: number | null;
        freight_unit_pence: number | null;
        duty_unit_pence: number | null;
        other_unit_pence: number | null;
        vat_unit_pence: number | null;
        landed_unit_pence: number | null;
      }, [
        {
          foreignKeyName: "purchase_order_line_costs_line_fkey";
          columns: ["purchase_order_id", "variant_id"];
          isOneToOne: true;
          referencedRelation: "staff_purchase_order_lines";
          referencedColumns: ["purchase_order_id", "variant_id"];
        },
      ]>;
      staff_purchase_order_events: ReadOnlyTable<{
        id: string;
        purchase_order_id: string;
        kind: string;
        revision: number;
        actor_id: string;
        created_at: string;
      }>;
      staff_purchase_buyer_settings: ReadOnlyTable<{
        id: boolean;
        name: string | null;
        address: string | null;
        email: string | null;
        company_number: string | null;
        vat_number: string | null;
      }>;
      staff_variant_costs: ReadOnlyTable<StaffUnitCost>;
      staff_receipt_costs: ReadOnlyTable<StaffUnitCost & { stock_movement_id: number; received_quantity: number }>;
      staff_purchase_receipt_cost_breakdowns: ReadOnlyTable<{
        stock_movement_id: number;
        base_unit_pence: number;
        freight_unit_pence: number;
        duty_unit_pence: number;
        other_unit_pence: number;
        vat_unit_pence: number;
        include_import_vat: boolean | null;
      }>;
      staff_variant_cost_audit: ReadOnlyTable<{
        id: number;
        variant_id: string;
        stock_movement_id: number | null;
        actor_id: string;
        old_cost: Json | null;
        new_cost: Json;
        recorded_at: string;
      }>;
      stock_movements: {
        Row: {
          actor_id: string | null;
          adjustment_reason: string | null;
          adjustment_note: string | null;
          created_at: string;
          id: number;
          kind: Database["public"]["Enums"]["stock_movement_kind"];
          on_hand_before: number | null;
          on_hand_after: number | null;
          on_hand_delta: number;
          operation_key: string;
          order_id: string | null;
          reserved_before: number | null;
          reserved_after: number | null;
          reserved_delta: number;
          return_id: string | null;
          trial_request_id: string | null;
          variant_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          kind: Database["public"]["Enums"]["stock_movement_kind"];
          on_hand_delta: number;
          operation_key: string;
          order_id?: string | null;
          reserved_delta: number;
          return_id?: string | null;
          trial_request_id?: string | null;
          variant_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          kind?: Database["public"]["Enums"]["stock_movement_kind"];
          on_hand_delta?: number;
          operation_key?: string;
          order_id?: string | null;
          reserved_delta?: number;
          return_id?: string | null;
          trial_request_id?: string | null;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_order_id_variant_id_fkey";
            columns: ["order_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["order_id", "variant_id"];
          },
          {
            foreignKeyName: "stock_movements_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "order_returns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_trial_request_id_variant_id_fkey";
            columns: ["trial_request_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "trial_allocations";
            referencedColumns: ["trial_request_id", "variant_id"];
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_reservations: {
        Row: {
          created_at: string;
          order_id: string;
          quantity: number;
          state: Database["public"]["Enums"]["stock_reservation_state"];
          updated_at: string;
          variant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          order_id: string;
          quantity: number;
          state?: Database["public"]["Enums"]["stock_reservation_state"];
          updated_at?: string;
          variant_id: string;
        };
        Update: {
          created_at?: string;
          order_id?: string;
          quantity?: number;
          state?: Database["public"]["Enums"]["stock_reservation_state"];
          updated_at?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_reservations_order_id_variant_id_fkey";
            columns: ["order_id", "variant_id"];
            isOneToOne: true;
            referencedRelation: "order_items";
            referencedColumns: ["order_id", "variant_id"];
          },
        ];
      };
      substrates: {
        Row: {
          name: string;
          slug: string;
          sort_order: number;
          swatch: string | null;
        };
        ComputedFields: never;
        Insert: {
          name: string;
          slug: string;
          sort_order?: number;
          swatch?: string | null;
        };
        Update: {
          name?: string;
          slug?: string;
          sort_order?: number;
          swatch?: string | null;
        };
        Relationships: [];
      };
      tool_categories: {
        Row: {
          name: string;
          slug: string;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          name: string;
          slug: string;
          sort_order?: number;
        };
        Update: {
          name?: string;
          slug?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      trade_accounts: {
        Row: {
          application_id: string;
          buyer_id: string | null;
          buyer_name: string;
          created_at: string;
          credit_limit_pence: number;
          id: string;
          status: Database["public"]["Enums"]["trade_account_status"];
          stripe_customer_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          application_id: string;
          buyer_id?: string | null;
          buyer_name: string;
          created_at?: string;
          credit_limit_pence: number;
          id?: string;
          status: Database["public"]["Enums"]["trade_account_status"];
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Update: {
          application_id?: string;
          buyer_id?: string | null;
          buyer_name?: string;
          created_at?: string;
          credit_limit_pence?: number;
          id?: string;
          status?: Database["public"]["Enums"]["trade_account_status"];
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trade_accounts_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: true;
            referencedRelation: "trade_applications";
            referencedColumns: ["id"];
          },
        ];
      };
      trade_applications: {
        Row: {
          approval_started_at: string | null;
          approval_stripe_account_id: string | null;
          billing_line1: string;
          billing_line2: string | null;
          billing_postcode: string;
          billing_town: string;
          buyer_id: string | null;
          buyer_name: string;
          company: string;
          created_at: string;
          email: string;
          id: string;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approval_started_at?: string | null;
          approval_stripe_account_id?: string | null;
          billing_line1: string;
          billing_line2?: string | null;
          billing_postcode: string;
          billing_town: string;
          buyer_id?: string | null;
          buyer_name: string;
          company: string;
          created_at?: string;
          email: string;
          id: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          approval_started_at?: string | null;
          approval_stripe_account_id?: string | null;
          billing_line1?: string;
          billing_line2?: string | null;
          billing_postcode?: string;
          billing_town?: string;
          buyer_id?: string | null;
          buyer_name?: string;
          company?: string;
          created_at?: string;
          email?: string;
          id?: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      trial_allocations: {
        Row: {
          quantity: number;
          trial_request_id: string;
          variant_id: string;
        };
        ComputedFields: never;
        Insert: {
          quantity: number;
          trial_request_id: string;
          variant_id: string;
        };
        Update: {
          quantity?: number;
          trial_request_id?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trial_allocations_trial_request_id_fkey";
            columns: ["trial_request_id"];
            isOneToOne: false;
            referencedRelation: "trial_fulfilments";
            referencedColumns: ["trial_request_id"];
          },
          {
            foreignKeyName: "trial_allocations_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      trial_fulfilments: {
        Row: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          address_verified_at: string;
          address_verified_by: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          carrier: string;
          carrier_service: string;
          dispatched_at: string | null;
          dispatched_by: string | null;
          recipient_name: string;
          state: string;
          subsequent_order_id: string | null;
          tracking_number: string | null;
          trial_request_id: string;
        };
        ComputedFields: never;
        Insert: {
          address_country: string;
          address_line1: string;
          address_line2?: string | null;
          address_postcode: string;
          address_region?: string | null;
          address_town: string;
          address_verified_at: string;
          address_verified_by: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          carrier: string;
          carrier_service: string;
          dispatched_at?: string | null;
          dispatched_by?: string | null;
          recipient_name: string;
          state?: string;
          subsequent_order_id?: string | null;
          tracking_number?: string | null;
          trial_request_id: string;
        };
        Update: {
          address_country?: string;
          address_line1?: string;
          address_line2?: string | null;
          address_postcode?: string;
          address_region?: string | null;
          address_town?: string;
          address_verified_at?: string;
          address_verified_by?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          carrier?: string;
          carrier_service?: string;
          dispatched_at?: string | null;
          dispatched_by?: string | null;
          recipient_name?: string;
          state?: string;
          subsequent_order_id?: string | null;
          tracking_number?: string | null;
          trial_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trial_fulfilments_subsequent_order_id_fkey";
            columns: ["subsequent_order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trial_fulfilments_trial_request_id_fkey";
            columns: ["trial_request_id"];
            isOneToOne: true;
            referencedRelation: "trial_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      trial_requests: {
        Row: {
          company: string;
          created_at: string;
          email: string;
          id: string;
          machine_brand: string;
          oem_code: string;
          postcode: string;
          staff_notes: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          company: string;
          created_at?: string;
          email: string;
          id: string;
          machine_brand: string;
          oem_code: string;
          postcode: string;
          staff_notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          company?: string;
          created_at?: string;
          email?: string;
          id?: string;
          machine_brand?: string;
          oem_code?: string;
          postcode?: string;
          staff_notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      variant_substrates: {
        Row: {
          substrate: string;
          variant_id: string;
        };
        ComputedFields: never;
        Insert: {
          substrate: string;
          variant_id: string;
        };
        Update: {
          substrate?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variant_substrates_substrate_fkey";
            columns: ["substrate"];
            isOneToOne: false;
            referencedRelation: "substrates";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "variant_substrates_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      variants: {
        Row: {
          angle_deg: number | null;
          approved_at: string | null;
          approved_by: string | null;
          availability: string | null;
          blade_thickness_mm: number | null;
          catalogue_updated_at: string;
          created_at: string;
          cutting_depth_mm: number | null;
          diameter_mm: number | null;
          evidence_note: string | null;
          evidence_source: string | null;
          id: string;
          is_staging_fixture: boolean;
          option_label: string | null;
          price_1_4_pence: number | null;
          price_10_plus_pence: number | null;
          price_5_9_pence: number | null;
          product_id: string;
          publication_status: Database["public"]["Enums"]["publication_status"];
          rejected_at: string | null;
          rejected_by: string | null;
          shank_mm: number | null;
          sku: string;
          sku_normalised: string | null;
          sort_order: number;
          specs: NonNullable<Json>;
          stock_on_hand: number;
          stock_reserved: number;
          supplier_name: string | null;
          supplier_part_number: string | null;
          tool: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          angle_deg?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          availability?: never;
          blade_thickness_mm?: number | null;
          catalogue_updated_at?: string;
          created_at?: string;
          cutting_depth_mm?: number | null;
          diameter_mm?: number | null;
          evidence_note?: string | null;
          evidence_source?: string | null;
          id?: string;
          is_staging_fixture?: boolean;
          option_label?: string | null;
          price_1_4_pence?: number | null;
          price_10_plus_pence?: number | null;
          price_5_9_pence?: number | null;
          product_id: string;
          publication_status?: Database["public"]["Enums"]["publication_status"];
          rejected_at?: string | null;
          rejected_by?: string | null;
          shank_mm?: number | null;
          sku: string;
          sku_normalised?: never;
          sort_order?: number;
          specs?: NonNullable<Json>;
          stock_on_hand?: number;
          stock_reserved?: number;
          supplier_name?: string | null;
          supplier_part_number?: string | null;
          tool?: string | null;
          updated_at?: string;
        };
        Update: {
          angle_deg?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          availability?: never;
          blade_thickness_mm?: number | null;
          catalogue_updated_at?: string;
          created_at?: string;
          cutting_depth_mm?: number | null;
          diameter_mm?: number | null;
          evidence_note?: string | null;
          evidence_source?: string | null;
          id?: string;
          is_staging_fixture?: boolean;
          option_label?: string | null;
          price_1_4_pence?: number | null;
          price_10_plus_pence?: number | null;
          price_5_9_pence?: number | null;
          product_id?: string;
          publication_status?: Database["public"]["Enums"]["publication_status"];
          rejected_at?: string | null;
          rejected_by?: string | null;
          shank_mm?: number | null;
          sku?: string;
          sku_normalised?: never;
          sort_order?: number;
          specs?: NonNullable<Json>;
          stock_on_hand?: number;
          stock_reserved?: number;
          supplier_name?: string | null;
          supplier_part_number?: string | null;
          tool?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      staff_purchase_order_outstanding: {
        Row: { purchase_order_id: string; number: string; variant_id: string; quantity: number; expected_on: string | null };
        Relationships: [];
      };
      staff_purchase_order_stock: {
        Row: { variant_id: string; quantity: number; expected_on: string | null; has_undated: boolean };
        Relationships: [];
      };
      staff_effective_receipt_costs: {
        Row: StaffUnitCost & { stock_movement_id: number; received_quantity: number };
        Relationships: [];
      };
      staff_current_variant_costs: {
        Row: StaffUnitCost & {
          source: "receipt" | "estimate";
          stock_movement_id: number | null;
          received_quantity: number | null;
        };
        Relationships: [];
      };
      finance_post_dispatch_adjustments: {
        Row: {
          order_id: string | null;
          order_reference: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"] | null;
          provider_reference: string | null;
          kind: string | null;
          amount_pence: number | null;
          outstanding_delta_pence: number | null;
          reconciled_at: string | null;
        };
        Relationships: [];
      };
      overdue_invoices: {
        Row: {
          amount_due_pence: number;
          amount_remaining_pence: number;
          currency: string;
          due_at: string;
          issued_at: string;
          order_id: string;
          po_number: string;
          status: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount_due_pence?: number | null;
          amount_remaining_pence?: number | null;
          currency?: string | null;
          due_at?: string | null;
          issued_at?: string | null;
          order_id?: string | null;
          po_number?: string | null;
          status?: Database["public"]["Enums"]["trade_invoice_status"] | null;
          trade_account_id?: string | null;
        };
        Update: {
          amount_due_pence?: number | null;
          amount_remaining_pence?: number | null;
          currency?: string | null;
          due_at?: string | null;
          issued_at?: string | null;
          order_id?: string | null;
          po_number?: string | null;
          status?: Database["public"]["Enums"]["trade_invoice_status"] | null;
          trade_account_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_order_id_trade_account_id_fkey";
            columns: ["order_id", "trade_account_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "trade_account_id"];
          },
        ];
      };
      trade_credit_position: {
        Row: {
          available_credit_pence: number | null;
          buyer_id: string | null;
          credit_limit_pence: number;
          held_pence: number | null;
          outstanding_pence: number | null;
          status: Database["public"]["Enums"]["trade_account_status"];
          trade_account_id: string;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      save_staff_supplier: { Args: { p_id: string | null; p_supplier: Json }; Returns: string };
      save_staff_purchase_buyer_settings: { Args: { p_settings: Json }; Returns: boolean };
      save_staff_purchase_order: {
        Args: { p_id: string | null; p_expected_revision: number; p_order: Json; p_lines: Json };
        Returns: string;
      };
      save_staff_purchase_order_with_supplier_parts: {
        Args: { p_id: string | null; p_expected_revision: number; p_order: Json; p_lines: Json; p_remember: Json };
        Returns: string;
      };
      transition_staff_purchase_order: {
        Args: { p_id: string; p_expected_revision: number; p_status: string };
        Returns: string;
      };
      receive_staff_purchase_order: {
        Args: {
          p_order_id: string; p_expected_revision: number; p_delivery_id: string;
          p_reference: string; p_received_on: string; p_note: string | null; p_lines: Json;
        };
        Returns: string;
      };
      last_staff_purchase_price: {
        Args: { p_supplier_id: string; p_variant_id: string; p_currency: string };
        Returns: number | null;
      };
      add_staff_delivery_line_cost: {
        Args: { p_delivery_id: string; p_position: number; p_unit_cost_pence: number };
        Returns: number;
      };
      adjust_staff_stock: {
        Args: { p_variant_id: string; p_operation_key: string; p_quantity: number; p_reason: string; p_note?: string };
        Returns: number;
      };
      archive_staff_variant: {
        Args: { p_variant_id: string; p_expected_updated_at: string };
        Returns: string;
      };
      correct_staff_receipt_cost: {
        Args: { p_variant_id: string; p_stock_movement_id: number; p_expected_recorded_at: string; p_cost: Json };
        Returns: number;
      };
      match_staff_delivery_codes: {
        Args: { p_codes: string[] };
        Returns: { input_code: string; variant_id: string; sku: string; blade_name: string }[];
      };
      receive_staff_delivery: {
        Args: { p_delivery_id: string; p_reference: string; p_received_on: string; p_note: string | null; p_lines: Json };
        Returns: string;
      };
      receive_staff_stock_with_cost: {
        Args: { p_variant_id: string; p_operation_key: string; p_quantity: number; p_cost: Json };
        Returns: number;
      };
      set_staff_variant_cost: {
        Args: { p_variant_id: string; p_cost: Json };
        Returns: string;
      };
      activate_staff_authenticator: {
        Args: { p_user_id: string; p_factor_id: string };
        Returns: undefined;
      };
      get_staff_authenticator: {
        Args: Record<PropertyKey, never>;
        Returns: { approved_factor_id: string | null; session_factor_id: string | null }[];
      };
      has_recorded_stripe_refund: {
        Args: { p_refund_id: string };
        Returns: boolean;
      };
      checkout_delivery_terms: {
        Args: { p_postcode: string };
        Returns: Json;
      };
      checkout_warehouse_calendar: {
        Args: never;
        Returns: Json;
      };
      reserve_order_with_delivery: {
        Args: Database["public"]["Functions"]["create_order_with_reservations"]["Args"] & {
          p_delivery_terms: Json;
          p_payment_method: Database["public"]["Enums"]["order_payment_method"];
          p_po_number?: string;
        };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
        SetofOptions: { from: "*"; to: "orders"; isOneToOne: true; isSetofReturn: false };
      };
      admin_catalogue_review: {
        Args: {
          p_actor_id: string;
          p_adapter?: string;
          p_approve: boolean;
          p_brand?: string;
          p_compatibility_id?: string;
          p_evidence_note: string;
          p_evidence_source: string;
          p_evidence_url?: string;
          p_expected_mapping_updated_at?: string;
          p_expected_updated_at: string;
          p_machine?: string;
          p_tool?: string;
          p_variant_id: string;
        };
        Returns: string;
      };
      admin_catalogue_set_publication: {
        Args: {
          p_actor_id: string;
          p_expected_updated_at: string;
          p_publish: boolean;
          p_variant_id: string;
        };
        Returns: string;
      };
      admin_catalogue_update: {
        Args: {
          p_actor_id: string;
          p_expected_product_updated_at: string;
          p_expected_updated_at: string;
          p_selling: Json;
          p_variant_id: string;
        };
        Returns: string;
      };
      remember_staff_purchase_supplier_part: {
        Args: {
          p_purchase_order_id: string;
          p_variant_id: string;
          p_expected_purchase_revision: number;
          p_expected_association_updated_at: string | null;
        };
        Returns: boolean;
      };
      approve_trial_fulfilment: {
        Args: {
          p_actor_id: string;
          p_address: Json;
          p_address_verified: boolean;
          p_carrier: string;
          p_carrier_service: string;
          p_trial_request_id: string;
          p_variant_ids: string[];
        };
        Returns: string;
      };
      begin_outbox_email_send: {
        Args: {
          p_outbox_id: string;
          p_lease_token: string;
          p_provider?: string;
          p_payload?: string;
          p_recipient_fingerprint?: string;
        };
        Returns: Database["public"]["Tables"]["order_outbox"]["Row"][];
      };
      claim_outbox_email: {
        Args: { p_message_key: string; p_replay_order_id?: string; p_expected_updated_at?: string };
        Returns: Database["public"]["Tables"]["order_outbox"]["Row"][];
      };
      claim_finance_retries: {
        Args: { p_kind: string };
        Returns: Database["public"]["Tables"]["finance_retry_requests"]["Row"][];
      };
      finish_finance_retry: {
        Args: { p_kind: string; p_target_id: string; p_worker_token: string; p_result: string };
        Returns: undefined;
      };
      close_unstarted_net30_order: {
        Args: { p_order_id: string };
        Returns: Database["public"]["Tables"]["orders"]["Row"][];
        SetofOptions: { from: "*"; to: "orders"; isOneToOne: false; isSetofReturn: true };
      };
      close_absent_net30_order: {
        Args: { p_order_id: string };
        Returns: Database["public"]["Tables"]["orders"]["Row"][];
        SetofOptions: { from: "*"; to: "orders"; isOneToOne: false; isSetofReturn: true };
      };
      close_missing_checkout_attempt: {
        Args: { p_attempt_token: string };
        Returns: boolean;
      };
      close_unbound_stripe_checkout: {
        Args: { p_order_id: string; p_account_id?: string; p_close_now?: boolean };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      consume_checkout_rate_limit: {
        Args: { p_scope: string; p_ip_key: string; p_email_key: string };
        Returns: boolean;
      };
      finish_outbox_email: {
        Args: { p_outbox_id: string; p_lease_token: string; p_outcome: string; p_provider_message_id?: string };
        Returns: Database["public"]["Tables"]["order_outbox"]["Row"][];
      };
      prepare_cancelled_card_refund: {
        Args: {
          p_order_id: string;
          p_actor_id: string;
          p_account_id: string;
          p_charge_id: string;
          p_payment_intent_id: string;
          p_amount_pence: number;
          p_previous_request_id?: string;
          p_failed_refund_id?: string;
        };
        Returns: { request_id: string; started_at: string; amount_pence: number }[];
      };
      prepare_stripe_checkout: {
        Args: { p_order_id: string; p_request: Json; p_account_id: string };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      bind_checkout_session: {
        Args: {
          p_expires_at: string;
          p_order_id: string;
          p_session_id: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      cancel_order: {
        Args: {
          p_actor_id: string;
          p_operation_key: string;
          p_order_id: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      cancel_trial_fulfilment: {
        Args: { p_actor_id: string; p_trial_request_id: string };
        Returns: string;
      };
      confirm_payment: {
        Args: {
          p_amount_pence: number;
          p_currency: string;
          p_delivery_date: string;
          p_dispatch_date: string;
          p_invoice_id?: string;
          p_order_id: string;
          p_paid_at: string;
          p_payment_intent_id: string;
          p_session_id: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      consume_request_rate_limit: {
        Args: { p_email_key: string; p_ip_key: string; p_scope: string };
        Returns: boolean;
      };
      lookup_selection_quote: {
        Args: { p_variant_ids: string[]; p_quantities: number[] };
        Returns: {
          id: string;
          sku: string;
          option_label: string | null;
          price_1_4_pence: number;
          price_5_9_pence: number;
          price_10_plus_pence: number;
          quote_limit: number;
          photo: string | null;
        }[];
      };
      create_order_with_reservations: {
        Args: {
          p_address: Json;
          p_attempt_token: string;
          p_buyer_id?: string;
          p_contact: Json;
          p_delivery_date: string;
          p_delivery_service: string;
          p_dispatch_date: string;
          p_hold_expires_at: string;
          p_lines: Json;
          p_totals: Json;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      dispatch_order: {
        Args: {
          p_actor_id: string;
          p_carrier: string;
          p_operation_key: string;
          p_order_id: string;
          p_tracking_number: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      dispatch_trial_fulfilment: {
        Args: {
          p_actor_id: string;
          p_tracking_number: string;
          p_trial_request_id: string;
        };
        Returns: string;
      };
      enqueue_order_confirmation: {
        Args: { p_order_id: string };
        Returns: {
          created_at: string;
          enquiry_id: string | null;
          id: string;
          message_key: string;
          order_id: string | null;
          state: Database["public"]["Enums"]["order_message_state"];
          trade_application_id: string | null;
          trial_request_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "order_outbox";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      fold_text: { Args: { input: string }; Returns: string };
      link_trial_order: {
        Args: {
          p_actor_id: string;
          p_order_id: string;
          p_trial_request_id: string;
        };
        Returns: string;
      };
      mark_provider_event: {
        Args: {
          p_error?: string;
          p_event_id: string;
          p_provider: string;
          p_state: Database["public"]["Enums"]["provider_event_state"];
        };
        Returns: {
          event_id: string;
          event_type: string;
          last_error: string | null;
          payload: NonNullable<Json>;
          provider: string;
          received_at: string;
          state: Database["public"]["Enums"]["provider_event_state"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "provider_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      normalise_code: { Args: { code: string }; Returns: string };
      purge_request_data: {
        Args: {
          p_enquiry_age: string;
          p_rate_window_grace?: string;
          p_search_age: string;
          p_trade_age: string;
          p_trial_age: string;
        };
        Returns: Json;
      };
      receive_stock: {
        Args: {
          p_actor_id: string;
          p_operation_key: string;
          p_quantity: number;
          p_variant_id: string;
        };
        Returns: {
          actor_id: string | null;
          created_at: string;
          id: number;
          kind: Database["public"]["Enums"]["stock_movement_kind"];
          on_hand_delta: number;
          operation_key: string;
          order_id: string | null;
          reserved_delta: number;
          return_id: string | null;
          trial_request_id: string | null;
          variant_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "stock_movements";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_finder_search: {
        Args: {
          p_normalised_query?: string;
          p_outcome: string;
          p_query_fingerprint?: string;
        };
        Returns: string;
      };
      record_provider_event: {
        Args: {
          p_event_id: string;
          p_event_type: string;
          p_payload: Json;
          p_provider: string;
        };
        Returns: {
          event_id: string;
          event_type: string;
          last_error: string | null;
          payload: NonNullable<Json>;
          provider: string;
          received_at: string;
          state: Database["public"]["Enums"]["provider_event_state"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "provider_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_refund: {
        Args: {
          p_amount_pence: number;
          p_currency: string;
          p_order_id: string;
          p_payment_intent_id: string;
          p_refund_id: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_return: {
        Args: {
          p_actor_id: string;
          p_lookup_code?: string;
          p_order_id: string;
          p_quantity: number;
          p_reason: string;
          p_return_id: string;
          p_variant_id: string;
        };
        Returns: {
          created_at: string;
          id: string;
          lookup_code: string | null;
          order_id: string;
          quantity: number;
          reason: string;
          recorded_by: string;
          restored_quantity: number;
          variant_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "order_returns";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_reservation: {
        Args: {
          p_operation_key: string;
          p_order_id: string;
          p_reason: string;
          p_session_id?: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      request_finance_retry: {
        Args: { p_actor_id: string; p_kind: string; p_target_id: string };
        Returns: boolean;
      };
      resolve_refunded_payment_review: {
        Args: {
          p_actor_id: string;
          p_order_id: string;
          p_payment_intent_id: string;
          p_refund_id: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      restore_stock: {
        Args: {
          p_actor_id: string;
          p_operation_key: string;
          p_quantity: number;
          p_return_id: string;
        };
        Returns: {
          created_at: string;
          id: string;
          lookup_code: string | null;
          order_id: string;
          quantity: number;
          reason: string;
          recorded_by: string;
          restored_quantity: number;
          variant_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "order_returns";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      begin_trade_account_approval: {
        Args: { p_actor_id: string; p_application_id: string; p_stripe_account_id: string };
        Returns: Database["public"]["Tables"]["trade_applications"]["Row"];
        SetofOptions: {
          from: "*";
          to: "trade_applications";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reinstate_trade_account: {
        Args: { p_actor_id: string; p_operation_key: string; p_reason: string; p_trade_account_id: string };
        Returns: Database["public"]["Tables"]["trade_accounts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "trade_accounts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_admin_trade_application: {
        Args: {
          p_actor_id: string;
          p_application_id: string;
          p_credit_limit_pence?: number;
          p_decision: string;
          p_reason?: string;
          p_stripe_customer_id?: string;
        };
        Returns: string;
      };
      review_trade_application: {
        Args: {
          p_actor_id: string;
          p_application_id: string;
          p_decision: string;
        };
        Returns: string;
      };
      search_blades: {
        Args: { query_text: string };
        Returns: {
          match_type: string;
          matched_code: string;
          product_slug: string;
          requires_choice: boolean;
          score: number;
          sku: string;
          variant_id: string;
        }[];
      };
      start_net30_invoice: {
        Args: { p_account_id: string; p_order_id: string };
        Returns: Database["public"]["Tables"]["orders"]["Row"][];
        SetofOptions: { from: "*"; to: "orders"; isOneToOne: false; isSetofReturn: true };
      };
      start_picking: {
        Args: {
          p_actor_id: string;
          p_operation_key: string;
          p_order_id: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_own_buyer_invoice_url: {
        Args: { p_order_id: string };
        Returns: string;
      };
      set_buyer_invoice_url: {
        Args: { p_order_id: string; p_provider_invoice_id: string; p_url: string };
        Returns: boolean;
      };
      submit_enquiry: {
        Args: {
          p_email: string;
          p_id: string;
          p_kind: string;
          p_machine_brand?: string;
          p_message: string;
          p_postcode?: string;
          p_query?: string;
        };
        Returns: string;
      };
      submit_trade_application: {
        Args: {
          p_billing_line1: string;
          p_billing_line2?: string;
          p_billing_postcode: string;
          p_billing_town: string;
          p_buyer_id: string;
          p_buyer_name: string;
          p_company: string;
          p_id: string;
        };
        Returns: string;
      };
      submit_trial_request: {
        Args: {
          p_company: string;
          p_email: string;
          p_id: string;
          p_machine_brand: string;
          p_oem_code: string;
          p_postcode: string;
        };
        Returns: string;
      };
      apply_credit_note: {
        Args: {
          p_amount_pence: number;
          p_currency: string;
          p_operation_key: string;
          p_pre_payment_pence: number;
          p_provider_invoice_id: string;
        };
        Returns: {
          amount_due_pence: number;
          amount_remaining_pence: number;
          currency: string;
          due_at: string;
          issued_at: string;
          order_id: string;
          po_number: string;
          provider_invoice_id: string;
          status: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "invoices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_invoice_payment: {
        Args: {
          p_amount_pence: number;
          p_currency: string;
          p_operation_key: string;
          p_provider_invoice_id: string;
        };
        Returns: {
          amount_due_pence: number;
          amount_remaining_pence: number;
          currency: string;
          due_at: string;
          issued_at: string;
          order_id: string;
          po_number: string;
          provider_invoice_id: string;
          status: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "invoices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_invoice_refund: {
        Args: {
          p_amount_pence: number;
          p_currency: string;
          p_operation_key: string;
          p_provider_invoice_id: string;
        };
        Returns: {
          amount_due_pence: number;
          amount_remaining_pence: number;
          currency: string;
          due_at: string;
          issued_at: string;
          order_id: string;
          po_number: string;
          provider_invoice_id: string;
          status: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "invoices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      approve_trade_account: {
        Args: {
          p_actor_id: string;
          p_application_id: string;
          p_credit_limit_pence: number;
          p_stripe_customer_id: string;
        };
        Returns: {
          application_id: string;
          buyer_id: string | null;
          buyer_name: string;
          created_at: string;
          credit_limit_pence: number;
          id: string;
          status: Database["public"]["Enums"]["trade_account_status"];
          stripe_customer_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "trade_accounts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      bind_issued_net30_invoice: {
        Args: {
          p_amount_due_pence: number;
          p_authorised_at: string;
          p_currency: string;
          p_delivery_date: string;
          p_dispatch_date: string;
          p_due_at: string;
          p_issued_at: string;
          p_order_id: string;
          p_provider_invoice_id: string;
          p_stripe_customer_id: string;
        };
        Returns: Database["public"]["Tables"]["orders"]["Row"][];
        SetofOptions: { from: "*"; to: "orders"; isOneToOne: false; isSetofReturn: true };
      };
      bind_invoice: {
        Args: {
          p_amount_due_pence: number;
          p_currency: string;
          p_delivery_date: string;
          p_dispatch_date: string;
          p_due_at: string;
          p_issued_at: string;
          p_order_id: string;
          p_provider_invoice_id: string;
          p_stripe_customer_id: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_net30_order_with_holds: {
        Args: {
          p_address: Json;
          p_attempt_token: string;
          p_buyer_id: string;
          p_contact: Json;
          p_delivery_date: string;
          p_delivery_service: string;
          p_dispatch_date: string;
          p_hold_expires_at: string;
          p_lines: Json;
          p_po_number: string;
          p_totals: Json;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_credit_hold: {
        Args: {
          p_operation_key: string;
          p_order_id: string;
          p_provider_invoice_id?: string;
          p_resolution: string;
        };
        Returns: {
          address_country: string;
          address_line1: string;
          address_line2: string | null;
          address_postcode: string;
          address_region: string | null;
          address_town: string;
          authorised_at: string | null;
          business_name: string;
          buyer_id: string | null;
          buyer_invoice_url: string | null;
          buying_for_work: boolean;
          carrier: string | null;
          checkout_attempt_token: string;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          delivery_net_pence: number;
          delivery_service: string;
          delivery_terms: Json | null;
          dispatched_at: string | null;
          email: string;
          estimated_delivery_date: string;
          fulfilment_status: Database["public"]["Enums"]["order_fulfilment_status"];
          goods_net_pence: number;
          gross_pence: number;
          hold_expires_at: string;
          id: string;
          order_reference: string;
          paid_pence: number;
          payment_intent_id: string | null;
          payment_method: Database["public"]["Enums"]["order_payment_method"];
          payment_review_reason: string | null;
          payment_review_refund_id: string | null;
          payment_status: Database["public"]["Enums"]["order_payment_status"];
          phone: string | null;
          po_number: string | null;
          promised_dispatch_date: string;
          provider_invoice_id: string | null;
          recipient_name: string;
          refunded_pence: number;
          stripe_checkout_account_id: string | null;
          stripe_checkout_request: Json | null;
          stripe_checkout_started_at: string | null;
          stripe_net30_account_id: string | null;
          stripe_net30_invoice_id: string | null;
          stripe_net30_sent: boolean;
          stripe_net30_started_at: string | null;
          stripe_reconciliation_error: string | null;
          stripe_replay_after: string;
          tracking_number: string | null;
          trade_account_id: string | null;
          updated_at: string;
          vat_pence: number;
          vat_rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_credit_limit: {
        Args: {
          p_actor_id: string;
          p_credit_limit_pence: number;
          p_operation_key: string;
          p_trade_account_id: string;
        };
        Returns: {
          application_id: string;
          buyer_id: string | null;
          buyer_name: string;
          created_at: string;
          credit_limit_pence: number;
          id: string;
          status: Database["public"]["Enums"]["trade_account_status"];
          stripe_customer_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "trade_accounts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      suspend_trade_account: {
        Args: {
          p_actor_id: string;
          p_operation_key: string;
          p_reason: string;
          p_trade_account_id: string;
        };
        Returns: {
          application_id: string;
          buyer_id: string | null;
          buyer_name: string;
          created_at: string;
          credit_limit_pence: number;
          id: string;
          status: Database["public"]["Enums"]["trade_account_status"];
          stripe_customer_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "trade_accounts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      void_invoice: {
        Args: { p_provider_invoice_id: string };
        Returns: {
          amount_due_pence: number;
          amount_remaining_pence: number;
          currency: string;
          due_at: string;
          issued_at: string;
          order_id: string;
          po_number: string;
          provider_invoice_id: string;
          status: Database["public"]["Enums"]["trade_invoice_status"];
          trade_account_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "invoices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      compatibility_code_kind: "model" | "item_number" | "alias";
      credit_hold_status: "held" | "converted" | "released";
      credit_ledger_kind:
        | "approve"
        | "set_limit"
        | "suspend"
        | "hold"
        | "release"
        | "issue"
        | "payment"
        | "credit_note"
        | "void"
        | "refund"
        | "reinstate";
      order_fulfilment_status:
        | "awaiting_authorisation"
        | "ready_to_pick"
        | "picking"
        | "dispatched"
        | "cancelled";
      order_message_state: "pending" | "failed" | "sent";
      order_payment_method: "card" | "net30";
      order_payment_status:
        | "pending"
        | "invoiced"
        | "partially_paid"
        | "paid"
        | "voided"
        | "partially_refunded"
        | "refunded";
      provider_event_state: "received" | "failed" | "processed";
      publication_status: "draft" | "published" | "archived";
      staff_role: "warehouse" | "catalogue" | "finance";
      stock_movement_kind:
        "opening" | "reserve" | "release" | "dispatch" | "receive" | "restore" | "adjust";
      stock_reservation_state: "held" | "allocated" | "released" | "dispatched";
      trade_account_status: "pending" | "approved" | "suspended";
      trade_invoice_status:
        "open" | "partially_paid" | "paid" | "credited" | "voided";
      verification_state: "candidate" | "approved" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      compatibility_code_kind: ["model", "item_number", "alias"],
      credit_hold_status: ["held", "converted", "released"],
      credit_ledger_kind: [
        "approve",
        "set_limit",
        "suspend",
        "hold",
        "release",
        "issue",
        "payment",
        "credit_note",
        "void",
        "refund",
        "reinstate",
      ],
      order_fulfilment_status: [
        "awaiting_authorisation",
        "ready_to_pick",
        "picking",
        "dispatched",
        "cancelled",
      ],
      order_message_state: ["pending", "failed", "sent"],
      order_payment_method: ["card", "net30"],
      order_payment_status: [
        "pending",
        "invoiced",
        "partially_paid",
        "paid",
        "voided",
        "partially_refunded",
        "refunded",
      ],
      provider_event_state: ["received", "failed", "processed"],
      publication_status: ["draft", "published", "archived"],
      staff_role: ["warehouse", "catalogue", "finance"],
      stock_movement_kind: [
        "opening",
        "reserve",
        "release",
        "dispatch",
        "receive",
        "restore",
        "adjust",
      ],
      stock_reservation_state: ["held", "allocated", "released", "dispatched"],
      trade_account_status: ["pending", "approved", "suspended"],
      trade_invoice_status: [
        "open",
        "partially_paid",
        "paid",
        "credited",
        "voided",
      ],
      verification_state: ["candidate", "approved", "rejected"],
    },
  },
} as const;
