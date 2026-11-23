import {
  hasDeliveryControlCharacters, MAX_DELIVERY_CODE_LENGTH, MAX_DELIVERY_IMPORT_BYTES, MAX_DELIVERY_ROWS,
  type ImportedDeliveryRow,
} from "./deliveries";

export function deliveryTemplate(canManageCosts: boolean) {
  return `code,quantity${canManageCosts ? ",unit cost" : ""}\r\n`;
}

export function parseDeliveryTable(input: string, options: { csvOnly: boolean; canManageCosts: boolean }):
  { ok: true; rows: ImportedDeliveryRow[] } | { ok: false; error: string } {
  if (new TextEncoder().encode(input).byteLength > MAX_DELIVERY_IMPORT_BYTES) {
    return { ok: false, error: "Use a table no larger than 128 KB." };
  }
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return { ok: false, error: "Add a table with at least one delivery line." };
  if (text.includes("\0")) return { ok: false, error: "Use a plain UTF-8 spreadsheet export." };
  const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
  const separator = !options.csvOnly && firstLine.replace(/"(?:[^"]|"")*"/g, "").includes("\t") ? "\t" : ",";

  const rows: ImportedDeliveryRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let line = 1;
  let sourceRow = 1;
  let columnCount = 3;
  let first = true;

  for (let index = 0; index <= text.length; index++) {
    const char = index === text.length ? "\n" : text[index];
    if (quoted && index < text.length) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else {
        field += char;
        if (char === "\n") line++;
      }
      continue;
    }
    if (quoted || (closed && char !== separator && char !== "\n")) {
      return { ok: false, error: `Check the quotes on row ${sourceRow}.` };
    }
    if (char === separator || char === "\n") {
      fields.push(field.trim());
      field = "";
      closed = false;
      if (fields.length > columnCount) {
        return { ok: false, error: `Row ${sourceRow} has extra columns. Check the column order against the blank template.` };
      }
      if (char === separator) continue;

      if (fields.some(Boolean)) {
        const [code = "", quantity = "", unitCost = ""] = fields;
        const header = first && code.toLowerCase() === "code" && quantity.toLowerCase() === "quantity";
        if (header) {
          if (fields.length === 3 && !/^unit[ _]+cost(?:\s*\(£\))?$/i.test(unitCost)) {
            return { ok: false, error: options.canManageCosts
              ? "Name the third column unit cost, or remove it."
              : "Use the blank template to check your column headings." };
          }
          columnCount = fields.length;
        } else {
          if (rows.length === MAX_DELIVERY_ROWS) {
            return { ok: false, error: `Import up to ${MAX_DELIVERY_ROWS} delivery lines at a time.` };
          }
          if (code.length > MAX_DELIVERY_CODE_LENGTH || quantity.length > MAX_DELIVERY_CODE_LENGTH ||
              (options.canManageCosts && unitCost.length > MAX_DELIVERY_CODE_LENGTH)) {
            return { ok: false, error: `Row ${sourceRow} contains an unusually long value. Check the table columns.` };
          }
          if ([code, quantity, options.canManageCosts ? unitCost : ""].some(hasDeliveryControlCharacters)) {
            return { ok: false, error: `Use single-line values in row ${sourceRow}.` };
          }
          rows.push({ sourceRow, code, quantity, unitCost: options.canManageCosts ? unitCost : "" });
        }
        first = false;
      }
      fields = [];
      sourceRow = ++line;
    } else if (char === '"') {
      if (field) return { ok: false, error: `Check the quotes on row ${sourceRow}.` };
      quoted = true;
    } else {
      field += char;
    }
  }
  return rows.length ? { ok: true, rows } : { ok: false, error: "Add at least one delivery line below the headings." };
}
