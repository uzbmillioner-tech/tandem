/**
 * Proposal construction and application.
 *
 * A write tool never mutates state. It builds a {@link Proposal} — the change,
 * fully costed — and hands it to the UI. Only {@link applyProposal} mutates, and
 * it only ever runs after a human decision (or a standing approval the human
 * granted in advance).
 *
 * Keeping construction and application in separate functions is what makes the
 * confirmation meaningful: the numbers shown on the card are computed from the
 * same payload that is later applied, not from a re-derivation that could drift.
 */

import {
  coverageGaps,
  effectivePriceCents,
  findBranch,
  findIngredient,
  findItem,
  itemRevenueShare,
  lastNDays,
  portionCostCents,
  portionsAvailable,
  projectEightySix,
  projectPriceChange,
  projectPurchase,
  resolveBranchIds,
  type PurchaseLine,
} from "./analytics";
import { formatCents, formatDays, formatQty } from "./money";
import type {
  AppState,
  BlastRadius,
  BranchId,
  Change,
  IngredientId,
  ItemId,
  Proposal,
  ProposalKind,
  RiskLevel,
  StandingApproval,
} from "./types";

// ---------------------------------------------------------------------------
// Payloads — the applied form of each proposal kind.
// ---------------------------------------------------------------------------

export interface PriceChangePayload {
  itemId: ItemId;
  branchIds: BranchId[];
  newPriceCents: number;
}

export interface EightySixPayload {
  itemId: ItemId;
  branchIds: BranchId[];
  /** true removes the 86, putting the item back on sale. */
  restore: boolean;
}

export interface RestockPayload {
  branchId: BranchId;
  ingredientId: IngredientId;
  /** Signed change to stock on hand, in the ingredient's unit. */
  deltaQty: number;
}

export interface PurchaseOrderPayload {
  supplierId: string;
  branchId: BranchId;
  lines: PurchaseLine[];
}

export interface RefundPayload {
  orderId: string;
  amountCents: number;
  reason: string;
}

