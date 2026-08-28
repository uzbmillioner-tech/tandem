/**
 * Tests for the consequence engine.
 *
 * These cover the arithmetic the approval card puts in front of a human. If a
 * number here is wrong, someone approves a change on a false premise, so the
 * fixture is deliberately small enough that every expected value below is hand
 * computed rather than snapshotted.
 */

import { describe, expect, it } from "vitest";

import {
  COVERS_PER_STAFF_HOUR,
  PRICE_ELASTICITY,
  daysOfCover,
  effectivePriceCents,
  itemRevenueShare,
  lastNDays,
  marginCents,
  ordersContaining,
  portionCostCents,
  portionMarginCents,
  portionsAvailable,
  projectEightySix,
  projectPriceChange,
  projectPurchase,
  revenueCents,
  stockAlerts,
  topItemsByRevenue,
  unitsSold,
} from "./analytics";
import { NOW, fixture } from "./fixture.test-helper";

const W = lastNDays(NOW, 7);

describe("pricing", () => {
  it("uses the chain price when a branch has no override", () => {
    const s = fixture();
    expect(effectivePriceCents(s.menu[0], "a")).toBe(1500);
  });

  it("prefers a branch override over the chain price", () => {
    const s = fixture();
    expect(effectivePriceCents(s.menu[0], "b")).toBe(1700);
  });

  it("costs a portion from its recipe", () => {
    const s = fixture();
    // 1000 * 0.2 + 200 * 0.1 = 220
    expect(portionCostCents(s, s.menu[0])).toBe(220);
  });

  it("treats a recipe-less item as free to make", () => {
    const s = fixture();
    expect(portionCostCents(s, s.menu[1])).toBe(0);
  });

  it("computes margin against the branch's effective price", () => {
    const s = fixture();
    expect(portionMarginCents(s, s.menu[0], "a")).toBe(1280);
    expect(portionMarginCents(s, s.menu[0], "b")).toBe(1480);
  });
});

describe("sales history", () => {
  it("counts units across all orders in the window", () => {
    const s = fixture();
    expect(unitsSold(s, "burger", W, ["a"])).toBe(20);
  });

  it("counts orders containing an item, not units", () => {
    const s = fixture();
    expect(ordersContaining(s, "burger", W, ["a"])).toBe(10);
  });

  it("totals revenue at the price actually charged", () => {
    const s = fixture();
    expect(revenueCents(s, W, ["a"])).toBe(30_000);
  });

  it("totals margin net of ingredient cost", () => {
    const s = fixture();
    // 20 portions * (1500 - 220)
    expect(marginCents(s, W, ["a"])).toBe(25_600);
  });

  it("excludes refunded orders from revenue", () => {
    const s = fixture();
    s.orders[0].status = "refunded";
    expect(revenueCents(s, W, ["a"])).toBe(27_000);
  });

  it("ignores orders outside the window", () => {
    const s = fixture();
    s.orders.push({
      id: "old",
      branchId: "a",
      lines: [{ itemId: "burger", qty: 100, unitPriceCents: 1500 }],
      status: "completed",
      channel: "dine_in",
      placedAt: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
    });
    expect(unitsSold(s, "burger", W, ["a"])).toBe(20);
  });

  it("ranks items by revenue", () => {
    const s = fixture();
    const ranked = topItemsByRevenue(s, W, ["a"]);
    expect(ranked[0].itemId).toBe("burger");
    expect(ranked[0].units).toBe(20);
  });

  it("reports revenue share of the only item as the whole window", () => {
    const s = fixture();
    expect(itemRevenueShare(s, "burger", W, ["a"])).toBe(1);
  });

  it("returns a zero share when nothing sold", () => {
    const s = fixture();
    s.orders = [];
    expect(itemRevenueShare(s, "burger", W, ["a"])).toBe(0);
  });
});

describe("stock", () => {
  it("limits portions by the scarcest ingredient", () => {
    const s = fixture();
    // x allows floor(2 / 0.2) = 10; y allows floor(5 / 0.1) = 50
    expect(portionsAvailable(s, s.menu[0], "a")).toBe(10);
  });

  it("treats a recipe-less item as unlimited", () => {
    const s = fixture();
    expect(portionsAvailable(s, s.menu[1], "a")).toBe(Infinity);
  });

  it("derives days of cover from actual consumption", () => {
    const s = fixture();
    // 20 portions * 0.2kg = 4kg over 7 days = 0.5714 kg/day; 2kg on hand
    expect(daysOfCover(s, "x", "a", W)).toBeCloseTo(3.5, 5);
  });

  it("reports unbounded cover for an unused ingredient", () => {
    const s = fixture();
    expect(daysOfCover(s, "x", "b", W)).toBe(Infinity);
  });

  it("raises alerts only below par, worst cover first", () => {
    const s = fixture();
    const alerts = stockAlerts(s, W, ["a", "b"]);
    expect(alerts.map((a) => `${a.branchId}/${a.ingredientId}`)).toEqual(["a/x", "a/y"]);
    expect(alerts[0].severity).toBe("low");
  });

  it("names the menu items an alert would block", () => {
    const s = fixture();
    const alert = stockAlerts(s, W, ["a"])[0];
    expect(alert.blockedItemIds).toEqual(["burger"]);
  });
});

