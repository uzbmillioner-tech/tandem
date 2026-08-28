/**
 * The consequence engine.
 *
 * Everything here is a pure function over `AppState`. This is the knowledge an
 * agent structurally cannot have: it depends on recipes, live stock, seven days
 * of order history and supplier terms. The agent proposes; this module works out
 * what the proposal would actually cost.
 *
 * All money is integer cents. All functions are total — they never throw on
 * unknown ids, they return neutral values, because a tool call must not be able
 * to crash the page.
 */

import type {
  AppState,
  BranchId,
  Ingredient,
  IngredientId,
  ItemId,
  MenuItem,
  Order,
  StockLevel,
} from "./types";

/**
 * Own-price elasticity of demand used for revenue projections.
 *
 * -0.6 is a mid-range figure for casual restaurant mains: a 10% price rise
 * costs roughly 6% of unit volume. It is deliberately a single, visible
 * constant rather than a hidden model, so every projection the UI shows can be
 * explained to the person approving it.
 */
export const PRICE_ELASTICITY = -0.6;

export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findItem(state: AppState, itemId: ItemId): MenuItem | undefined {
  return state.menu.find((m) => m.id === itemId);
}

export function findIngredient(state: AppState, id: IngredientId): Ingredient | undefined {
  return state.ingredients.find((i) => i.id === id);
}

export function findBranch(state: AppState, id: BranchId) {
  return state.branches.find((b) => b.id === id);
}

export function findStock(
  state: AppState,
  branchId: BranchId,
  ingredientId: IngredientId,
): StockLevel | undefined {
  return state.stock.find((s) => s.branchId === branchId && s.ingredientId === ingredientId);
}

/** Branch ids a change applies to — an empty selection means the whole chain. */
export function resolveBranchIds(state: AppState, branchIds?: BranchId[] | null): BranchId[] {
  if (!branchIds || branchIds.length === 0) return state.branches.map((b) => b.id);
  const known = new Set(state.branches.map((b) => b.id));
  return branchIds.filter((id) => known.has(id));
}

// ---------------------------------------------------------------------------
// Prices and margins
// ---------------------------------------------------------------------------

/** The price actually charged for an item at a branch, in cents. */
export function effectivePriceCents(item: MenuItem, branchId: BranchId): number {
  return item.priceOverrides[branchId] ?? item.priceCents;
}

/** Ingredient cost of a single portion, in cents, rounded to the nearest cent. */
export function portionCostCents(state: AppState, item: MenuItem): number {
  let total = 0;
  for (const line of item.recipe) {
    const ing = findIngredient(state, line.ingredientId);
    if (!ing) continue;
    total += ing.costPerUnitCents * line.qty;
  }
  return Math.round(total);
}

/** Gross margin per portion at a branch, in cents. May be negative. */
export function portionMarginCents(state: AppState, item: MenuItem, branchId: BranchId): number {
  return effectivePriceCents(item, branchId) - portionCostCents(state, item);
}

/** Gross margin as a share of price, 0..1. Returns 0 for a free item. */
export function marginRatio(state: AppState, item: MenuItem, branchId: BranchId): number {
  const price = effectivePriceCents(item, branchId);
  if (price <= 0) return 0;
  return portionMarginCents(state, item, branchId) / price;
}

// ---------------------------------------------------------------------------
// Sales history
// ---------------------------------------------------------------------------

export interface HistoryWindow {
  /** Inclusive lower bound as an epoch millisecond timestamp. */
  sinceMs: number;
  /** Exclusive upper bound. */
  untilMs: number;
}

export function lastNDays(now: Date, days: number): HistoryWindow {
  const untilMs = now.getTime();
  return { sinceMs: untilMs - days * DAY_MS, untilMs };
}

function inWindow(order: Order, w: HistoryWindow): boolean {
  const t = Date.parse(order.placedAt);
  return t >= w.sinceMs && t < w.untilMs;
}

/** Orders that count toward revenue — refunded orders are excluded. */
export function billableOrders(state: AppState, w: HistoryWindow, branchIds?: BranchId[]): Order[] {
  const scope = branchIds ? new Set(branchIds) : null;
  return state.orders.filter(
    (o) =>
      o.status !== "refunded" &&
      inWindow(o, w) &&
      (scope === null || scope.has(o.branchId)),
  );
}

