import type { Metadata } from "next";
import { CheckoutReview } from "@/components/checkout-review";
import type { CheckoutTrade } from "@/components/checkout-payment-method";
import { getBuyerTradePosition } from "@/lib/account/trade";
import { getVerifiedBuyer } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

async function readTrade(): Promise<CheckoutTrade> {
  try {
    if (!await getVerifiedBuyer()) return { status: "guest" };
    const trade = await getBuyerTradePosition();
    if (trade?.status === "approved" || trade?.status === "suspended") {
      return { status: trade.status, availableCreditPence: trade.availableCreditPence };
    }
    return { status: "not-approved" };
  } catch {
    return { status: "unavailable" };
  }
}

export default async function CheckoutPage() {
  const trade = process.env.NET30_CHECKOUT_ENABLED === "true" ? await readTrade() : null;
  return (
    <main id="main-content" tabIndex={-1} className="frame checkout">
      <div className="checkout-heading">
        <p className="kicker"><span className="register" aria-hidden="true" /> Trade orders</p>
        <h1>Checkout</h1>
        <p className="muted">Review your selection and tell us where to deliver it.</p>
      </div>
      <CheckoutReview trade={trade} />
    </main>
  );
}