describe("price change projection", () => {
  it("applies elasticity to projected volume", () => {
    const s = fixture();
    const p = projectPriceChange(s, s.menu[0], "a", 1650, W);

    // +10% price, elasticity -0.6 -> 0.94 volume factor, 20 * 0.94 = 18.8 -> 19
    expect(PRICE_ELASTICITY).toBe(-0.6);
    expect(p.unitsLast7d).toBe(20);
    expect(p.projectedUnits).toBe(19);
    expect(p.oldWeeklyMarginCents).toBe(25_600);
    expect(p.newWeeklyMarginCents).toBe(27_170);
    expect(p.marginDeltaCents).toBe(1_570);
  });

  it("projects a margin loss for a price cut", () => {
    const s = fixture();
    const p = projectPriceChange(s, s.menu[0], "a", 1350, W);
    expect(p.marginDeltaCents).toBeLessThan(0);
  });

  it("flags a price set below ingredient cost", () => {
    const s = fixture();
    const p = projectPriceChange(s, s.menu[0], "a", 200, W);
    expect(p.sellsBelowCost).toBe(true);
    expect(p.newWeeklyMarginCents).toBeLessThan(0);
  });

  it("does not flag a price exactly at cost", () => {
    const s = fixture();
    const p = projectPriceChange(s, s.menu[0], "a", 220, W);
    expect(p.sellsBelowCost).toBe(false);
  });

  it("never projects negative volume for an extreme rise", () => {
    const s = fixture();
    const p = projectPriceChange(s, s.menu[0], "a", 15_000, W);
    expect(p.projectedUnits).toBeGreaterThanOrEqual(0);
  });
});

describe("eighty-six projection", () => {
  it("prices a week of lost sales", () => {
    const s = fixture();
    const p = projectEightySix(s, s.menu[0], "a", W);
    expect(p.unitsLast7d).toBe(20);
    expect(p.ordersAffectedLast7d).toBe(10);
    expect(p.revenueAtRiskCents).toBe(30_000);
    expect(p.marginAtRiskCents).toBe(25_600);
    expect(p.portionsStillPossible).toBe(10);
  });
});

describe("purchase projection", () => {
  it("costs lines at supplier unit cost", () => {
    const s = fixture();
    const p = projectPurchase(s, "sup", "a", [{ ingredientId: "x", qty: 6 }], W);
    expect(p.totalCents).toBe(6_000);
    expect(p.belowSupplierMinimum).toBe(false);
  });

  it("flags an order under the supplier minimum", () => {
    const s = fixture();
    const p = projectPurchase(s, "sup", "a", [{ ingredientId: "y", qty: 1 }], W);
    expect(p.totalCents).toBe(200);
    expect(p.belowSupplierMinimum).toBe(true);
  });

  it("flags stock that runs out before the delivery lands", () => {
    const s = fixture();
    // x has 3.5 days of cover at branch a; supplier lead time is 2 days.
    const ok = projectPurchase(s, "sup", "a", [{ ingredientId: "x", qty: 6 }], W);
    expect(ok.arrivesTooLateFor).toEqual([]);

    s.stock[0].qty = 0.5; // 0.5 / (4kg over 7 days) = 0.875 days, under the 2 day lead time
    const late = projectPurchase(s, "sup", "a", [{ ingredientId: "x", qty: 6 }], W);
    expect(late.arrivesTooLateFor).toHaveLength(1);
    expect(late.arrivesTooLateFor[0].ingredientId).toBe("x");
    expect(late.arrivesTooLateFor[0].daysOfCover).toBeCloseTo(0.875, 5);
  });

  it("prices an unknown ingredient at zero rather than throwing", () => {
    const s = fixture();
    const p = projectPurchase(s, "sup", "a", [{ ingredientId: "ghost", qty: 5 }], W);
    expect(p.totalCents).toBe(0);
  });
});

describe("rostering constant", () => {
  it("keeps the covers-per-staff rule explicit", () => {
    expect(COVERS_PER_STAFF_HOUR).toBe(18);
  });
});