/** Portions of one menu item sold in the window. */
export function unitsSold(
  state: AppState,
  itemId: ItemId,
  w: HistoryWindow,
  branchIds?: BranchId[],
): number {
  let units = 0;
  for (const order of billableOrders(state, w, branchIds)) {
    for (const line of order.lines) {
      if (line.itemId === itemId) units += line.qty;
    }
  }
  return units;
}

/** Number of distinct orders that contained the item. */
export function ordersContaining(
  state: AppState,
  itemId: ItemId,
  w: HistoryWindow,
  branchIds?: BranchId[],
): number {
  let count = 0;
  for (const order of billableOrders(state, w, branchIds)) {
    if (order.lines.some((l) => l.itemId === itemId)) count++;
  }
  return count;
}

/** Gross revenue in the window, in cents. */
export function revenueCents(state: AppState, w: HistoryWindow, branchIds?: BranchId[]): number {
  let total = 0;
  for (const order of billableOrders(state, w, branchIds)) {
    for (const line of order.lines) {
      total += line.unitPriceCents * line.qty;
    }
  }
  return total;
}

/** Gross margin in the window, in cents, priced at what was actually charged. */
export function marginCents(state: AppState, w: HistoryWindow, branchIds?: BranchId[]): number {
  let total = 0;
  for (const order of billableOrders(state, w, branchIds)) {
    for (const line of order.lines) {
      const item = findItem(state, line.itemId);
      if (!item) continue;
      total += (line.unitPriceCents - portionCostCents(state, item)) * line.qty;
    }
  }
  return total;
}

/** Revenue attributable to one item, in cents. */
export function itemRevenueCents(
  state: AppState,
  itemId: ItemId,
  w: HistoryWindow,
  branchIds?: BranchId[],
): number {
  let total = 0;
  for (const order of billableOrders(state, w, branchIds)) {
    for (const line of order.lines) {
      if (line.itemId === itemId) total += line.unitPriceCents * line.qty;
    }
  }
  return total;
}

/** Share of window revenue flowing through one item, 0..1. */
export function itemRevenueShare(
  state: AppState,
  itemId: ItemId,
  w: HistoryWindow,
  branchIds?: BranchId[],
): number {
  const total = revenueCents(state, w, branchIds);
  if (total <= 0) return 0;
  return itemRevenueCents(state, itemId, w, branchIds) / total;
}

