"use client";

/**
 * Registers a set of tools with the browser's model context for as long as the
 * component is mounted.
 *
 * The tool array must be referentially stable. Tools read live application
 * state through the runtime rather than through their closure, so registration
 * happens once and the agent never sees the tool list churn underneath it while
 * the page re-renders.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { detectSupport, getModelContext, type SupportLevel, type ToolDefinition } from "./types";

export interface AgentToolsStatus {
  support: SupportLevel;
  /** Names successfully registered with the browser. */
  registered: string[];
  /** Set when registration failed, for display in the UI. */
  error: string | null;
}

/**
 * WebMCP support cannot change during a page's life, so the subscription is a
 * no-op. `useSyncExternalStore` is here for its second job: giving the server
 * render a defined answer without an effect that would immediately re-render.
 */
const subscribe = () => () => {};
const getServerSupport = (): SupportLevel => "unsupported";

interface Registration {
  registered: string[];
  error: string | null;
}

const NOT_REGISTERED: Registration = { registered: [], error: null };

export function useAgentTools(tools: ToolDefinition[]): AgentToolsStatus {
  const support = useSyncExternalStore(subscribe, detectSupport, getServerSupport);
  const [registration, setRegistration] = useState<Registration>(NOT_REGISTERED);

  useEffect(() => {
    const ctx = getModelContext();
    if (!ctx || tools.length === 0) return;

    const controller = new AbortController();

    void (async () => {
      const registered: string[] = [];
      try {
        for (const tool of tools) {
          await ctx.registerTool(tool, { signal: controller.signal });
          if (controller.signal.aborted) return;
          registered.push(tool.name);
        }
        setRegistration({ registered, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setRegistration({
          registered,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => controller.abort();
  }, [tools]);

  return useMemo(
    () => ({ support, registered: registration.registered, error: registration.error }),
    [support, registration],
  );
}
