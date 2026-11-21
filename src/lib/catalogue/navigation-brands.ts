import "server-only";
import { unstable_cache } from "next/cache";
import { publicClient } from "./supabase";

const readNavigationBrands = unstable_cache(async () => {
  const { data, error } = await publicClient().from("brands").select("slug, name")
    .order("name").abortSignal(AbortSignal.timeout(1000));
  if (error) throw error;
  return data as { name: string; slug: string }[];
}, ["storefront-navigation-brands"], { revalidate: 60 });

export async function getNavigationBrands() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    return await readNavigationBrands();
  } catch {
    console.error("Could not load public machine links for the shop menu.");
    return null;
  }
}
