const attachedEvent = "edgey:purchase-editor-attached";
const snapshotKey = "__edgeyEarlyPurchaseField";

export const captureEarlyPurchaseEditor = `(() => {
  const capture = ({ target: field }) => {
    if (field.form?.id !== "purchase-editor") return;
    if (field instanceof HTMLTextAreaElement) {
      field[${JSON.stringify(snapshotKey)}] = [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection];
    } else if (field instanceof HTMLSelectElement) {
      field[${JSON.stringify(snapshotKey)}] = field.value;
    }
  };
  const advance = (event) => {
    const input = event.target;
    if (event.key !== "Enter" || event.isComposing || !(input instanceof HTMLInputElement) ||
        input.form?.id !== "purchase-editor") return;
    const form = input.form;
    if (input.name === "q" || input.name === "exact") {
      event.preventDefault();
      const button = form.querySelector(input.name === "q" ? "#po-search-button" : "#po-exact-button");
      if (button && !button.disabled) form.requestSubmit(button);
    } else if (input.name.startsWith("quantity:") || input.name.startsWith("price:")) {
      event.preventDefault();
      const row = input.closest("li");
      const next = input.name.startsWith("quantity:") ? row?.querySelector('input[name^="price:"]') :
        row?.nextElementSibling?.querySelector('input[name^="quantity:"]');
      (next || form.querySelector("#po-save"))?.focus();
    }
  };
  document.addEventListener("input", capture, true);
  document.addEventListener("change", capture, true);
  document.addEventListener("keydown", advance, true);
  document.addEventListener(${JSON.stringify(attachedEvent)}, () => {
    document.removeEventListener("input", capture, true);
    document.removeEventListener("change", capture, true);
    document.removeEventListener("keydown", advance, true);
  }, { once: true });
})();`;

type Snapshot = string | [string, number, number, "forward" | "backward" | "none"];

export function restoreEarlyPurchaseFields(form: HTMLFormElement) {
  document.dispatchEvent(new Event(attachedEvent));
  for (const field of form.querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>("textarea, select")) {
    const element = field as typeof field & { [snapshotKey]?: Snapshot };
    const snapshot = element[snapshotKey];
    if (snapshot === undefined) continue;
    delete element[snapshotKey];
    if (typeof snapshot === "string") {
      element.value = snapshot;
    } else if (element instanceof HTMLTextAreaElement) {
      const [value, start, end, direction] = snapshot;
      element.value = value;
      element.setSelectionRange(start, end, direction);
    }
  }
}
