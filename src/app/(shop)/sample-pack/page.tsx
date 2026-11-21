import type { Metadata } from "next";
import { connection } from "next/server";
import { RequestForm } from "@/components/requests/request-form";
import { RequestPage } from "@/components/requests/request-page";
import { submitTrialRequest } from "@/lib/requests/actions";
import { MACHINE_BRANDS } from "@/lib/requests/forms";

export const metadata: Metadata = { title: "Request a two-blade trial" };

export default async function SamplePackPage() {
  await connection();

  return (
    <RequestPage
      overline="Two-blade trial"
      title="Request two trial blades"
      intro="Ask for two free blades to try before ordering a pack. We’ll check fit, eligibility and delivery coverage. A request doesn’t guarantee delivery."
    >
      <RequestForm
        action={submitTrialRequest}
        attemptId={crypto.randomUUID()}
        fields={[
          { name: "machineBrand", label: "Machine brand", type: "select", options: MACHINE_BRANDS, required: true },
          { name: "oemCode", label: "OEM code", help: "Enter “unknown” if you don’t know the code.", required: true },
          { name: "email", label: "Work email", type: "email", autoComplete: "email", required: true },
          { name: "company", label: "Company", autoComplete: "organization", required: true },
          { name: "postcode", label: "Postcode", autoComplete: "postal-code", required: true },
        ]}
        submitLabel="Request trial blades"
        successTitle="Trial request received"
        successMessage="We’ll review your request and follow up by email. No delivery has been arranged."
      />
    </RequestPage>
  );
}
