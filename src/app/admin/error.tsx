"use client";

import { StaffError } from "@/components/staff-error";

export default function AdminError({ reset }: { reset: () => void }) {
  return <StaffError reset={reset} />;
}
