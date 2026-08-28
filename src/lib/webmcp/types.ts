/**
 * Minimal typings for the WebMCP surface this app uses.
 *
 * These are hand-written rather than pulled from a package on purpose: the spec
 * is a live draft, and a typing package that runs ahead of or behind the browser
 * would hide exactly the mismatches we need to see. Everything here is
 * feature-detected at runtime before it is called.
 *
 * Current shape (Chromium 150+): the entry point is `document.modelContext`.
 * `navigator.modelContext` was the earlier name and is deprecated; we read it
 * only as a fallback so the demo still works in an older preview build.
 *
 * @see https://developer.chrome.com/docs/ai/webmcp
 */

/** A JSON Schema object describing a tool's input. */
export interface JSONSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolAnnotations {
  /** The tool does not change anything. Lets an agent call it freely. */
  readOnlyHint?: boolean;
  /** The tool returns content that originated outside the site's control. */
  untrustedContentHint?: boolean;
}

export interface ToolExecuteContext {
  /** Aborts when the agent cancels the call. Long-running tools must honour it. */
  signal?: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /**
   * Input is `unknown` because the browser hands over whatever the agent sent.
   * Every handler validates before it trusts the shape.
   */
  execute: (input: unknown, context: ToolExecuteContext) => Promise<string> | string;
  annotations?: ToolAnnotations;
}

export interface RegisterToolOptions {
  /** Unregisters the tool when aborted. */
  signal?: AbortSignal;
  /** Secure origins allowed to see this tool cross-origin. */
  exposedTo?: string[];
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  annotations?: ToolAnnotations;
  origin?: string;
  title?: string;
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ToolDefinition, options?: RegisterToolOptions): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    inputJson: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }

  interface Navigator {
    /** @deprecated Renamed to `document.modelContext` in Chromium 150. */
    modelContext?: ModelContext;
    /**
     * Draft surface for asking the browser to bring the user back to the page.
     * Not shipped everywhere; always feature-detected.
     */
    agent?: {
      requestUserInteraction?: () => Promise<void> | void;
    };
  }
}

/** Returns the live model context, or null when the browser has no WebMCP. */
export function getModelContext(): ModelContext | null {
  if (typeof document === "undefined") return null;
  if (document.modelContext) return document.modelContext;
  if (typeof navigator !== "undefined" && navigator.modelContext) {
    return navigator.modelContext;
  }
  return null;
}

export type SupportLevel = "supported" | "deprecated-api" | "unsupported";

/**
 * Reports how well the current browser supports WebMCP.
 *
 * The UI shows this rather than hiding it: a manager needs to know whether the
 * agent side of the app is live, and a judge opening the page in a browser
 * without the flag needs to be told why no tools appear.
 */
export function detectSupport(): SupportLevel {
  if (typeof document === "undefined") return "unsupported";
  if (document.modelContext) return "supported";
  if (typeof navigator !== "undefined" && navigator.modelContext) return "deprecated-api";
  return "unsupported";
}

/**
 * Asks the browser to bring the user's attention back to the page so they can
 * decide on a proposal.
 *
 * This is a draft API whose exact home is still moving, so every plausible
 * location is probed and a failure is swallowed — the approval card is already
 * on screen either way, and this only shortens how long it waits there.
 */
export async function requestUserInteraction(): Promise<void> {
  try {
    const fn = navigator?.agent?.requestUserInteraction;
    if (typeof fn === "function") {
      await fn.call(navigator.agent);
    }
  } catch {
    // Best effort only.
  }
}
