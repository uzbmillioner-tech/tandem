"use client";

/**
 * The tool surface Tandem exposes to an agent.
 *
 * The split is deliberate and is the whole thesis of the app:
 *
 *  - **Read tools** are annotated `readOnlyHint` and answer immediately. An
 *    agent can call them as freely as it likes; nothing changes.
 *  - **Write tools never write.** Each one builds a fully-costed proposal, puts
 *    it on the manager's screen, and then *waits* — the returned promise stays
 *    open until a human decides. What the agent gets back is the decision, in
 *    the human's words, not a success code it wrote itself.
 *
 * That inversion is what a plain HTTP API cannot do. The site is the only party
 * that knows what a change actually costs, so the site owns the confirmation.
 *
 * Outputs are kept compact on purpose: Chrome's WebMCP guidance asks for tool
 * results under about 1.5K characters, so every list is capped and every
 * response is clipped.
 */

import {
  coverageGaps,
  effectivePriceCents,
  findBranch,
  findIngredient,
  findItem,
  itemRevenueShare,
  lastNDays,
  marginCents,
  ordersContaining,
  portionCostCents,
  portionMarginCents,
  portionsAvailable,
  revenueCents,
  stockAlerts,
  topItemsByRevenue,
  unitsSold,
} from "../analytics";
import { formatCents, formatCentsDelta, formatDays, formatPercent, formatQty } from "../money";
import {
  buildEightySixProposal,
  buildPriceChangeProposal,
  buildPurchaseOrderProposal,
  buildRefundProposal,
  buildRestockProposal,
  buildShiftChangeProposal,
  isBuilderError,
} from "../proposals";
import type { StoreApi, DecisionOutcome } from "../store";
import type { AppState, BranchId, Proposal, ViewId } from "../types";
import { requestUserInteraction, type ToolDefinition } from "./types";

/** Hard ceiling on a tool result, per Chrome's WebMCP output guidance. */
const MAX_OUTPUT = 1_400;

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT - 24).trimEnd()}\n… (truncated)`;
}

function lines(...parts: (string | null | undefined | false)[]): string {
  return clip(parts.filter(Boolean).join("\n"));
}

function branchLabel(state: AppState, id: BranchId): string {
  return findBranch(state, id)?.name ?? id;
}

/** Branch ids in scope for a call: the named ones, or the whole chain. */
function scopeOf(state: AppState, branchIds?: string[]): BranchId[] {
  const known = new Set(state.branches.map((b) => b.id));
  const named = (branchIds ?? []).filter((id) => known.has(id));
  return named.length > 0 ? named : state.branches.map((b) => b.id);
}

/** Turns a decision into the sentence the agent should act on. */
function describeOutcome(proposal: Proposal, outcome: DecisionOutcome): string {
  switch (outcome.status) {
    case "approved":
      return lines(
        `APPROVED by the manager — "${proposal.title}" has been applied.`,
        outcome.note ? `Their note: ${outcome.note}` : null,
      );
    case "auto_approved":
      return lines(
        `AUTO-APPROVED — "${proposal.title}" was applied under a standing approval the manager granted earlier.`,
        "It is recorded in the audit log and the manager can revoke that grant at any time.",
      );
    case "rejected":
      return lines(
        `REJECTED by the manager — "${proposal.title}" was NOT applied. Nothing changed.`,
        outcome.note ? `Their reason: ${outcome.note}` : "They did not give a reason.",
        "Do not retry the same change. Ask what they would prefer, or propose a different option.",
      );
    default:
      return lines(
        `NO DECISION — "${proposal.title}" was not applied and the request has lapsed.`,
        "The manager did not respond in time. Tell them it is still waiting rather than trying again.",
      );
  }
}

/**
 * Shared tail of every write tool: show the human the relevant screen, ask the
 * browser to bring them back to the page, then block on their decision.
 */
async function seekApproval(
  store: StoreApi,
  proposal: Proposal,
  view: ViewId,
  signal: AbortSignal | undefined,
): Promise<string> {
  store.setView(view);
  if (proposal.blastRadius.branchIds.length === 1) {
    store.setFocus(proposal.blastRadius.branchIds[0]);
  }
  await requestUserInteraction();

  const outcome = await store.submitProposal(proposal, signal);
  return describeOutcome(proposal, outcome);
}

/** Renders the numbers the agent should quote back when it explains itself. */
function summariseProposal(state: AppState, proposal: Proposal): string {
  const b = proposal.blastRadius;
  return lines(
    `Proposal ${proposal.id} (${proposal.risk} risk) is now on the manager's screen.`,
    `Branches: ${b.branchIds.map((id) => branchLabel(state, id)).join(", ")}`,
    b.cashDeltaCents !== 0 ? `Cash movement: ${formatCentsDelta(b.cashDeltaCents)}` : null,
    b.weeklyMarginDeltaCents !== 0
      ? `Projected weekly margin: ${formatCentsDelta(b.weeklyMarginDeltaCents)}`
      : null,
    b.warnings.length > 0 ? `Warnings the page computed:\n- ${b.warnings.join("\n- ")}` : null,
  );
}

