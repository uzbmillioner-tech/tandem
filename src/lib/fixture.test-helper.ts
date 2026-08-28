/**
 * Shared test fixture. Not part of the app bundle — nothing under `src/app`
 * imports this.
 *
 * The numbers are chosen so every expected value in the test suites can be
 * computed by hand: one burger at $15.00 costing $2.20 to make, twenty sold in
 * the window, and stock that allows exactly ten more.
 */

import type { AppState, Order } from "./types";

export const NOW = new Date("2026-08-20T12:00:00.000Z");

/** Ten orders, two burgers each, spread across the last week at branch `a`. */
export function buildOrders(): Order[] {
  const orders: Order[] = [];
  for (let i = 0; i < 10; i++) {
    const placed = new Date(NOW.getTime() - ((i % 6) + 0.5) * 86_400_000);
    orders.push({
      id: `ord_${i}`,
      branchId: "a",
      lines: [{ itemId: "burger", qty: 2, unitPriceCents: 1500 }],
      status: "completed",
      channel: "dine_in",
      placedAt: placed.toISOString(),
    });
  }
  return orders;
}

export function fixture(): AppState {
  return {
    branches: [
      { id: "a", name: "Alpha", city: "Testville", seats: 40, openNow: true },
      { id: "b", name: "Beta", city: "Testville", seats: 20, openNow: true },
    ],
    ingredients: [
      { id: "x", name: "Expensive", unit: "kg", costPerUnitCents: 1000, supplierId: "sup" },
      { id: "y", name: "Cheap", unit: "kg", costPerUnitCents: 200, supplierId: "sup" },
    ],
    suppliers: [{ id: "sup", name: "Supplier", leadTimeDays: 2, minimumOrderCents: 5000 }],
    menu: [
      {
        id: "burger",
        name: "Burger",
        category: "mains",
        priceCents: 1500,
        priceOverrides: { b: 1700 },
        recipe: [
          { ingredientId: "x", qty: 0.2 },
          { ingredientId: "y", qty: 0.1 },
        ],
        eightySixedAt: [],
        prepMinutes: 10,
      },
      {
        id: "water",
        name: "Water",
        category: "drinks",
        priceCents: 200,
        priceOverrides: {},
        recipe: [],
        eightySixedAt: [],
        prepMinutes: 1,
      },
    ],
    stock: [
      { branchId: "a", ingredientId: "x", qty: 2, parLevel: 10 },
      { branchId: "a", ingredientId: "y", qty: 5, parLevel: 10 },
      { branchId: "b", ingredientId: "x", qty: 20, parLevel: 10 },
      { branchId: "b", ingredientId: "y", qty: 20, parLevel: 10 },
    ],
    orders: buildOrders(),
    shifts: [
      {
        id: "shift_1",
        branchId: "a",
        staffName: "Ada",
        role: "server",
        start: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
        end: new Date(NOW.getTime() + 5 * 3_600_000).toISOString(),
      },
    ],
    proposals: [],
    standingApprovals: [],
    audit: [],
    view: "overview",
    focusedBranchId: null,
    highlightedId: null,
  };
}
