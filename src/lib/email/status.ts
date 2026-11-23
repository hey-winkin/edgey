import type { Database } from "@/lib/supabase/database.types";

export function orderMailStatus(message?: {
  state: Database["public"]["Enums"]["order_message_state"]; delivery_uncertain: boolean;
}) {
  if (!message) return "Not queued";
  if (message.state === "sent") return "Sent";
  if (message.state === "failed") return message.delivery_uncertain ? "Send unconfirmed" : "Failed";
  return "Queued";
}
