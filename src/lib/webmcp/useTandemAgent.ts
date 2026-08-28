"use client";

/**
 * Connects the store to the agent runtime and the browser's model context.
 *
 * React's only jobs here are to keep the runtime pointed at the current store,
 * to collect tool activity for display, and to register the tool set once.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useStore } from "../store";
import { agentRuntime, type ToolCall } from "./runtime";
import { useAgentTools, type AgentToolsStatus } from "./useAgentTools";
import type { ToolDefinition } from "./types";

const MAX_ACTIVITY = 40;

export interface TandemAgent {
  status: AgentToolsStatus;
  activity: ToolCall[];
  /** The registered definitions, so the in-page console can drive the same code. */
  tools: ToolDefinition[];
  clearActivity(): void;
}

export type { ToolCall };

export function useTandemAgent(): TandemAgent {
  const store = useStore();
  const [activity, setActivity] = useState<ToolCall[]>([]);

  // Tools resolve the store at call time, so they always see the newest one.
  useEffect(() => {
    agentRuntime.store = store;
  }, [store]);

  useEffect(() => {
    agentRuntime.listener = (call) =>
      setActivity((prev) => [call, ...prev].slice(0, MAX_ACTIVITY));
    return () => {
      agentRuntime.listener = null;
    };
  }, []);

  const tools = agentRuntime.getTools();
  const status = useAgentTools(tools);
  const clearActivity = useCallback(() => setActivity([]), []);

  return useMemo(
    () => ({ status, activity, tools, clearActivity }),
    [status, activity, tools, clearActivity],
  );
}