// ---------------------------------------------------------------------------

export interface ToolContext {
  /** Reads the newest store API — tools must never close over a stale render. */
  getStore: () => StoreApi;
  /** Records that a tool ran, for the live activity strip in the UI. */
  onCall: (toolName: string, summary: string) => void;
}

/**
 * Builds the full tool set. Called once; the returned array is referentially
 * stable so registration happens a single time.
 */
export function createTools({ getStore, onCall }: ToolContext): ToolDefinition[] {
  /** Wraps a handler so every call is logged and no throw escapes to the agent. */
  function tool<I>(
    def: Omit<ToolDefinition, "execute">,
    handler: (input: I, ctx: { signal?: AbortSignal; store: StoreApi; state: AppState }) => Promise<string> | string,
  ): ToolDefinition {
    return {
      ...def,
      execute: async (input, context) => {
        const store = getStore();
        try {
          const result = await handler(input as unknown as I, {
            signal: context.signal,
            store,
            state: store.state,
          });
          onCall(def.name, result.split("\n")[0] ?? "");
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onCall(def.name, `failed: ${message}`);
          return `The tool could not complete: ${message}`;
        }
      },
    };
  }

  const branchIdsSchema = {
    type: "array",
    items: { type: "string" },
    description:
      "Branch ids to act on. Omit or leave empty to mean the whole chain. Use list_branches to get ids.",
  };

  return [
    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    tool<{ branchIds?: string[] }>(
      {
        name: "get_business_snapshot",
        description:
          "Current trading position for the chain or named branches: last-7-day revenue and gross margin, order count, how many items are off the menu, and how many ingredients are below par. Start here before proposing anything.",
        inputSchema: { type: "object", properties: { branchIds: branchIdsSchema } },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const scope = scopeOf(state, input?.branchIds);
        const w = lastNDays(new Date(), 7);
        const alerts = stockAlerts(state, w, scope);
        const offMenu = state.menu.filter((m) => m.eightySixedAt.some((b) => scope.includes(b)));
        const orders = state.orders.filter(
          (o) => scope.includes(o.branchId) && Date.parse(o.placedAt) >= w.sinceMs,
        );
        const revenue = revenueCents(state, w, scope);
        const margin = marginCents(state, w, scope);

        return lines(
          `Scope: ${scope.map((id) => branchLabel(state, id)).join(", ")} (last 7 days)`,
          `Revenue ${formatCents(revenue)} · gross margin ${formatCents(margin)} (${formatPercent(
            revenue > 0 ? margin / revenue : 0,
          )})`,
          `${orders.length} orders · ${state.proposals.filter((p) => p.status === "pending").length} proposals awaiting your decision`,
          `${alerts.length} ingredients below par (${alerts.filter((a) => a.severity === "critical").length} critical)`,
          offMenu.length > 0
            ? `Off the menu: ${offMenu.map((m) => m.name).join(", ")}`
            : "Nothing is currently off the menu.",
        );
      },
    ),

    tool<Record<string, never>>(
      {
        name: "list_branches",
        description:
          "Every branch with its id, city, seat count and whether it is trading right now. Use the ids from here in other tools.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      (_input, { state }) =>
        lines(
          ...state.branches.map(
            (b) =>
              `${b.id} — ${b.name}, ${b.city} · ${b.seats} seats · ${b.openNow ? "open" : "closed"}`,
          ),
        ),
    ),

    tool<{ branchId?: string; category?: string }>(
      {
        name: "list_menu",
        description:
          "Menu with the price charged at a branch, ingredient cost per portion, gross margin, and how many portions the branch can still make from stock on hand. Flags anything currently off the menu.",
        inputSchema: {
          type: "object",
          properties: {
            branchId: {
              type: "string",
              description: "Branch to price against. Defaults to the first branch.",
            },
            category: {
              type: "string",
              enum: ["mains", "sides", "drinks", "desserts"],
              description: "Optional category filter.",
            },
          },
        },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const branchId = input?.branchId && findBranch(state, input.branchId)
          ? input.branchId
          : state.branches[0].id;
        const items = state.menu.filter((m) => !input?.category || m.category === input.category);

        return lines(
          `Menu priced for ${branchLabel(state, branchId)}:`,
          ...items.map((m) => {
            const price = effectivePriceCents(m, branchId);
            const cost = portionCostCents(state, m);
            const margin = portionMarginCents(state, m, branchId);
            const off = m.eightySixedAt.includes(branchId);
            const canMake = portionsAvailable(state, m, branchId);
            const makeable = Number.isFinite(canMake) ? `${canMake} left makeable` : "no stock limit";
            return `${m.id} — ${m.name}: ${formatCents(price)} (cost ${formatCents(cost)}, margin ${formatCents(
              margin,
            )}) · ${off ? "OFF MENU" : makeable}`;
          }),
        );
      },
    ),

    tool<{ branchIds?: string[] }>(
      {
        name: "list_stock_alerts",
        description:
          "Ingredients below par, worst first, with days of cover left at the branch's actual run rate and which menu items stop being sellable when each runs out. This is the fastest way to find a problem worth acting on.",
        inputSchema: { type: "object", properties: { branchIds: branchIdsSchema } },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const scope = scopeOf(state, input?.branchIds);
        const w = lastNDays(new Date(), 7);
        const alerts = stockAlerts(state, w, scope).slice(0, 10);
        if (alerts.length === 0) return "Every ingredient is at or above par.";

        return lines(
          ...alerts.map((a) => {
            const ing = findIngredient(state, a.ingredientId);
            const blocked = a.blockedItemIds
              .map((id) => findItem(state, id)?.name ?? id)
              .slice(0, 3)
              .join(", ");
            return `${a.severity === "critical" ? "CRITICAL" : "low"} · ${ing?.name ?? a.ingredientId} at ${branchLabel(
              state,
              a.branchId,
            )}: ${formatQty(a.qty, ing?.unit ?? "")} of ${a.parLevel} par · ${formatDays(
              a.daysOfCover,
            )} cover · blocks ${blocked}`;
          }),
        );
      },
    ),

    tool<{ branchIds?: string[]; status?: string; limit?: number }>(
      {
        name: "list_orders",
        description:
          "Recent orders, newest first, with branch, channel, status and total. Use it to find a specific order id before proposing a refund.",
        inputSchema: {
          type: "object",
          properties: {
            branchIds: branchIdsSchema,
            status: {
              type: "string",
              enum: ["placed", "preparing", "delivering", "completed", "refunded"],
              description: "Optional status filter.",
            },
            limit: { type: "number", description: "How many to return, 1–20. Default 10." },
          },
        },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const scope = new Set(scopeOf(state, input?.branchIds));
        const limit = Math.min(20, Math.max(1, Math.round(input?.limit ?? 10)));
        const rows = state.orders
          .filter((o) => scope.has(o.branchId) && (!input?.status || o.status === input.status))
          .slice(-limit)
          .reverse();

        if (rows.length === 0) return "No orders match that filter.";

        return lines(
          ...rows.map((o) => {
            const total = o.lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
            const items = o.lines
              .map((l) => `${l.qty}× ${findItem(state, l.itemId)?.name ?? l.itemId}`)
              .join(", ");
            return `${o.id} · ${branchLabel(state, o.branchId)} · ${o.status} · ${formatCents(
              total,
            )} · ${items}`;
          }),
        );
      },
    ),

    tool<{ itemId?: string; branchIds?: string[]; limit?: number }>(
      {
        name: "analyze_item_performance",
        description:
          "Sales performance over the last 7 days. With an itemId, returns units, revenue, share of branch revenue and margin for that item. Without one, ranks the whole menu by revenue.",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "Menu item id, from list_menu." },
            branchIds: branchIdsSchema,
            limit: { type: "number", description: "How many items to rank. Default 8." },
          },
        },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const scope = scopeOf(state, input?.branchIds);
        const w = lastNDays(new Date(), 7);

        if (input?.itemId) {
          const item = findItem(state, input.itemId);
          if (!item) return `No menu item with id "${input.itemId}". Call list_menu for valid ids.`;
          const units = unitsSold(state, item.id, w, scope);
          const orders = ordersContaining(state, item.id, w, scope);
          const share = itemRevenueShare(state, item.id, w, scope);
          const perBranch = scope
            .map((id) => {
              const m = portionMarginCents(state, item, id);
              return `${branchLabel(state, id)}: ${formatCents(
                effectivePriceCents(item, id),
              )} price, ${formatCents(m)} margin`;
            })
            .join("\n");

          return lines(
            `${item.name} (${item.id}) over the last 7 days:`,
            `${units} portions across ${orders} orders · ${formatPercent(share)} of revenue in scope`,
            `Ingredient cost ${formatCents(portionCostCents(state, item))} per portion`,
            perBranch,
          );
        }

        const limit = Math.min(12, Math.max(1, Math.round(input?.limit ?? 8)));
        const ranked = topItemsByRevenue(state, w, scope).slice(0, limit);
        return lines(
          `Top items by revenue, last 7 days (${scope.map((id) => branchLabel(state, id)).join(", ")}):`,
          ...ranked.map(
            (r, i) =>
              `${i + 1}. ${findItem(state, r.itemId)?.name ?? r.itemId} — ${formatCents(
                r.revenueCents,
              )} from ${r.units} portions`,
          ),
        );
      },
    ),

    tool<{ branchId?: string }>(
      {
        name: "list_shifts",
        description:
          "Today's roster for a branch, plus any hour where staff on duty falls short of the covers that branch typically does. Use it before proposing a shift change.",
        inputSchema: {
          type: "object",
          properties: { branchId: { type: "string", description: "Branch id. Defaults to the first branch." } },
        },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const branchId = input?.branchId && findBranch(state, input.branchId)
          ? input.branchId
          : state.branches[0].id;
        const roster = state.shifts.filter((s) => s.branchId === branchId);
        const gaps = coverageGaps(state, branchId, lastNDays(new Date(), 7));

        return lines(
          `${branchLabel(state, branchId)} roster:`,
          ...roster.map(
            (s) =>
              `${s.id} · ${s.staffName} (${s.role}) ${new Date(s.start).getHours()}:00–${new Date(
                s.end,
              ).getHours()}:00`,
          ),
          gaps.length === 0
            ? "Coverage is adequate at every hour."
            : `Short-staffed: ${gaps
                .map((g) => `${g.hour}:00 (${g.staffOnDuty} of ${g.staffNeeded})`)
                .join(", ")}`,
        );
      },
    ),

    tool<Record<string, never>>(
      {
        name: "list_suppliers",
        description:
          "Suppliers with their lead time and minimum order value, and which ingredients each one supplies at what unit cost. Needed to build a purchase order that will actually be accepted.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      (_input, { state }) =>
        lines(
          ...state.suppliers.map((s) => {
            const supplied = state.ingredients
              .filter((i) => i.supplierId === s.id)
              .map((i) => `${i.id} ${formatCents(i.costPerUnitCents)}/${i.unit}`)
              .join(", ");
            return `${s.id} — ${s.name}: ${s.leadTimeDays}d lead, ${formatCents(
              s.minimumOrderCents,
            )} minimum · ${supplied}`;
          }),
        ),
    ),

    tool<{ onlyPending?: boolean }>(
      {
        name: "list_proposals",
        description:
          "Proposals you have raised and how the manager decided on each. Check this before re-proposing something — a rejected proposal should not be sent again unchanged.",
        inputSchema: {
          type: "object",
          properties: {
            onlyPending: { type: "boolean", description: "Return only those still awaiting a decision." },
          },
        },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const rows = state.proposals
          .filter((p) => !input?.onlyPending || p.status === "pending")
          .slice(0, 10);
        if (rows.length === 0) return "No proposals yet.";

        return lines(
          ...rows.map(
            (p) =>
              `${p.id} · ${p.status.toUpperCase()} · ${p.risk} risk · ${p.title}${
                p.decisionNote ? ` — "${p.decisionNote}"` : ""
              }`,
          ),
        );
      },
    ),

    tool<{ limit?: number }>(
      {
        name: "get_audit_log",
        description:
          "Chronological record of what you proposed and what the manager decided, newest first. Every change to this business is attributable through here.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "How many entries, 1–20. Default 10." } },
        },
        annotations: { readOnlyHint: true },
      },
      (input, { state }) => {
        const limit = Math.min(20, Math.max(1, Math.round(input?.limit ?? 10)));
        const rows = state.audit.slice(0, limit);
        if (rows.length === 0) return "The audit log is empty.";
        return lines(
          ...rows.map(
            (e) => `${new Date(e.at).toLocaleTimeString()} · ${e.actor} · ${e.summary}`,
          ),
        );
      },
    ),

    // -----------------------------------------------------------------------
    // Steering the human's view
    // -----------------------------------------------------------------------

    tool<{ section: ViewId; branchId?: string; highlightId?: string }>(
      {
        name: "show_section",
        description:
          "Switches the screen the manager is looking at, optionally focusing one branch and highlighting a row. Call this before explaining something so they are looking at what you mean.",
        inputSchema: {
          type: "object",
          properties: {
            section: {
              type: "string",
              enum: ["overview", "menu", "stock", "orders", "staff", "audit"],
              description: "Which section to show.",
            },
            branchId: { type: "string", description: "Optional branch to focus." },
            highlightId: {
              type: "string",
              description: "Optional id of a menu item, ingredient, order or shift to highlight.",
            },
          },
          required: ["section"],
        },
      },
      (input, { store, state }) => {
        store.setView(input.section);
        store.setFocus(
          input.branchId && findBranch(state, input.branchId) ? input.branchId : null,
        );
        store.setHighlight(input.highlightId ?? null);
        return `The manager is now looking at the ${input.section} section${
          input.branchId ? ` focused on ${branchLabel(state, input.branchId)}` : ""
        }.`;
      },
    ),

    // -----------------------------------------------------------------------
    // Proposing changes — none of these write anything on their own
    // -----------------------------------------------------------------------

    tool<{ itemId: string; newPriceCents: number; branchIds?: string[]; rationale: string }>(
      {
        name: "propose_price_change",
        description:
          "Proposes a new price for one menu item. Does NOT change the price: it puts a costed proposal on the manager's screen showing the projected weekly margin effect after demand elasticity, and returns only once they approve or reject. Give a clear rationale — they see it.",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "Menu item id, from list_menu." },
            newPriceCents: {
              type: "number",
              description: "New price in cents, e.g. 1650 for $16.50.",
            },
            branchIds: branchIdsSchema,
            rationale: {
              type: "string",
              description: "Why this change is worth making, in one or two sentences.",
            },
          },
          required: ["itemId", "newPriceCents", "rationale"],
        },
      },
      async (input, { store, state, signal }) => {
        const built = buildPriceChangeProposal(
          state,
          {
            itemId: input.itemId,
            branchIds: scopeOf(state, input.branchIds),
            newPriceCents: Math.round(input.newPriceCents),
          },
          input.rationale,
          new Date(),
        );
        if (isBuilderError(built)) return `Not proposed — ${built.error}`;
        return lines(summariseProposal(state, built), "", await seekApproval(store, built, "menu", signal));
      },
    ),

    tool<{ itemId: string; branchIds?: string[]; restore?: boolean; rationale: string }>(
      {
        name: "propose_menu_availability",
        description:
          "Proposes taking a menu item off sale (86'ing it) or putting it back. Does NOT change availability on its own — it shows the manager the weekly revenue at stake and waits for their decision.",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "Menu item id, from list_menu." },
            branchIds: branchIdsSchema,
            restore: {
              type: "boolean",
              description: "true puts the item back on sale. Defaults to false, which takes it off.",
            },
            rationale: { type: "string", description: "Why, in one or two sentences." },
          },
          required: ["itemId", "rationale"],
        },
      },
      async (input, { store, state, signal }) => {
        const built = buildEightySixProposal(
          state,
          {
            itemId: input.itemId,
            branchIds: scopeOf(state, input.branchIds),
            restore: input.restore ?? false,
          },
          input.rationale,
          new Date(),
        );
        if (isBuilderError(built)) return `Not proposed — ${built.error}`;
        return lines(summariseProposal(state, built), "", await seekApproval(store, built, "menu", signal));
      },
    ),

    tool<{ branchId: string; ingredientId: string; deltaQty: number; rationale: string }>(
      {
        name: "propose_stock_correction",
        description:
          "Proposes correcting the counted stock of one ingredient at one branch, up or down. Use it after a physical count or a wastage report. Waits for the manager's decision.",
        inputSchema: {
          type: "object",
          properties: {
            branchId: { type: "string", description: "Branch id." },
            ingredientId: { type: "string", description: "Ingredient id, from list_stock_alerts or list_suppliers." },
            deltaQty: {
              type: "number",
              description: "Signed change in the ingredient's own unit, e.g. -2.5 or 8.",
            },
            rationale: { type: "string", description: "Why the count is being corrected." },
          },
          required: ["branchId", "ingredientId", "deltaQty", "rationale"],
        },
      },
      async (input, { store, state, signal }) => {
        const built = buildRestockProposal(
          state,
          { branchId: input.branchId, ingredientId: input.ingredientId, deltaQty: input.deltaQty },
          input.rationale,
          new Date(),
        );
        if (isBuilderError(built)) return `Not proposed — ${built.error}`;
        return lines(summariseProposal(state, built), "", await seekApproval(store, built, "stock", signal));
      },
    ),

    tool<{
      supplierId: string;
      branchId: string;
      lines: { ingredientId: string; qty: number }[];
      rationale: string;
    }>(
      {
        name: "propose_purchase_order",
        description:
          "Proposes buying stock from a supplier for one branch. This spends real money, so it never places the order itself: the manager sees the total cost, whether it clears the supplier's minimum, and whether delivery arrives before the branch runs out.",
        inputSchema: {
          type: "object",
          properties: {
            supplierId: { type: "string", description: "Supplier id, from list_suppliers." },
            branchId: { type: "string", description: "Branch the stock is delivered to." },
            lines: {
              type: "array",
              description: "What to order.",
              items: {
                type: "object",
                properties: {
                  ingredientId: { type: "string" },
                  qty: { type: "number", description: "Quantity in the ingredient's unit." },
                },
                required: ["ingredientId", "qty"],
              },
            },
            rationale: { type: "string", description: "Why this order, at this size, now." },
          },
          required: ["supplierId", "branchId", "lines", "rationale"],
        },
      },
      async (input, { store, state, signal }) => {
        const built = buildPurchaseOrderProposal(
          state,
          { supplierId: input.supplierId, branchId: input.branchId, lines: input.lines ?? [] },
          input.rationale,
          new Date(),
        );
        if (isBuilderError(built)) return `Not proposed — ${built.error}`;
        return lines(summariseProposal(state, built), "", await seekApproval(store, built, "stock", signal));
      },
    ),

    tool<{ orderId: string; amountCents: number; reason: string }>(
      {
        name: "propose_refund",
        description:
          "Proposes refunding a customer, in whole or in part. Money leaves the business, so this always requires a human decision regardless of amount. The manager sees the order, the amount and the reason you give.",
        inputSchema: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "Order id, from list_orders." },
            amountCents: {
              type: "number",
              description: "Refund amount in cents. Cannot exceed the order total.",
            },
            reason: {
              type: "string",
              description: "The customer's reason, in their words where you have them.",
            },
          },
          required: ["orderId", "amountCents", "reason"],
        },
      },
      async (input, { store, state, signal }) => {
        const built = buildRefundProposal(
          state,
          {
            orderId: input.orderId,
            amountCents: Math.round(input.amountCents),
            reason: input.reason ?? "",
          },
          input.reason ?? "",
          new Date(),
        );
        if (isBuilderError(built)) return `Not proposed — ${built.error}`;
        return lines(summariseProposal(state, built), "", await seekApproval(store, built, "orders", signal));
      },
    ),

    tool<{
      shiftId: string;
      newStaffName?: string;
      newStartHour?: number;
      newEndHour?: number;
      rationale: string;
    }>(
      {
        name: "propose_shift_change",
        description:
          "Proposes reassigning a shift or moving its hours. The manager sees any coverage gap the change would open, computed from that branch's real hourly demand, before they decide.",
        inputSchema: {
          type: "object",
          properties: {
            shiftId: { type: "string", description: "Shift id, from list_shifts." },
            newStaffName: { type: "string", description: "Who should cover it instead." },
            newStartHour: { type: "number", description: "New start hour, 0–23." },
            newEndHour: { type: "number", description: "New end hour, 0–23." },
            rationale: { type: "string", description: "Why the change is needed." },
          },
          required: ["shiftId", "rationale"],
        },
      },
      async (input, { store, state, signal }) => {
        const built = buildShiftChangeProposal(
          state,
          {
            shiftId: input.shiftId,
            newStaffName: input.newStaffName,
            newStartHour: input.newStartHour,
            newEndHour: input.newEndHour,
          },
          input.rationale,
          new Date(),
        );
        if (isBuilderError(built)) return `Not proposed — ${built.error}`;
        return lines(summariseProposal(state, built), "", await seekApproval(store, built, "staff", signal));
      },
    ),
  ];
}