/** Menu items ranked by revenue in the window, richest first. */
export function topItemsByRevenue(
  state: AppState,
  w: HistoryWindow,
  branchIds?: BranchId[],
): { itemId: ItemId; revenueCents: number; units: number }[] {
  const byItem = new Map<ItemId, { revenueCents: number; units: number }>();
  for (const order of billableOrders(state, w, branchIds)) {
    for (const line of order.lines) {
      const row = byItem.get(line.itemId) ?? { revenueCents: 0, units: 0 };
      row.revenueCents += line.unitPriceCents * line.qty;
      row.units += line.qty;
      byItem.set(line.itemId, row);
    }
  }
  return [...byItem.entries()]
    .map(([itemId, row]) => ({ itemId, ...row }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

/**
 * Average daily consumption of an ingredient at a branch, derived from what was
 * actually sold and the recipes those sales consumed.
 */
export function dailyIngredientUsage(
  state: AppState,
  ingredientId: IngredientId,
  branchId: BranchId,
  w: HistoryWindow,
): number {
  let used = 0;
  for (const order of billableOrders(state, w, [branchId])) {
    for (const line of order.lines) {
      const item = findItem(state, line.itemId);
      if (!item) continue;
      for (const r of item.recipe) {
        if (r.ingredientId === ingredientId) used += r.qty * line.qty;
      }
    }
  }
  const days = Math.max(1, (w.untilMs - w.sinceMs) / DAY_MS);
  return used / days;
}

/**
 * How many days of stock remain at current run rate.
 * Returns `Infinity` when the ingredient is not consumed at that branch.
 */
export function daysOfCover(
  state: AppState,
  ingredientId: IngredientId,
  branchId: BranchId,
  w: HistoryWindow,
): number {
  const level = findStock(state, branchId, ingredientId);
  if (!level) return 0;
  const usage = dailyIngredientUsage(state, ingredientId, branchId, w);
  if (usage <= 0) return Infinity;
  return level.qty / usage;
}

/**
 * How many portions of an item the branch can still produce, limited by its
 * scarcest ingredient. `Infinity` for an item with no recipe.
 */
export function portionsAvailable(state: AppState, item: MenuItem, branchId: BranchId): number {
  let limit = Infinity;
  for (const line of item.recipe) {
    if (line.qty <= 0) continue;
    const level = findStock(state, branchId, line.ingredientId);
    const have = level?.qty ?? 0;
    limit = Math.min(limit, Math.floor(have / line.qty));
  }
  return limit;
}

export interface StockAlert {
  branchId: BranchId;
  ingredientId: IngredientId;
  qty: number;
  parLevel: number;
  daysOfCover: number;
  /** Menu items that stop being sellable when this runs out. */
  blockedItemIds: ItemId[];
  severity: "critical" | "low";
}

/** Ingredients below par, worst first. */
export function stockAlerts(state: AppState, w: HistoryWindow, branchIds?: BranchId[]): StockAlert[] {
  const scope = new Set(resolveBranchIds(state, branchIds));
  const alerts: StockAlert[] = [];

  for (const level of state.stock) {
    if (!scope.has(level.branchId)) continue;
    if (level.qty >= level.parLevel) continue;

    const cover = daysOfCover(state, level.ingredientId, level.branchId, w);
    const blockedItemIds = state.menu
      .filter((m) => m.recipe.some((r) => r.ingredientId === level.ingredientId))
      .map((m) => m.id);

    alerts.push({
      branchId: level.branchId,
      ingredientId: level.ingredientId,
      qty: level.qty,
      parLevel: level.parLevel,
      daysOfCover: cover,
      blockedItemIds,
      severity: cover < 1 ? "critical" : "low",
    });
  }

  return alerts.sort((a, b) => a.daysOfCover - b.daysOfCover);
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface PriceChangeProjection {
  branchId: BranchId;
  oldPriceCents: number;
  newPriceCents: number;
  unitsLast7d: number;
  /** Units projected for the next 7 days after elasticity is applied. */
  projectedUnits: number;
  oldWeeklyMarginCents: number;
  newWeeklyMarginCents: number;
  marginDeltaCents: number;
  /** True when the new price sits below ingredient cost. */
  sellsBelowCost: boolean;
}

/**
 * Projects the weekly margin effect of repricing one item at one branch.
 *
 * Volume is adjusted by {@link PRICE_ELASTICITY} and floored at zero — a price
 * rise never increases units. Margin is computed against current ingredient
 * cost, so a price cut that dips below cost surfaces as a negative margin
 * rather than as merely "less profit".
 */
export function projectPriceChange(
  state: AppState,
  item: MenuItem,
  branchId: BranchId,
  newPriceCents: number,
  w: HistoryWindow,
): PriceChangeProjection {
  const oldPriceCents = effectivePriceCents(item, branchId);
  const cost = portionCostCents(state, item);
  const unitsLast7d = unitsSold(state, item.id, w, [branchId]);

  const pctChange = oldPriceCents > 0 ? (newPriceCents - oldPriceCents) / oldPriceCents : 0;
  const volumeFactor = Math.max(0, 1 + PRICE_ELASTICITY * pctChange);
  const projectedUnits = Math.round(unitsLast7d * volumeFactor);

  const oldWeeklyMarginCents = unitsLast7d * (oldPriceCents - cost);
  const newWeeklyMarginCents = projectedUnits * (newPriceCents - cost);

  return {
    branchId,
    oldPriceCents,
    newPriceCents,
    unitsLast7d,
    projectedUnits,
    oldWeeklyMarginCents,
    newWeeklyMarginCents,
    marginDeltaCents: newWeeklyMarginCents - oldWeeklyMarginCents,
    sellsBelowCost: newPriceCents < cost,
  };
}

export interface EightySixProjection {
  branchId: BranchId;
  unitsLast7d: number;
  ordersAffectedLast7d: number;
  /** Weekly revenue that stops flowing, in cents. */
  revenueAtRiskCents: number;
  /** Weekly margin that stops flowing, in cents. */
  marginAtRiskCents: number;
  revenueShare: number;
  /** Portions the branch could still have made from stock on hand. */
  portionsStillPossible: number;
}

/** Projects the cost of pulling an item from sale at one branch for a week. */
export function projectEightySix(
  state: AppState,
  item: MenuItem,
  branchId: BranchId,
  w: HistoryWindow,
): EightySixProjection {
  const unitsLast7d = unitsSold(state, item.id, w, [branchId]);
  const price = effectivePriceCents(item, branchId);
  const margin = portionMarginCents(state, item, branchId);

  return {
    branchId,
    unitsLast7d,
    ordersAffectedLast7d: ordersContaining(state, item.id, w, [branchId]),
    revenueAtRiskCents: unitsLast7d * price,
    marginAtRiskCents: unitsLast7d * margin,
    revenueShare: itemRevenueShare(state, item.id, w, [branchId]),
    portionsStillPossible: portionsAvailable(state, item, branchId),
  };
}

export interface PurchaseLine {
  ingredientId: IngredientId;
  qty: number;
}

export interface PurchaseProjection {
  supplierId: string;
  branchId: BranchId;
  lines: (PurchaseLine & { unitCostCents: number; lineCostCents: number })[];
  totalCents: number;
  /** True when the order is below the supplier's minimum and would be rejected. */
  belowSupplierMinimum: boolean;
  leadTimeDays: number;
  /**
   * Ingredients on this order that will run out before delivery arrives, at the
   * branch's current run rate. Ordering does not stop the stockout.
   *
   * Each entry carries the branch's actual remaining cover, so the warning shown
   * to the approver quotes a real measurement rather than a restatement of the
   * lead time.
   */
  arrivesTooLateFor: { ingredientId: IngredientId; daysOfCover: number }[];
}

/** Costs a purchase order and checks it against supplier terms and run rate. */
export function projectPurchase(
  state: AppState,
  supplierId: string,
  branchId: BranchId,
  lines: PurchaseLine[],
  w: HistoryWindow,
): PurchaseProjection {
  const supplier = state.suppliers.find((s) => s.id === supplierId);
  const leadTimeDays = supplier?.leadTimeDays ?? 0;

  const priced = lines.map((line) => {
    const ing = findIngredient(state, line.ingredientId);
    const unitCostCents = ing?.costPerUnitCents ?? 0;
    return {
      ...line,
      unitCostCents,
      lineCostCents: Math.round(unitCostCents * line.qty),
    };
  });

  const totalCents = priced.reduce((sum, l) => sum + l.lineCostCents, 0);

  const arrivesTooLateFor = lines
    .map((line) => ({
      ingredientId: line.ingredientId,
      daysOfCover: daysOfCover(state, line.ingredientId, branchId, w),
    }))
    .filter((row) => row.daysOfCover < leadTimeDays);

  return {
    supplierId,
    branchId,
    lines: priced,
    totalCents,
    belowSupplierMinimum: supplier ? totalCents < supplier.minimumOrderCents : false,
    leadTimeDays,
    arrivesTooLateFor,
  };
}

export interface ShiftCoverage {
  branchId: BranchId;
  /** Hour of day, 10..22. */
  hour: number;
  staffOnDuty: number;
  /** Staff needed for the covers this branch does in that hour. */
  staffNeeded: number;
}

/**
 * Coverage gaps for a branch's roster, using one front-of-house member per 18
 * covers per hour — the rule the chain actually rosters against.
 */
export const COVERS_PER_STAFF_HOUR = 18;

export function coverageGaps(state: AppState, branchId: BranchId, w: HistoryWindow): ShiftCoverage[] {
  const orders = billableOrders(state, w, [branchId]);
  const days = Math.max(1, (w.untilMs - w.sinceMs) / DAY_MS);

  const perHour = new Map<number, number>();
  for (const order of orders) {
    const hour = new Date(order.placedAt).getHours();
    perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
  }

  const gaps: ShiftCoverage[] = [];
  for (let hour = 10; hour <= 22; hour++) {
    const avgCovers = (perHour.get(hour) ?? 0) / days;
    const staffNeeded = Math.ceil(avgCovers / COVERS_PER_STAFF_HOUR);

    const staffOnDuty = state.shifts.filter((s) => {
      if (s.branchId !== branchId) return false;
      if (s.role === "courier" || s.role === "manager") return false;
      return new Date(s.start).getHours() <= hour && new Date(s.end).getHours() > hour;
    }).length;

    if (staffOnDuty < staffNeeded) {
      gaps.push({ branchId, hour, staffOnDuty, staffNeeded });
    }
  }

  return gaps;
}
