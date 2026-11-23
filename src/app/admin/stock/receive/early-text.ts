const attachedEvent = "edgey:receipt-editor-attached";
const snapshotKey = "__edgeyEarlyReceiptText";

export const captureEarlyDeliveryText = `(() => {
  const capture = ({ target: field }) => {
    if (field instanceof HTMLTextAreaElement && field.form?.id === "receipt-editor" &&
        (field.name === "note" || field.name === "paste")) {
      field[${JSON.stringify(snapshotKey)}] = [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection];
    }
  };
  document.addEventListener("input", capture, true);
  document.addEventListener(${JSON.stringify(attachedEvent)}, () => {
    document.removeEventListener("input", capture, true);
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
