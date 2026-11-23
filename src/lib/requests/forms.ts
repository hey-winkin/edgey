export const MACHINE_BRANDS = [
  ["dyss", "DYSS"],
  ["graphtec", "Graphtec"],
  ["iecho", "iEcho"],
  ["jwei", "JWEI"],
  ["kongsberg", "Kongsberg"],
  ["mimaki", "Mimaki"],
  ["roland", "Roland"],
  ["summa", "Summa"],
  ["zund", "Zünd"],
  ["other", "Other"],
] as const;

export type RequestFormState = {
  status: "idle" | "error" | "success";
  errors?: Partial<Record<string, string>>;
  message?: string;
  photoUploadToken?: string;
};

export const initialRequestFormState: RequestFormState = { status: "idle" };
export type EnquiryKind = "compatibility" | "delivery";
export const requestTrapField = "contactHint";
export const blockedSubmission: RequestFormState = {
  status: "error",
  message: "The form couldn’t be submitted. Reload the page and try again.",
};
