"use server";

import { cookies } from "next/headers";
import { finderCookie, finderCookiePath, finderPreferenceCookie } from "@/lib/commercial/finder-cookie";
import { finderAttributionEnabled } from "@/lib/commercial/privacy";
import { localRequestMode } from "@/lib/requests/availability";

export async function setFinderAttributionPreference(allow: boolean) {
  const jar = await cookies();
  if (allow !== true || !finderAttributionEnabled()) {
    jar.delete(finderPreferenceCookie);
    jar.set(finderCookie, "", { path: finderCookiePath, maxAge: 0, sameSite: "strict", secure: !localRequestMode() });
    return;
  }
  jar.set(finderPreferenceCookie, "yes", { path: "/", sameSite: "strict", secure: !localRequestMode() });
}
