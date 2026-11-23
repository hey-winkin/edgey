const attachedEvent = "edgey:receipt-editor-attached";
const snapshotKey = "__edgeyEarlyReceiptText";

export const captureEarlyDeliveryText = `(() => {
  const capture = ({ target: field }) => {
    if (field instanceof HTMLTextAreaElement && field.form?.id === "receipt-editor" &&
        (field.name === "note" || field.name === "paste")) {
      field[${JSON.stringify(snapshotKey)}] = [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection];
    }
  };
  const advance = (event) => {
    const field = event.target;
    if (event.key !== "Enter" || event.isComposing ||
        !(field instanceof HTMLInputElement) || field.form?.id !== "receipt-editor") return;
    const [kind, id] = field.name.split(":");
    if (kind !== "code" && kind !== "quantity" && kind !== "unitCost") return;
    const form = field.form;
    const next = kind === "code" ? form.elements.namedItem("quantity:" + id)
      : kind === "quantity" ? form.elements.namedItem("unitCost:" + id) : null;
    const nextRow = field.closest("li")?.nextElementSibling?.querySelector('input[name^="code:"]');
    event.preventDefault();
    (next || nextRow || form.querySelector('button[value="add"]:not(:disabled)') || form.querySelector("#receipt-review"))?.focus();
  };
  document.addEventListener("input", capture, true);
  document.addEventListener("keydown", advance, true);
  document.addEventListener(${JSON.stringify(attachedEvent)}, () => {
    document.removeEventListener("input", capture, true);
    document.removeEventListener("keydown", advance, true);
  }, { once: true });
})();`;

export function restoreEarlyDeliveryText(form: HTMLFormElement) {
  document.dispatchEvent(new Event(attachedEvent));
  for (const name of ["note", "paste"]) {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLTextAreaElement)) continue;
    const textarea = field as HTMLTextAreaElement & {
      [snapshotKey]?: [value: string, start: number, end: number, direction: "forward" | "backward" | "none"];
    };
    const snapshot = textarea[snapshotKey];
    if (!snapshot) continue;
    delete textarea[snapshotKey];
    const [value, start, end, direction] = snapshot;
    if (textarea.value !== value) {
      textarea.value = value;
      textarea.setSelectionRange(start, end, direction);
    }
  }
}
