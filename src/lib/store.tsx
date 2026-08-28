"use client";

/**
 * The single source of truth, shared by the human's UI and the agent's tools.
 *
 * Both operate on exactly this state — that is the point of the app. The agent
 * does not get a private API that drifts from what the manager sees; it reads
 * and proposes against the same store that renders the screen.
 *
 * Two responsibilities live here that a plain reducer cannot hold:
 *
 *  1. **Pending decisions.** A write tool's promise stays unresolved while a
 *     proposal sits on screen. The resolvers live in a ref, keyed by proposal
 *     id, and are settled by a human decision, a standing approval, a timeout,
 *     or the agent aborting the call.
 *  2. **Hydration.** The seed is anchored to the current clock, so it is built
 *     after mount to keep the server and client renders identical.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { createSeedState } from "./seed";
import { applyProposal, matchStandingApproval } from "./proposals";
import type {
  AppState,
  AuditEntry,
  BranchId,
  Proposal,
  ProposalStatus,
  StandingApproval,
  ViewId,
} from "./types";

const STORAGE_KEY = "tandem.state.v1";

/** How long a proposal waits for a human before it lapses. */
export const DECISION_TIMEOUT_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "set_view"; view: ViewId }
  | { type: "set_focus"; branchId: BranchId | null }
  | { type: "set_highlight"; id: string | null }
  | { type: "add_proposal"; proposal: Proposal }
  | { type: "resolve_proposal"; proposalId: string; status: ProposalStatus; note?: string; at: string }
  | { type: "grant_standing"; approval: StandingApproval }
  | { type: "consume_standing"; approvalId: string }
  | { type: "revoke_standing"; approvalId: string }
  | { type: "audit"; entry: AuditEntry }
  | { type: "reset"; state: AppState };

/**
 * Hydration is tracked inside the reducer rather than in its own `useState`.
 *
 * The seed is anchored to the wall clock, so it can only be built on the client;
 * folding "has that happened yet" into the same transition that installs it
 * keeps the flag and the data from ever disagreeing, and avoids a second state
 * update chasing the first.
 */
interface StoreState {
  app: AppState;
  hydrated: boolean;
}

function reducer(store: StoreState, action: Action): StoreState {
  if (action.type === "hydrate" || action.type === "reset") {
    return { app: action.state, hydrated: true };
  }
  return { ...store, app: appReducer(store.app, action) };
}

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
    case "reset":
      return action.state;

    case "set_view":
      return { ...state, view: action.view };

    case "set_focus":
      return { ...state, focusedBranchId: action.branchId };

    case "set_highlight":
      return { ...state, highlightedId: action.id };

    case "add_proposal":
      return { ...state, proposals: [action.proposal, ...state.proposals] };

    case "resolve_proposal": {
      const proposal = state.proposals.find((p) => p.id === action.proposalId);
      if (!proposal || proposal.status !== "pending") return state;

      const decided: Proposal = {
        ...proposal,
        status: action.status,
        decidedAt: action.at,
        decisionNote: action.note,
      };

      const withDecision: AppState = {
        ...state,
        proposals: state.proposals.map((p) => (p.id === decided.id ? decided : p)),
      };

      // Only an approval touches the business.
      if (action.status === "approved" || action.status === "auto_approved") {
        return applyProposal(withDecision, decided);
      }
      return withDecision;
    }

    case "grant_standing":
      return { ...state, standingApprovals: [action.approval, ...state.standingApprovals] };

    case "consume_standing":
      return {
        ...state,
        standingApprovals: state.standingApprovals.map((g) =>
          g.id === action.approvalId ? { ...g, usesRemaining: Math.max(0, g.usesRemaining - 1) } : g,
        ),
      };

    case "revoke_standing":
      return {
        ...state,
        standingApprovals: state.standingApprovals.filter((g) => g.id !== action.approvalId),
      };

    case "audit":
      return { ...state, audit: [action.entry, ...state.audit].slice(0, 200) };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Decision outcomes
// ---------------------------------------------------------------------------

export interface DecisionOutcome {
  status: ProposalStatus;
  /** Note the human attached, when they left one. */
  note?: string;
  /** True when a standing approval let this through without interrupting anyone. */
  viaStandingApproval?: boolean;
}

export interface StoreApi {
  state: AppState;
  /** Whether the seed has been built — the UI renders a skeleton until it has. */
  ready: boolean;

  setView(view: ViewId): void;
  setFocus(branchId: BranchId | null): void;
  setHighlight(id: string | null): void;

  /**
   * Puts a proposal in front of the human and waits for a decision.
   *
   * Resolves immediately when a standing approval covers it. Otherwise the
   * promise stays open until the human decides, the wait times out, or the
   * caller's `signal` aborts.
   */
  submitProposal(proposal: Proposal, signal?: AbortSignal): Promise<DecisionOutcome>;

  /** Called from the approval card. */
  decide(proposalId: string, status: "approved" | "rejected", note?: string): void;

  grantStanding(approval: Omit<StandingApproval, "id" | "createdAt">): void;
  revokeStanding(approvalId: string): void;

  log(entry: Omit<AuditEntry, "id" | "at">): void;
  reset(): void;
}

const StoreContext = createContext<StoreApi | null>(null);

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/**
 * Restores persisted state, discarding anything that does not look like a
 * current-shape snapshot. A corrupt or stale entry falls back to a fresh seed
 * rather than crashing the page on load.
 */
