import type { Metadata } from "next";
import { getBuyerTradePosition } from "@/lib/account/trade";
import { RequestForm } from "@/components/requests/request-form";
import { RequestPage } from "@/components/requests/request-page";
import styles from "@/components/requests/request.module.css";
import { sendTradeSignInLink, signOut } from "@/lib/auth/actions";
import { getOwnTradeApplicationStatus, getVerifiedBuyer } from "@/lib/auth/server";
import { submitTradeApplication } from "@/lib/requests/actions";

export const metadata: Metadata = {
  title: "Trade accounts",
  robots: { index: false, follow: false },
};

const applicationStatus = {
  pending: { title: "Application pending", detail: "We’ll email you after we’ve reviewed your application." },
  approved: { title: "Application approved" },
  rejected: { title: "Application not approved", detail: "We’ll contact you by email about the decision." },
} satisfies Record<string, { title: string; detail?: string }>;

export default async function TradePage({ searchParams }: {
  searchParams: Promise<{ signin?: string | string[] }>;
}) {
  const buyer = await getVerifiedBuyer();

  if (!buyer) {
    const retry = (await searchParams).signin === "retry";
    return (
      <RequestPage
        overline="Trade accounts"
        title="Apply for a trade account"
        intro="Use your work email to get a sign-in link. You’ll need to open it before you can apply."
      >
        {retry && (
          <div className={styles.notice} role="status">
            <h2>We couldn’t verify the sign-in link</h2>
            <p>It may have expired or already been used. Enter your work email to get a new link.</p>
          </div>
        )}
        <RequestForm
          action={sendTradeSignInLink}
          fields={[{ name: "email", label: "Work email", type: "email", autoComplete: "email", required: true }]}
          submitLabel="Send sign-in link"
          successTitle="Check your email"
          successMessage="Open the sign-in link in your email to continue."
          keepFormOnSuccess
        />
      </RequestPage>
    );
  }

  const status = await getOwnTradeApplicationStatus();
  const trade = status === "approved" ? await getBuyerTradePosition().catch(() => null) : null;
  const approvedDetail = process.env.NET30_CHECKOUT_ENABLED !== "true" || !trade
    ? "Net 30 checkout is currently unavailable."
    : trade.status === "suspended"
      ? "Your trade credit is currently suspended. You can still pay by card."
      : "Select Pay on account (Net 30) at checkout for an order within your available credit. You’ll need a purchase order number.";
  const application: { title: string; detail?: string } =
    status === "pending" || status === "approved" || status === "rejected"
      ? applicationStatus[status]
      : { title: "Application status unavailable", detail: "Please try again shortly." };

  return (
    <RequestPage
      overline="Trade accounts"
      title={status ? "Your trade application" : "Apply for a trade account"}
      intro={status ? "You can check the status of your trade application here." : "Each trade account has one named buyer. Enter your company and UK billing address. We’ll email you after we review your application."}
    >
      {status ? (
        <div className={styles.notice} role="status">
          <h2>{application.title}</h2>
          {status === "approved" ? <p>{approvedDetail}</p> : application.detail && <p>{application.detail}</p>}
        </div>
      ) : (
        <RequestForm
          action={submitTradeApplication}
          attemptId={crypto.randomUUID()}
          fields={[
            { name: "buyerName", label: "Buyer name", autoComplete: "name", required: true },
            { name: "company", label: "Company", autoComplete: "organization", required: true },
            { name: "billingLine1", label: "Billing address line 1", autoComplete: "billing address-line1", required: true },
            { name: "billingLine2", label: "Billing address line 2 (optional)", autoComplete: "billing address-line2" },
            { name: "billingTown", label: "Town or city", autoComplete: "billing address-level2", required: true },
            { name: "billingPostcode", label: "Billing postcode", autoComplete: "billing postal-code", required: true },
          ]}
          submitLabel="Submit application"
          successTitle="Application received"
          successMessage="Your application is pending. We’ll email you after we’ve reviewed it."
        />
      )}
      <form action={signOut} className={styles.signedIn}>
        <p className="muted">Signed in as {buyer.email}</p>
        <button type="submit" className="textlink">Sign out</button>
      </form>
    </RequestPage>
  );
}
