import { expect, it } from "vitest";
import {
  defaultDeliveryChoice, deliveryChoiceValue, OTHER_DELIVERY, resolveDeliveryChoice,
} from "@/lib/admin/carrier";

const generic = { service: "Next working day", carrier: null };
const registered = { service: "Fixture tracked", carrier: "Fixture Parcel" };

function form(selection: string, carrier = "", service = "") {
  const fields = new FormData();
  fields.set("deliveryChoice", selection);
  fields.set("carrier", carrier);
  fields.set("service", service);
  return fields;
}

it("defaults dispatch only when the order snapshot matches one configured carrier and service", () => {
  const choices = [generic, registered];
  expect(defaultDeliveryChoice(choices, registered.service, true)).toBe(deliveryChoiceValue(registered));
  expect(defaultDeliveryChoice(choices, "Fixture tracked old name", true)).toBe(OTHER_DELIVERY);
  expect(defaultDeliveryChoice(choices, generic.service, true)).toBe(OTHER_DELIVERY);
  expect(defaultDeliveryChoice([...choices, { ...registered, carrier: "Another carrier" }], registered.service, true)).toBe(OTHER_DELIVERY);
  expect(defaultDeliveryChoice([...choices, { ...registered, carrier: null }], registered.service, true)).toBe(OTHER_DELIVERY);
});

it("rejects removed or forged configured choices rather than trusting submitted carrier data", () => {
  const selection = deliveryChoiceValue(registered);
  const posted = form(selection, "Do not use", "Do not use");
  expect(resolveDeliveryChoice(posted, [generic, { ...registered, carrier: "Replacement" }], true))
    .toEqual({ ok: false, reason: "stale" });
  expect(resolveDeliveryChoice(posted, [registered], true))
    .toEqual({ ok: true, ...registered });
  expect(resolveDeliveryChoice(form(deliveryChoiceValue(generic), "Fixture Parcel"), [generic], true))
    .toEqual({ ok: false, reason: "stale" });
});

it("reuses configured trial service labels without guessing a carrier", () => {
  const choices = [generic, registered];
  expect(defaultDeliveryChoice(choices, generic.service, false)).toBe(deliveryChoiceValue(generic));
  expect(resolveDeliveryChoice(form(deliveryChoiceValue(generic)), choices, false)).toEqual({ ok: false, reason: "missing" });
  expect(resolveDeliveryChoice(form(deliveryChoiceValue(generic), "  Fixture Parcel  ", "Ignore"), choices, false))
    .toEqual({ ok: true, carrier: "Fixture Parcel", service: generic.service });
  expect(resolveDeliveryChoice(form(deliveryChoiceValue(registered)), choices, false)).toEqual({ ok: true, ...registered });
});

it("retains the original carrier and service validation for Other", () => {
  expect(resolveDeliveryChoice(form(OTHER_DELIVERY, " Custom Parcel "), [], true))
    .toEqual({ ok: true, carrier: "Custom Parcel", service: "" });
  expect(resolveDeliveryChoice(form(OTHER_DELIVERY, " Custom Parcel ", " Custom tracked "), [], false))
    .toEqual({ ok: true, carrier: "Custom Parcel", service: "Custom tracked" });
  expect(resolveDeliveryChoice(form(OTHER_DELIVERY, ""), [], true)).toEqual({ ok: false, reason: "missing" });
  expect(resolveDeliveryChoice(form(OTHER_DELIVERY, "X".repeat(101)), [], true)).toEqual({ ok: false, reason: "missing" });
  expect(resolveDeliveryChoice(form(OTHER_DELIVERY, "Custom Parcel"), [], false)).toEqual({ ok: false, reason: "missing" });
});
