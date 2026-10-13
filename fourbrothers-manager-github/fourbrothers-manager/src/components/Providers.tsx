"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { UiProvider } from "./ui";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <UiProvider>
      <AuthProvider>{children}</AuthProvider>
    </UiProvider>
  );
}
