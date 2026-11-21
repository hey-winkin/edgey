import { signOutFromStaffMenu } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { signInStaff } from "./admin-fixtures";

test("requests inbox shows states only for the signed-in staff role", async ({ page }) => {
  const db = localAdminClient();
  const buyer = await createLocalAdminUser("buyer");
  const id = randomUUID();
  const company = `Fixture print room ${id.slice(0, 8)}`;
  const [enquiry, trial, trade] = await Promise.all([
    db.rpc("submit_enquiry", {
      p_id: id, p_kind: "compatibility", p_email: buyer.email, p_query: "Fixture blade",
      p_message: "Can you confirm the correct option?",
    }),
    db.rpc("submit_trial_request", {
      p_id: randomUUID(), p_machine_brand: "Zünd", p_oem_code: "3910301",
      p_email: buyer.email, p_company: company, p_postcode: "SW1A 1AA",
    }),
    db.rpc("submit_trade_application", {
      p_id: randomUUID(), p_buyer_id: buyer.id, p_buyer_name: "Alex Fixture", p_company: company,
      p_billing_line1: "1 Fixture Lane", p_billing_town: "London", p_billing_postcode: "SW1A 1AA",
    }),
  ]);
  if (enquiry.error || trial.error || trade.error) throw enquiry.error ?? trial.error ?? trade.error;

  await signInStaff(page, await createLocalAdminUser("warehouse"));
  await page.goto("/admin/requests");
  const enquiryRow = page.getByRole("table", { name: "Enquiries" }).getByRole("row").filter({ hasText: buyer.email });
  await expect(enquiryRow).toContainText("Open");
  const trialRow = page.getByRole("table", { name: "Trial requests" }).getByRole("row").filter({ hasText: company });
  await expect(trialRow).toContainText("Pending");
  await expect(page.getByRole("table", { name: "Trade applications" })).toHaveCount(0);

  await signOutFromStaffMenu(page);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await signInStaff(page, await createLocalAdminUser("finance"));
  await page.goto("/admin/requests");
  const tradeRow = page.getByRole("table", { name: "Trade applications" }).getByRole("row").filter({ hasText: company });
  await expect(tradeRow).toContainText("Pending");
  await expect(page.getByRole("table", { name: "Enquiries" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Trial requests" })).toHaveCount(0);
});
