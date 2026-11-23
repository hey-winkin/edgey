import { afterEach, describe, expect, it, vi } from "vitest";
import { deliveryTemplate, parseDeliveryTable } from "@/lib/admin/delivery-import";
import { deliveryToday, isDeliveryDate, parseDeliveryCost, parseDeliveryQuantity } from "@/lib/admin/deliveries";

const csv = { canManageCosts: true, csvOnly: true };
const paste = { canManageCosts: true, csvOnly: false };

describe("delivery import", () => {
  it("round-trips a blank template with the right columns for each role", () => {
    expect(deliveryTemplate(false)).toBe("code,quantity\r\n");
    expect(deliveryTemplate(true)).toBe("code,quantity,unit cost\r\n");
    expect(parseDeliveryTable(deliveryTemplate(true), csv)).toMatchObject({ ok: false });
    expect(parseDeliveryTable(deliveryTemplate(true) + "X-1,12,9.99\r\n", csv)).toEqual({
      ok: true, rows: [{ sourceRow: 2, code: "X-1", quantity: "12", unitCost: "9.99" }],
    });
  });

  it("accepts spreadsheet tabs and quoted CSV with BOM, CRLF and empty rows", () => {
    expect(parseDeliveryTable("\uFEFFCode,Quantity,Unit Cost (£)\r\n\r\n\"Demo,\"\"A\"\"\",2,£4.56\r\n", csv)).toEqual({
      ok: true, rows: [{ sourceRow: 3, code: 'Demo,"A"', quantity: "2", unitCost: "£4.56" }],
    });
    expect(parseDeliveryTable("DEMO-X\t12\t1.23\nDEMO-Y\t0", paste)).toEqual({
      ok: true, rows: [
        { sourceRow: 1, code: "DEMO-X", quantity: "12", unitCost: "1.23" },
        { sourceRow: 2, code: "DEMO-Y", quantity: "0", unitCost: "" },
      ],
    });
  });

  it("keeps missing and invalid values correctable without returning hidden costs", () => {
    expect(parseDeliveryTable("code,quantity,unit_cost\n,42,9.88\nTEST-A,\nTEST-B,-4,not-a-cost", {
      ...csv, canManageCosts: false,
    })).toEqual({
      ok: true, rows: [
        { sourceRow: 2, code: "", quantity: "42", unitCost: "" },
        { sourceRow: 3, code: "TEST-A", quantity: "", unitCost: "" },
        { sourceRow: 4, code: "TEST-B", quantity: "-4", unitCost: "" },
      ],
    });
    for (const [input, sourceRow] of [["SKU,Qty,Hidden values\nTEST-A,4,8.77", 2], ["TEST-A,4,8.77", 1]] as const) {
      expect(parseDeliveryTable(input, { ...csv, canManageCosts: false })).toEqual({
        ok: true, rows: [{ sourceRow, code: "TEST-A", quantity: "4", unitCost: "" }],
      });
    }
    expect(parseDeliveryTable("SKU,Qty,Landed unit cost (£)\nTEST-A,4,8.77", csv)).toEqual({
      ok: true, rows: [{ sourceRow: 2, code: "TEST-A", quantity: "4", unitCost: "8.77" }],
    });
  });

  it.each([
    ['code,quantity\n"TEST-A,2', /quotes on row 2/i],
    ['"TEST-A"x,2', /quotes on row 1/i],
    ["code,quantity\nTEST-A,2,1.23", /extra columns/i],
    ["code,quantity,supplier\nTEST-A,2,A", /third column/i],
    ["A".repeat(121) + ",3", /long value/i],
    ["TEST-A,3\0", /UTF-8/i],
    ['"TEST\nA",3', /single-line/i],
    ["£".repeat(65_537), /128 KB/i],
    ["TEST-A,3\n".repeat(201), /200 delivery lines/i],
  ])("rejects unsafe or malformed input %#", (input, error) => {
    expect(parseDeliveryTable(input, csv)).toEqual({ ok: false, error: expect.stringMatching(error) });
  });
});

describe("delivery values", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts only positive integer quantities in the database range", () => {
    expect(parseDeliveryQuantity(" 0004 ")).toBe(4);
    expect(parseDeliveryQuantity("2147483647")).toBe(2_147_483_647);
    for (const quantity of ["0", "-1", "+1", "1.0", "1e3", "2147483648", ""]) {
      expect(parseDeliveryQuantity(quantity)).toBeNull();
    }
  });

  it("treats unit cost as nonnegative GBP pence without floating point conversions", () => {
    expect(parseDeliveryCost("£ 4.56")).toBe(456);
    expect(parseDeliveryCost("0")).toBe(0);
    for (const cost of ["1.001", "1e3", "$4.56", "-3", "21474836.48", ""]) expect(parseDeliveryCost(cost)).toBeNull();
  });

  it("uses the UK calendar day and rejects impossible and future dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-19T23:15:00Z"));
    expect(deliveryToday()).toBe("2024-06-20");
    expect(isDeliveryDate("2024-06-20")).toBe(true);
    expect(isDeliveryDate("2024-02-29")).toBe(true);
    for (const date of ["2024-06-21", "2024-02-30", "2024-2-2", "0000-01-01", "today"]) expect(isDeliveryDate(date)).toBe(false);
  });
});
