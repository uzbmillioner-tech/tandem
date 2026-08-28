"use client";

/**
 * Tandem runs as a single client-rendered page on purpose.
 *
 * WebMCP tools must be registered from the top-level document — tools inside an
 * iframe are not discoverable, and a route change would tear down and re-register
 * the set underneath an agent mid-conversation. Keeping one page and switching
 * sections in client state means the tool surface is stable for as long as the
 * tab is open.
 */

import { AppShell } from "@/components/AppShell";
import { StoreProvider } from "@/lib/store";

export default function Page() {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  );
}