function loadPersisted(): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed?.branches) || !Array.isArray(parsed?.menu)) return null;
    if (!Array.isArray(parsed?.orders) || !Array.isArray(parsed?.proposals)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, dispatch] = useReducer(reducer, null, () => ({
    // Epoch-anchored so the server render is deterministic; replaced on mount.
    app: createSeedState(new Date(0)),
    hydrated: false,
  }));
  const { app: state, hydrated: ready } = store;

  /** Resolvers for tool calls waiting on a human decision. */
  const pending = useRef(new Map<string, (outcome: DecisionOutcome) => void>());

  useEffect(() => {
    dispatch({ type: "hydrate", state: loadPersisted() ?? createSeedState(new Date()) });
  }, []);

  // Persist after every change, once hydrated.
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A full or unavailable quota must not break the app; the demo simply
      // stops surviving reloads.
    }
  }, [state, ready]);

  // A pending decision that outlives its component would leak the tool's
  // promise, so settle everything still waiting when the provider unmounts.
  useEffect(() => {
    const waiting = pending.current;
    return () => {
      for (const resolve of waiting.values()) resolve({ status: "expired" });
      waiting.clear();
    };
  }, []);

  const log = useCallback((entry: Omit<AuditEntry, "id" | "at">) => {
    dispatch({
      type: "audit",
      entry: { ...entry, id: uid("aud"), at: new Date().toISOString() },
    });
  }, []);

  // The reducer is the only writer, but standing-approval matching needs to read
  // the newest state from inside an async tool call, so keep a live mirror.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const settle = useCallback((proposalId: string, outcome: DecisionOutcome) => {
    const resolve = pending.current.get(proposalId);
    if (!resolve) return;
    pending.current.delete(proposalId);
    resolve(outcome);
  }, []);

  const decide = useCallback(
    (proposalId: string, status: "approved" | "rejected", note?: string) => {
      const at = new Date().toISOString();
      const proposal = stateRef.current.proposals.find((p) => p.id === proposalId);

      dispatch({ type: "resolve_proposal", proposalId, status, note, at });
      log({
        actor: "human",
        summary:
          status === "approved"
            ? `Approved: ${proposal?.title ?? proposalId}`
            : `Rejected: ${proposal?.title ?? proposalId}`,
        proposalId,
        decision: status,
      });
      settle(proposalId, { status, note });
    },
    [log, settle],
  );

  const submitProposal = useCallback(
    (proposal: Proposal, signal?: AbortSignal): Promise<DecisionOutcome> => {
      dispatch({ type: "add_proposal", proposal });
      log({
        actor: "agent",
        summary: `Proposed: ${proposal.title}`,
        proposalId: proposal.id,
      });

      const grant = matchStandingApproval(proposal, stateRef.current.standingApprovals);
      if (grant) {
        const at = new Date().toISOString();
        dispatch({ type: "resolve_proposal", proposalId: proposal.id, status: "auto_approved", at });
        dispatch({ type: "consume_standing", approvalId: grant.id });
        log({
          actor: "human",
          summary: `Auto-approved under a standing approval: ${proposal.title}`,
          proposalId: proposal.id,
          decision: "auto_approved",
        });
        return Promise.resolve({ status: "auto_approved", viaStandingApproval: true });
      }

      return new Promise<DecisionOutcome>((resolve) => {
        let done = false;
        const finish = (outcome: DecisionOutcome) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          pending.current.delete(proposal.id);
          resolve(outcome);
        };

        const onAbort = () => {
          dispatch({
            type: "resolve_proposal",
            proposalId: proposal.id,
            status: "expired",
            note: "The agent cancelled the request.",
            at: new Date().toISOString(),
          });
          finish({ status: "expired" });
        };

        const timer = setTimeout(() => {
          dispatch({
            type: "resolve_proposal",
            proposalId: proposal.id,
            status: "expired",
            note: "No decision within the review window.",
            at: new Date().toISOString(),
          });
          finish({ status: "expired" });
        }, DECISION_TIMEOUT_MS);

        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });

        // A human decision reaches this through `settle`.
        pending.current.set(proposal.id, finish);
      });
    },
    [log],
  );

  const grantStanding = useCallback(
    (approval: Omit<StandingApproval, "id" | "createdAt">) => {
      const full: StandingApproval = {
        ...approval,
        id: uid("grant"),
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "grant_standing", approval: full });
      log({
        actor: "human",
        summary: `Granted a standing approval for ${approval.kind.replace("_", " ")} up to $${(
          approval.maxCashImpactCents / 100
        ).toFixed(2)} (${approval.usesRemaining} uses)`,
      });
    },
    [log],
  );

  const revokeStanding = useCallback(
    (approvalId: string) => {
      dispatch({ type: "revoke_standing", approvalId });
      log({ actor: "human", summary: "Revoked a standing approval" });
    },
    [log],
  );

  const reset = useCallback(() => {
    for (const resolve of pending.current.values()) resolve({ status: "expired" });
    pending.current.clear();
    dispatch({ type: "reset", state: createSeedState(new Date()) });
  }, []);

  const api = useMemo<StoreApi>(
    () => ({
      state,
      ready,
      setView: (view) => dispatch({ type: "set_view", view }),
      setFocus: (branchId) => dispatch({ type: "set_focus", branchId }),
      setHighlight: (id) => dispatch({ type: "set_highlight", id }),
      submitProposal,
      decide,
      grantStanding,
      revokeStanding,
      log,
      reset,
    }),
    [state, ready, submitProposal, decide, grantStanding, revokeStanding, log, reset],
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
