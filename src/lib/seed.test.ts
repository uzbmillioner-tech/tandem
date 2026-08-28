/**
 * Guards on the demo dataset.
 *
 * The seed is not just filler: judges and users read real conclusions off it. A
 * chain running at an impossible margin, or with no problem to find, makes the
 * whole product read as a mock-up. These tests pin the properties the demo
 * depends on so a later tweak to a price or a recipe cannot quietly break them.
 */

import { describe, expect, it } from "vitest";

import {
  lastNDays,
  marginCents,
  portionCostCents,
  revenueCents,
  stockAlerts,
} from "./analytics";
import { createSeedState } from "./seed";

const NOW = new Date("2026-08-20T12:00:00.000Z");

describe("seed dataset", () => {
  it("is deterministic for a given clock", () => {
    const a = createSeedState(NOW);
    const b = createSeedState(NOW);
    expect(a.orders.length).toBe(b.orders.length);
    expect(a.orders.map((o) => o.id)).toEqual(b.orders.map((o) => o.id));
    expect(a.stock).toEqual(b.stock);
  });

  it("runs at a food cost a real operator would recognise", () => {
    const s = createSeedState(NOW);
    const w = lastNDays(NOW, 7);
    const revenue = revenueCents(s, w);
    const margin = marginCents(s, w);
    const foodCostShare = 1 - margin / revenue;

    // Casual dining sits around 26–36% food cost.
    expect(foodCostShare).toBeGreaterThan(0.26);
    expect(foodCostShare).toBeLessThan(0.36);
  });

  it("prices every item above what it costs to make", () => {
    const s = createSeedState(NOW);
    for (const item of s.menu) {
      for (const branch of s.branches) {
        const price = item.priceOverrides[branch.id] ?? item.priceCents;
        expect(price).toBeGreaterThan(portionCostCents(s, item));
      }
    }
  });

  it("opens with exactly one critical shortage to find", () => {
    const s = createSeedState(NOW);
    const critical = stockAlerts(s, lastNDays(NOW, 7)).filter((a) => a.severity === "critical");
    expect(critical).toHaveLength(1);
    expect(critical[0]).toMatchObject({ branchId: "downtown", ingredientId: "lamb" });
  });

  it("raises alerts only for the three scripted shortages", () => {
    const s = createSeedState(NOW);
    const alerts = stockAlerts(s, lastNDays(NOW, 7));
    expect(alerts.map((a) => `${a.branchId}/${a.ingredientId}`).sort()).toEqual([
      "airport/flour",
      "downtown/lamb",
      "riverside/yogurt",
    ]);
  });

  it("scales par to what each branch actually uses", () => {
    const s = createSeedState(NOW);
    const tea = s.stock.find((x) => x.branchId === "downtown" && x.ingredientId === "tea");
    const lamb = s.stock.find((x) => x.branchId === "downtown" && x.ingredientId === "lamb");

    // Eight grams of tea per pot must not share a threshold with 180g of lamb
    // per plate, or "below par" stops carrying information.
    expect(tea!.parLevel).toBeLessThan(lamb!.parLevel);
    expect(tea!.parLevel).toBeGreaterThan(0);
  });

  it("carries a full week of trade across every branch", () => {
    const s = createSeedState(NOW);
    const w = lastNDays(NOW, 7);
    for (const branch of s.branches) {
      expect(revenueCents(s, w, [branch.id])).toBeGreaterThan(0);
    }
    expect(s.orders.length).toBeGreaterThan(300);
  });

  it("starts with a clean slate for the agent", () => {
    const s = createSeedState(NOW);
    expect(s.proposals).toEqual([]);
    expect(s.audit).toEqual([]);
    expect(s.standingApprovals).toEqual([]);
    expect(s.menu.every((m) => m.eightySixedAt.length === 0)).toBe(true);
  });
});
