import type { Metadata } from "next";
import { RequestForm, type RequestField } from "@/components/requests/request-form";
import { RequestPage } from "@/components/requests/request-page";
import { queryValue, type RouteQuery } from "@/lib/catalogue";
import { submitEnquiry } from "@/lib/requests/actions";
import { MACHINE_BRANDS } from "@/lib/requests/forms";

type Props = { searchParams: Promise<RouteQuery> };

export const metadata: Metadata = {
  title: "Enquiries",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default async function EnquiryPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = queryValue(params.q);
  const postcode = queryValue(params.postcode);
  const delivery = params.postcode !== undefined || queryValue(params.kind) === "delivery";
  const kind = delivery ? "delivery" : "compatibility";
  const fields: RequestField[] = [
    delivery
      ? { name: "postcode", label: "Delivery postcode", initialValue: postcode, autoComplete: "postal-code", required: true }
      : { name: "query", label: "Your search", initialValue: query, maxLength: 80, help: "Optional. Enter a part number or the text from your search." },
    { name: "email", label: "Reply email", type: "email", autoComplete: "email", required: true },
  ];
  if (!delivery) fields.push({ name: "machineBrand", label: "Machine brand (optional)", type: "select", options: MACHINE_BRANDS });
  fields.push({
    name: "message",
    label: "Message",
    type: "textarea",
    required: true,
    help: delivery ? "Tell us what you’d like to know about delivery." : "Tell us what you know about the blade, tool or holder.",
  });

  return (
    <RequestPage
      overline={delivery ? "Delivery enquiry" : "Compatibility enquiry"}
      title={delivery ? "Ask about delivery" : "Ask us to match this blade"}
      intro={delivery ? "We’ll check which delivery options are available for your postcode and reply by email." : "Send us the details you have and we’ll reply by email to help you check the fit."}
    >
      <RequestForm
        key={JSON.stringify([kind, delivery ? postcode : query])}
        action={submitEnquiry.bind(null, kind)}
        attemptId={crypto.randomUUID()}
        fields={fields}
        submitLabel="Send enquiry"
        successTitle="Enquiry received"
        successMessage="We’ll reply by email."
      />
    </RequestPage>
  );
}
