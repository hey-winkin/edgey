import type { BasketTotals, LineRequest } from "@/lib/commerce";
import type { DispatchTiming } from "@/lib/commerce/dispatch";

export type QuoteResult =
  | { status: "error"; message: string }
  | {
      status: "ok";
      lines: LineRequest[];
      corrections: string[];
      basket: BasketTotals | null;
      freeDeliveryMessage: string | null;
      dispatchDate: string | null;
      dispatchTiming: DispatchTiming | null;
      estimatedDeliveryDate: string | null;
      coverage: "unchecked" | "covered" | "unsupported" | "invalid";
      postcode?: string;
      photos?: Record<string, string>;
      productNames?: Record<string, string>;
      quoteKey: string;
    };

export type CheckoutFields = {
  businessName: string;
  buyingForWork: boolean;
  email: string;
  recipientName: string;
  line1: string;
  line2: string;
  town: string;
  region: string;
  postcode: string;
};

export type CheckoutAttemptInput = {
  attemptToken: string;
  lines: readonly LineRequest[];
  fields: CheckoutFields;
  quoteKey: string;
};

export type CheckoutReviewResult =
  | { status: "payment-unavailable" }
  | { status: "invalid"; errors: Partial<Record<keyof CheckoutFields, string>>; message: string }
  | { status: "review"; quote: QuoteResult; message: string }
  | { status: "error"; message: string };
