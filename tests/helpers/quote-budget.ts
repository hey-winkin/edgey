import { createHmac } from "node:crypto";
import type { Client } from "pg";

export async function resetBrowserQuoteBudget(db: Client) {
  const key = process.env.EDGEY_BROWSER_REQUEST_KEY;
  if (!key) throw new Error("The local Playwright server must set the browser request key.");
  const ip = createHmac("sha256", key).update("ip\0local").digest("hex");
  await db.query(
    "delete from private.request_rate_limits where scope = 'selection_quote' and dimension = 'ip' and key = $1",
    [ip],
  );
}

export async function withExhaustedQuoteBudget(db: Client, ipKey: string, runCheckout: () => Promise<void>) {
  await db.query(`
    insert into private.request_rate_limits (scope, dimension, key, attempts, expires_at)
    values ('selection_quote', 'ip', $1, 120, now() + interval '1 hour')
  `, [ipKey]);
  try {
    await runCheckout();
    const { rows } = await db.query(`
      select attempts from private.request_rate_limits where scope = 'selection_quote' and dimension = 'ip' and key = $1
    `, [ipKey]);
    if (rows[0]?.attempts !== 120) throw new Error("Checkout changed the public quote budget.");
  } finally {
    await db.query("delete from private.request_rate_limits where scope = 'selection_quote' and dimension = 'ip' and key = $1", [ipKey]);
  }
}
