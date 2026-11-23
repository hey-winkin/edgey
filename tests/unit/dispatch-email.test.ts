import { expect, test } from "vitest";
import { renderDispatch, trackingUrl } from "@/lib/email/dispatch";

const shipment = {
  kind: "order" as const, reference: "EDG-TEST-1", email: "buyer@example.test",
  service: "Booked service", carrier: "Fixture & Carrier", tracking: "ABC 123/?&",
  recipient_name: "Alex <Example>", address_line1: "1 & 2 Fixture Lane", address_line2: null,
  address_town: "Test Town", address_region: null, address_postcode: "SW1A 1AA", address_country: "GB",
};
const items = [{ sku: "TEST-SKU", option_label: "45° <label>", quantity: 2 }];
const pattern = "https://carrier.example.test/track?code={tracking}&lang=en";

test("renders the recorded shipment and address in text and escaped HTML", () => {
  const email = renderDispatch(shipment, items, "order@example.test", pattern);
  expect(email.to).toEqual([shipment.email]);
  expect(email.subject).toBe("Edgey order dispatched: EDG-TEST-1");
  expect(email.text).toContain("Order reference: EDG-TEST-1");
  expect(email.text).toContain("TEST-SKU — 45° <label>: 2");
  expect(email.text).toContain([
    "Delivery service: Booked service", "Carrier: Fixture & Carrier", "Tracking number: ABC 123/?&",
    "Track your parcel: https://carrier.example.test/track?code=ABC%20123%2F%3F%26&lang=en",
  ].join("\n"));
  expect(email.text).toContain("Delivery address:\nAlex <Example>\n1 & 2 Fixture Lane\nTest Town\nSW1A 1AA\nGB");
  expect(email.html).toContain('<th scope="col">Quantity</th>');
  expect(email.html).toContain("45° &lt;label&gt;");
  expect(email.html).toContain("Fixture &amp; Carrier");
  expect(email.html).toContain("Alex &lt;Example&gt;<br>1 &amp; 2 Fixture Lane");
  expect(email.html).toContain('href="https://carrier.example.test/track?code=ABC%20123%2F%3F%26&amp;lang=en"');
  expect(email.text).not.toMatch(/estimated delivery|will arrive/i);
});

test.each([
  null, "javascript:alert({tracking})", "//carrier.example.test/id/{tracking}",
  "http://carrier.example.test/id/{tracking}", "https://carrier.example.test/id",
  "https://carrier.example.test/{tracking}/{tracking}", "https://{tracking}.example.test/",
  "https://person:password@carrier.example.test/{tracking}", "https://carrier.example.test\\path/{tracking}",
])("omits the link for missing or unsafe tracking template %s", (template) => {
  expect(trackingUrl(template, shipment.tracking)).toBeNull();
  const email = renderDispatch(shipment, items, "order@example.test", template);
  expect(email.html).not.toContain("<a ");
  expect(email.text).not.toContain("Track your parcel:");
  expect(email.text).toContain("Tracking number: ABC 123/?&");
});

test("labels trial references without implying payment and rejects multiple addresses", () => {
  const trial = { ...shipment, kind: "trial" as const, reference: "trial-test" };
  const email = renderDispatch(trial, items, "order@example.test");
  expect(email.subject).toBe("Edgey trial pack dispatched: trial-test");
  expect(email.text).toContain("Trial reference: trial-test");
  expect(email.text).not.toMatch(/paid|order reference/i);
  expect(() => renderDispatch({ ...trial, email: "buyer@example.test,extra@example.test" }, items, "order@example.test"))
    .toThrow("Cannot render");
});

test("does not produce a link if a tracking number would normalise the URL path", () => {
  expect(trackingUrl("https://carrier.example.test/parcel/{tracking}", "..")).toBeNull();
});
