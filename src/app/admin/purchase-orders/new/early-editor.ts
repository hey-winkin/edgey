const attachedEvent = "edgey:purchase-editor-attached";

export const captureEarlyPurchaseEditor = `(() => {
  const drafts = new Map();
  const snapshot = (field, value) => {
    if (!(field instanceof HTMLInputElement)) return;
    drafts.set(field.name, value);
    field.value = value;
  };
  const capture = ({ target: field }) => {
    if (field.form?.id !== "purchase-editor" || !field.name) return;
    snapshot(field.form.elements.namedItem("edited:" + field.name), "1");
    if (field.name?.startsWith("part:")) {
      const part = field.form.elements.namedItem("part_edit:" + field.name.slice(5));
      const supplier = field.form.elements.namedItem("supplier_id");
      snapshot(part, supplier?.value || "none");
    }
    if (field instanceof HTMLTextAreaElement) {
      drafts.set(field.name, [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]);
    } else if (field instanceof HTMLInputElement) {
      drafts.set(field.name, field.type === "checkbox" ? field.checked : field.type === "file" ? field.files : field.value);
    } else if (field instanceof HTMLSelectElement) {
      drafts.set(field.name, field.value);
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
  document.addEventListener(${JSON.stringify(attachedEvent)}, ({ detail: form }) => {
    document.removeEventListener("input", capture, true);
    document.removeEventListener("change", capture, true);
    document.removeEventListener("keydown", advance, true);
    for (const [name, value] of drafts) {
      const field = form.elements.namedItem(name);
      if (!field) continue;
      if (typeof value === "string") field.value = value;
      else if (field instanceof HTMLInputElement) {
        if (typeof value === "boolean") field.checked = value;
        else if (value instanceof FileList) field.files = value;
      } else if (field instanceof HTMLTextAreaElement && Array.isArray(value)) {
        const [text, start, end, direction] = value;
        field.value = text;
        field.setSelectionRange(start, end, direction);
      }
    }
  }, { once: true });
})();`;

export function restoreEarlyPurchaseFields(form: HTMLFormElement) {
  document.dispatchEvent(new CustomEvent(attachedEvent, { detail: form }));
}