export interface ShiftChangePayload {
  shiftId: string;
  newStaffName?: string;
  /** Hour of day, 0..23. */
  newStartHour?: number;
  newEndHour?: number;
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

const HIGH_CASH_CENTS = 20_000;
const MEDIUM_CASH_CENTS = 5_000;
const HIGH_REVENUE_SHARE = 0.15;
const MEDIUM_REVENUE_SHARE = 0.05;

/**
 * Grades a proposal from its computed consequences, not from its kind.
 *
 * A refund is not automatically dangerous and a price tweak is not
 * automatically safe: what matters is how much money moves, how much of the
 * business it touches, and whether the page found something concretely wrong.
 */
export function riskFor(blast: BlastRadius): RiskLevel {
  const cash = Math.abs(blast.cashDeltaCents);
  const margin = Math.abs(blast.weeklyMarginDeltaCents);

  if (
    cash >= HIGH_CASH_CENTS ||
    margin >= HIGH_CASH_CENTS ||
    blast.revenueShare >= HIGH_REVENUE_SHARE ||
    blast.warnings.length >= 2
  ) {
    return "high";
  }

  if (
    cash >= MEDIUM_CASH_CENTS ||
    margin >= MEDIUM_CASH_CENTS ||
    blast.revenueShare >= MEDIUM_REVENUE_SHARE ||
    blast.warnings.length >= 1
  ) {
    return "medium";
  }

  return "low";
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function riskAtMost(risk: RiskLevel, ceiling: RiskLevel): boolean {
  return RISK_ORDER[risk] <= RISK_ORDER[ceiling];
}

/**
 * Finds a standing approval that covers this proposal, if the human granted one.
 *
 * Both the cash ceiling and the risk ceiling must hold, and the grant must have
 * uses left. Anything outside those bounds falls through to a human decision —
 * that is the whole point of the ladder.
 */
export function matchStandingApproval(
  proposal: Proposal,
  approvals: StandingApproval[],
): StandingApproval | null {
  for (const grant of approvals) {
    if (grant.kind !== proposal.kind) continue;
    if (grant.usesRemaining <= 0) continue;
    if (Math.abs(proposal.blastRadius.cashDeltaCents) > grant.maxCashImpactCents) continue;
    if (!riskAtMost(proposal.risk, grant.maxRisk)) continue;
    return grant;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

let proposalCounter = 0;

function nextProposalId(): string {
  proposalCounter += 1;
  return `prop_${Date.now().toString(36)}_${proposalCounter.toString(36)}`;
}

/** Resets the id counter. Test-only. */
export function __resetProposalCounter(): void {
  proposalCounter = 0;
}

interface BuildArgs {
  kind: ProposalKind;
  title: string;
  rationale: string;
  changes: Change[];
  blast: BlastRadius;
  payload: unknown;
  now: Date;
}

function assemble({ kind, title, rationale, changes, blast, payload, now }: BuildArgs): Proposal {
  return {
    id: nextProposalId(),
    kind,
    title,
    rationale,
    changes,
    blastRadius: blast,
    risk: riskFor(blast),
    status: "pending",
    createdAt: now.toISOString(),
    payload,
  };
}

/** "1 day", "3 days" — a proposal is read by a person, not a log parser. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function branchName(state: AppState, id: BranchId): string {
  return findBranch(state, id)?.name ?? id;
}

export function buildPriceChangeProposal(
  state: AppState,
  payload: PriceChangePayload,
  rationale: string,
  now: Date,
): Proposal | { error: string } {
  const item = findItem(state, payload.itemId);
  if (!item) return { error: `Unknown menu item: ${payload.itemId}` };
  if (!Number.isFinite(payload.newPriceCents) || payload.newPriceCents < 0) {
    return { error: "New price must be zero or more, in cents." };
  }

  const branchIds = resolveBranchIds(state, payload.branchIds);
  if (branchIds.length === 0) return { error: "No matching branches." };

  const w = lastNDays(now, 7);
  const changes: Change[] = [];
  const warnings: string[] = [];
  let marginDelta = 0;
  let ordersAffected = 0;

  for (const branchId of branchIds) {
    const p = projectPriceChange(state, item, branchId, payload.newPriceCents, w);
    marginDelta += p.marginDeltaCents;
    ordersAffected += p.unitsLast7d;

    changes.push({
      subject: `${item.name} — ${branchName(state, branchId)}`,
      field: "Price",
      before: formatCents(p.oldPriceCents),
      after: formatCents(p.newPriceCents),
    });

    if (p.sellsBelowCost) {
      warnings.push(
        `At ${branchName(state, branchId)} the new price is below the ${formatCents(
          portionCostCents(state, item),
        )} ingredient cost — every portion sold loses money.`,
      );
    }

    const pctChange =
      p.oldPriceCents > 0 ? (p.newPriceCents - p.oldPriceCents) / p.oldPriceCents : 0;
    if (pctChange > 0.2) {
      warnings.push(
        `${branchName(state, branchId)} rises ${Math.round(pctChange * 100)}% at once; projected volume drops from ${p.unitsLast7d} to ${p.projectedUnits} portions a week.`,
      );
    }
  }

  const blast: BlastRadius = {
    branchIds,
    cashDeltaCents: 0,
    weeklyMarginDeltaCents: marginDelta,
    ordersAffectedLast7d: ordersAffected,
    revenueShare: itemRevenueShare(state, item.id, w, branchIds),
    warnings,
  };

  return assemble({
    kind: "price_change",
    title: `Reprice ${item.name} to ${formatCents(payload.newPriceCents)}`,
    rationale,
    changes,
    blast,
    payload,
    now,
  });
}

export function buildEightySixProposal(
  state: AppState,
  payload: EightySixPayload,
  rationale: string,
  now: Date,
): Proposal | { error: string } {
  const item = findItem(state, payload.itemId);
  if (!item) return { error: `Unknown menu item: ${payload.itemId}` };

  const branchIds = resolveBranchIds(state, payload.branchIds);
  if (branchIds.length === 0) return { error: "No matching branches." };

  const w = lastNDays(now, 7);
  const changes: Change[] = [];
  const warnings: string[] = [];
  let marginAtRisk = 0;
  let ordersAffected = 0;

  for (const branchId of branchIds) {
    const p = projectEightySix(state, item, branchId, w);
    const wasOff = item.eightySixedAt.includes(branchId);

    changes.push({
      subject: `${item.name} — ${branchName(state, branchId)}`,
      field: "Availability",
      before: wasOff ? "Off menu" : "On sale",
      after: payload.restore ? "On sale" : "Off menu",
    });

    if (payload.restore) {
      if (p.portionsStillPossible <= 0) {
        warnings.push(
          `${branchName(state, branchId)} has no stock to make ${item.name} — putting it back on sale will produce orders the kitchen cannot fill.`,
        );
      }
      continue;
    }

    marginAtRisk -= p.marginAtRiskCents;
    ordersAffected += p.ordersAffectedLast7d;

    if (p.revenueShare > 0.1) {
      warnings.push(
        `${item.name} is ${Math.round(p.revenueShare * 100)}% of ${branchName(state, branchId)} revenue — pulling it costs about ${formatCents(p.revenueAtRiskCents)} a week.`,
      );
    }
    if (p.portionsStillPossible > 10) {
      warnings.push(
        `${branchName(state, branchId)} still holds ingredients for ${p.portionsStillPossible} portions; taking it off menu writes off sellable stock.`,
      );
    }
  }

  const blast: BlastRadius = {
    branchIds,
    cashDeltaCents: 0,
    weeklyMarginDeltaCents: marginAtRisk,
    ordersAffectedLast7d: ordersAffected,
    revenueShare: itemRevenueShare(state, item.id, w, branchIds),
    warnings,
  };

  return assemble({
    kind: "eighty_six",
    title: payload.restore
      ? `Put ${item.name} back on sale`
      : `Take ${item.name} off the menu`,
    rationale,
    changes,
    blast,
    payload,
    now,
  });
}

export function buildRestockProposal(
  state: AppState,
  payload: RestockPayload,
  rationale: string,
  now: Date,
): Proposal | { error: string } {
  const ing = findIngredient(state, payload.ingredientId);
  if (!ing) return { error: `Unknown ingredient: ${payload.ingredientId}` };
  if (!findBranch(state, payload.branchId)) {
    return { error: `Unknown branch: ${payload.branchId}` };
  }
  if (!Number.isFinite(payload.deltaQty) || payload.deltaQty === 0) {
    return { error: "Stock adjustment must be a non-zero quantity." };
  }

  const level = state.stock.find(
    (s) => s.branchId === payload.branchId && s.ingredientId === payload.ingredientId,
  );
  const before = level?.qty ?? 0;
  const after = Math.max(0, before + payload.deltaQty);

  const warnings: string[] = [];
  if (before + payload.deltaQty < 0) {
    warnings.push(
      `The count would go negative (${formatQty(before + payload.deltaQty, ing.unit)}); it will be clamped to zero. Check the count before approving.`,
    );
  }

  const blast: BlastRadius = {
    branchIds: [payload.branchId],
    // A count correction moves inventory value, not cash.
    cashDeltaCents: 0,
    weeklyMarginDeltaCents: 0,
    ordersAffectedLast7d: 0,
    revenueShare: 0,
    warnings,
  };

  return assemble({
    kind: "restock",
    title: `Adjust ${ing.name} at ${branchName(state, payload.branchId)} by ${payload.deltaQty > 0 ? "+" : ""}${payload.deltaQty} ${ing.unit}`,
    rationale,
    changes: [
      {
        subject: `${ing.name} — ${branchName(state, payload.branchId)}`,
        field: "Stock on hand",
        before: formatQty(before, ing.unit),
        after: formatQty(after, ing.unit),
      },
    ],
    blast,
    payload,
    now,
  });
}

export function buildPurchaseOrderProposal(
  state: AppState,
  payload: PurchaseOrderPayload,
  rationale: string,
  now: Date,
): Proposal | { error: string } {
  const supplier = state.suppliers.find((s) => s.id === payload.supplierId);
  if (!supplier) return { error: `Unknown supplier: ${payload.supplierId}` };
  if (!findBranch(state, payload.branchId)) {
    return { error: `Unknown branch: ${payload.branchId}` };
  }
  if (payload.lines.length === 0) return { error: "A purchase order needs at least one line." };

  const w = lastNDays(now, 7);
  const p = projectPurchase(state, payload.supplierId, payload.branchId, payload.lines, w);

  const warnings: string[] = [];
  if (p.belowSupplierMinimum) {
    warnings.push(
      `${supplier.name} has a ${formatCents(supplier.minimumOrderCents)} minimum; this order is ${formatCents(p.totalCents)} and would be rejected.`,
    );
  }
  for (const short of p.arrivesTooLateFor) {
    const ing = findIngredient(state, short.ingredientId);
    warnings.push(
      `${ing?.name ?? short.ingredientId} has ${formatDays(short.daysOfCover)} of cover left but ${
        supplier.name
      } takes ${plural(supplier.leadTimeDays, "day")} to deliver — the branch runs out before this arrives.`,
    );
  }

  const changes: Change[] = p.lines.map((line) => {
    const ing = findIngredient(state, line.ingredientId);
    return {
      subject: ing?.name ?? line.ingredientId,
      field: "Order quantity",
      before: "—",
      after: `${formatQty(line.qty, ing?.unit ?? "unit")} · ${formatCents(line.lineCostCents)}`,
    };
  });

  const blast: BlastRadius = {
    branchIds: [payload.branchId],
    cashDeltaCents: -p.totalCents,
    weeklyMarginDeltaCents: 0,
    ordersAffectedLast7d: 0,
    revenueShare: 0,
    warnings,
  };

  return assemble({
    kind: "purchase_order",
    title: `Order ${formatCents(p.totalCents)} from ${supplier.name}`,
    rationale,
    changes,
    blast,
    payload,
    now,
  });
}

export function buildRefundProposal(
  state: AppState,
  payload: RefundPayload,
  rationale: string,
  now: Date,
): Proposal | { error: string } {
  const order = state.orders.find((o) => o.id === payload.orderId);
  if (!order) return { error: `Unknown order: ${payload.orderId}` };
  if (order.status === "refunded") return { error: `Order ${order.id} is already refunded.` };

  const orderTotal = order.lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
  if (!Number.isFinite(payload.amountCents) || payload.amountCents <= 0) {
    return { error: "Refund amount must be greater than zero, in cents." };
  }
  if (payload.amountCents > orderTotal) {
    return {
      error: `Refund of ${formatCents(payload.amountCents)} exceeds the ${formatCents(orderTotal)} order total.`,
    };
  }

  const warnings: string[] = [];
  if (payload.amountCents === orderTotal) {
    warnings.push("This is a full refund — the whole order value is returned to the customer.");
  }
  if (!payload.reason.trim()) {
    warnings.push("No reason was given, so the refund cannot be attributed in the books.");
  }

  const blast: BlastRadius = {
    branchIds: [order.branchId],
    cashDeltaCents: -payload.amountCents,
    weeklyMarginDeltaCents: 0,
    ordersAffectedLast7d: 1,
    revenueShare: 0,
    warnings,
  };

  return assemble({
    kind: "refund",
    title: `Refund ${formatCents(payload.amountCents)} on ${order.id}`,
    rationale,
    changes: [
      {
        subject: `Order ${order.id} — ${branchName(state, order.branchId)}`,
        field: "Status",
        before: order.status,
        after: "refunded",
      },
      {
        subject: "Cash",
        field: "Movement",
        before: formatCents(0),
        after: `−${formatCents(payload.amountCents)}`,
      },
    ],
    blast,
    payload,
    now,
  });
}

export function buildShiftChangeProposal(
  state: AppState,
  payload: ShiftChangePayload,
  rationale: string,
  now: Date,
): Proposal | { error: string } {
  const shift = state.shifts.find((s) => s.id === payload.shiftId);
  if (!shift) return { error: `Unknown shift: ${payload.shiftId}` };

  const changes: Change[] = [];
  if (payload.newStaffName && payload.newStaffName !== shift.staffName) {
    changes.push({
      subject: `Shift ${shift.id} — ${branchName(state, shift.branchId)}`,
      field: "Assigned to",
      before: shift.staffName,
      after: payload.newStaffName,
    });
  }
  if (payload.newStartHour !== undefined || payload.newEndHour !== undefined) {
    const oldStart = new Date(shift.start).getHours();
    const oldEnd = new Date(shift.end).getHours();
    changes.push({
      subject: `Shift ${shift.id} — ${branchName(state, shift.branchId)}`,
      field: "Hours",
      before: `${oldStart}:00–${oldEnd}:00`,
      after: `${payload.newStartHour ?? oldStart}:00–${payload.newEndHour ?? oldEnd}:00`,
    });
  }
  if (changes.length === 0) return { error: "The shift change does not alter anything." };

  // Model the roster after the change to find gaps it would open.
  const w = lastNDays(now, 7);
  const projected: AppState = {
    ...state,
    shifts: state.shifts.map((s) => (s.id === shift.id ? applyShiftChange(s, payload) : s)),
  };
  const gaps = coverageGaps(projected, shift.branchId, w);

  const warnings = gaps.map(
    (g) =>
      `${branchName(state, g.branchId)} would be short at ${g.hour}:00 — ${g.staffOnDuty} on duty against ${g.staffNeeded} needed for typical covers.`,
  );

  const blast: BlastRadius = {
    branchIds: [shift.branchId],
    cashDeltaCents: 0,
    weeklyMarginDeltaCents: 0,
    ordersAffectedLast7d: 0,
    revenueShare: 0,
    warnings,
  };

  return assemble({
    kind: "shift_change",
    title: `Change shift ${shift.id} at ${branchName(state, shift.branchId)}`,
    rationale,
    changes,
    blast,
    payload,
    now,
  });
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function applyShiftChange(
  shift: AppState["shifts"][number],
  payload: ShiftChangePayload,
): AppState["shifts"][number] {
  const next = { ...shift };
  if (payload.newStaffName) next.staffName = payload.newStaffName;
  if (payload.newStartHour !== undefined) {
    const d = new Date(shift.start);
    d.setHours(payload.newStartHour, 0, 0, 0);
    next.start = d.toISOString();
  }
  if (payload.newEndHour !== undefined) {
    const d = new Date(shift.end);
    d.setHours(payload.newEndHour, 0, 0, 0);
    next.end = d.toISOString();
  }
  return next;
}

/**
 * Applies an approved proposal. Pure: returns a new state, never mutates.
 *
 * Called only from the approval path. If a payload has drifted out of range
 * since the proposal was built (an order refunded in the meantime, stock
 * already spent), application clamps rather than throwing — the audit trail
 * records what was applied.
 */
export function applyProposal(state: AppState, proposal: Proposal): AppState {
  switch (proposal.kind) {
    case "price_change": {
      const p = proposal.payload as PriceChangePayload;
      return {
        ...state,
        menu: state.menu.map((item) => {
          if (item.id !== p.itemId) return item;
          const overrides = { ...item.priceOverrides };
          for (const branchId of p.branchIds) overrides[branchId] = p.newPriceCents;
          return { ...item, priceOverrides: overrides };
        }),
      };
    }

    case "eighty_six": {
      const p = proposal.payload as EightySixPayload;
      return {
        ...state,
        menu: state.menu.map((item) => {
          if (item.id !== p.itemId) return item;
          const off = new Set(item.eightySixedAt);
          for (const branchId of p.branchIds) {
            if (p.restore) off.delete(branchId);
            else off.add(branchId);
          }
          return { ...item, eightySixedAt: [...off] };
        }),
      };
    }

    case "restock": {
      const p = proposal.payload as RestockPayload;
      return {
        ...state,
        stock: state.stock.map((s) =>
          s.branchId === p.branchId && s.ingredientId === p.ingredientId
            ? { ...s, qty: Math.round(Math.max(0, s.qty + p.deltaQty) * 100) / 100 }
            : s,
        ),
      };
    }

    case "purchase_order": {
      const p = proposal.payload as PurchaseOrderPayload;
      const byIngredient = new Map(p.lines.map((l) => [l.ingredientId, l.qty]));
      return {
        ...state,
        stock: state.stock.map((s) => {
          if (s.branchId !== p.branchId) return s;
          const add = byIngredient.get(s.ingredientId);
          if (add === undefined) return s;
          return { ...s, qty: Math.round((s.qty + add) * 100) / 100 };
        }),
      };
    }

    case "refund": {
      const p = proposal.payload as RefundPayload;
      return {
        ...state,
        orders: state.orders.map((o) =>
          o.id === p.orderId ? { ...o, status: "refunded", refundedCents: p.amountCents } : o,
        ),
      };
    }

    case "shift_change": {
      const p = proposal.payload as ShiftChangePayload;
      return {
        ...state,
        shifts: state.shifts.map((s) => (s.id === p.shiftId ? applyShiftChange(s, p) : s)),
      };
    }

    default:
      return state;
  }
}

/** True when the value returned by a builder is an error rather than a proposal. */
export function isBuilderError(v: Proposal | { error: string }): v is { error: string } {
  return "error" in v;
}

/** Portions still makeable, used by the UI to flag items that are about to fail. */
export function sellableNow(state: AppState, itemId: ItemId, branchId: BranchId): number {
  const item = findItem(state, itemId);
  if (!item) return 0;
  if (item.eightySixedAt.includes(branchId)) return 0;
  return portionsAvailable(state, item, branchId);
}

/** Current effective price, re-exported so UI code has one import for pricing. */
export { effectivePriceCents };
