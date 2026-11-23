export type StaffDeliveryChoice = { service: string; carrier: string | null };

export const OTHER_DELIVERY = "other";

export function validDeliveryLabel(value: string) {
  return value.length > 0 && value.length <= 100 &&
    ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export function deliveryChoiceValue({ service, carrier }: StaffDeliveryChoice) {
  return JSON.stringify([service, carrier]);
}

export function defaultDeliveryChoice(choices: StaffDeliveryChoice[], service: string | null, dispatch: boolean) {
  const matches = choices.filter((choice) => choice.service === service);
  const match = matches.length === 1 ? matches[0] : undefined;
  return match && (!dispatch || match.carrier) ? deliveryChoiceValue(match) : OTHER_DELIVERY;
}

export function resolveDeliveryChoice(form: FormData, choices: StaffDeliveryChoice[], dispatch: boolean) {
  const selected = form.get("deliveryChoice");
  const configured = choices.find((choice) => deliveryChoiceValue(choice) === selected);
  if (selected !== OTHER_DELIVERY && (!configured || (dispatch && !configured.carrier))) {
    return { ok: false, reason: "stale" } as const;
  }

  const carrierField = form.get("carrier");
  const serviceField = form.get("service");
  const carrier = configured?.carrier ?? (typeof carrierField === "string" ? carrierField.trim() : "");
  const service = configured?.service ?? (typeof serviceField === "string" ? serviceField.trim() : "");
  if (!carrier || carrier.length > 100 || (!dispatch && (!service || service.length > 100))) {
    return { ok: false, reason: "missing" } as const;
  }
  return { ok: true, carrier, service } as const;
}
