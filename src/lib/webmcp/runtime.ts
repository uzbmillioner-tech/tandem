"use client";

/**
 * The agent runtime — the tool set, built once, outside React.
 *
 * Tools have to outlive every render: they are handed to the browser at
 * registration and the agent may call one at any moment afterwards. Building
 * them inside a component would mean either rebuilding them on each render or
 * reaching into refs during render, so they live here instead and React just
 * points them at the current store.
 *
 * This object is the "external system" the hooks synchronise with.
 */

import type { StoreApi } from "../store";
import { createTools } from "./tools";
import type { ToolDefinition } from "./types";

export interface ToolCall {
  id: string;
  toolName: string;
  /** First line of the result — enough to see what happened at a glance. */
  summary: string;
  at: string;
}

class AgentRuntime {
  private tools: ToolDefinition[] | null = null;
  private counter = 0;

  /** Set by the provider on every store change. */
  store: StoreApi | null = null;

  /** Set while a component is listening for tool activity. */
  listener: ((call: ToolCall) => void) | null = null;

  getTools(): ToolDefinition[] {
    if (!this.tools) {
      this.tools = createTools({
        getStore: () => {
          if (!this.store) {
            throw new Error("Tandem is still starting up — try that again in a moment.");
          }
          return this.store;
        },
        onCall: (toolName, summary) => {
          this.counter += 1;
          this.listener?.({
            id: `call_${Date.now().toString(36)}_${this.counter.toString(36)}`,
            toolName,
            summary,
            at: new Date().toISOString(),
          });
        },
      });
    }
    return this.tools;
  }
}

export const agentRuntime = new AgentRuntime();
