/**
 * Tests for proposal construction, risk grading, standing approvals and
 * application.
 *
 * This is the safety boundary of the whole app: a write tool must never mutate,
 * a proposal must never understate its cost, and application must never apply
 * more than the payload says. Each of those is asserted here.
 */

import { describe, expect, it } from "vitest";

import { NOW, fixture } from "./fixture.test-helper";
import {
  __resetProposalCounter,
  applyProposal,
  buildEightySixProposal,
  buildPriceChangeProposal,
  buildPurchaseOrderProposal,
  buildRefundProposal,
  buildRestockProposal,
  buildShiftChangeProposal,
  isBuilderError,
  matchStandingApproval,
  riskAtMost,
  riskFor,
  sellableNow,
} from "./proposals";
import type { BlastRadius, Proposal, StandingApproval } from "./types";

function unwrap(v: Proposal | { error: string }): Proposal {
  if (isBuilderError(v)) throw new Error(`expected a proposal, got error: ${v.error}`);
  return v;
}

function expectError(v: Proposal | { error: string }): string {
  if (!isBuilderError(v)) throw new Error("expected an error, got a proposal");
  return v.error;
}

const emptyBlast: BlastRadius = {
  branchIds: [],
  cashDeltaCents: 0,
  weeklyMarginDeltaCents: 0,
  ordersAffectedLast7d: 0,
  revenueShare: 0,
  warnings: [],
};

describe("risk grading", () => {
  it("grades a trivial change as low", () => {
    expect(riskFor(emptyBlast)).toBe("low");
  });

  it("escalates to medium on moderate cash movement", () => {
    expect(riskFor({ ...emptyBlast, cashDeltaCents: -5_000 })).toBe("medium");
  });

  it("escalates to high on large cash movement", () => {
    expect(riskFor({ ...emptyBlast, cashDeltaCents: -20_000 })).toBe("high");
  });

  it("grades on absolute value, so inbound and outbound cash rank alike", () => {
    expect(riskFor({ ...emptyBlast, cashDeltaCents: 20_000 })).toBe("high");
  });

  it("escalates on revenue share even when no cash moves", () => {
    expect(riskFor({ ...emptyBlast, revenueShare: 0.2 })).toBe("high");
    expect(riskFor({ ...emptyBlast, revenueShare: 0.06 })).toBe("medium");
  });

  it("escalates when the page found concrete problems", () => {
    expect(riskFor({ ...emptyBlast, warnings: ["one"] })).toBe("medium");
    expect(riskFor({ ...emptyBlast, warnings: ["one", "two"] })).toBe("high");
  });

  it("orders risk levels", () => {
    expect(riskAtMost("low", "medium")).toBe(true);
    expect(riskAtMost("high", "medium")).toBe(false);
    expect(riskAtMost("medium", "medium")).toBe(true);
  });
});

describe("standing approvals", () => {
  const grant: StandingApproval = {
    id: "grant_1",
    kind: "restock",
    maxCashImpactCents: 5_000,
    maxRisk: "low",
    usesRemaining: 3,
    createdAt: NOW.toISOString(),
  };

  function proposalWith(over: Partial<Proposal>): Proposal {
    return {
      id: "p",
      kind: "restock",
      title: "t",
      rationale: "r",
      changes: [],
      blastRadius: emptyBlast,
      risk: "low",
      status: "pending",
      createdAt: NOW.toISOString(),
      payload: {},
      ...over,
    };
  }

  it("matches a proposal inside every ceiling", () => {
    expect(matchStandingApproval(proposalWith({}), [grant])).toBe(grant);
  });

  it("does not match a different kind", () => {
    expect(matchStandingApproval(proposalWith({ kind: "refund" }), [grant])).toBeNull();
  });

  it("does not match above the cash ceiling", () => {
    const p = proposalWith({ blastRadius: { ...emptyBlast, cashDeltaCents: -5_001 } });
    expect(matchStandingApproval(p, [grant])).toBeNull();
  });

  it("does not match above the risk ceiling", () => {
    expect(matchStandingApproval(proposalWith({ risk: "medium" }), [grant])).toBeNull();
  });

  it("does not match an exhausted grant", () => {
    expect(matchStandingApproval(proposalWith({}), [{ ...grant, usesRemaining: 0 }])).toBeNull();
  });

  it("matches on absolute cash, so a large inbound amount still stops", () => {
    const p = proposalWith({ blastRadius: { ...emptyBlast, cashDeltaCents: 9_999 } });
    expect(matchStandingApproval(p, [grant])).toBeNull();
  });
});

describe("price change proposals", () => {
  it("builds a costed proposal without mutating state", () => {
    __resetProposalCounter();
    const s = fixture();
    const before = structuredClone(s);

    const p = unwrap(
      buildPriceChangeProposal(
        s,
        { itemId: "burger", branchIds: ["a"], newPriceCents: 1650 },
        "Beef cost is up 8%.",
        NOW,
      ),
    );

    expect(s).toEqual(before);
    expect(p.status).toBe("pending");
    expect(p.kind).toBe("price_change");
    expect(p.changes[0]).toMatchObject({ field: "Price", before: "$15.00", after: "$16.50" });
    expect(p.blastRadius.weeklyMarginDeltaCents).toBe(1_570);
    expect(p.blastRadius.cashDeltaCents).toBe(0);
    expect(p.rationale).toBe("Beef cost is up 8%.");
  });

  it("warns when the new price is below ingredient cost", () => {
    const s = fixture();
    const p = unwrap(
      buildPriceChangeProposal(s, { itemId: "burger", branchIds: ["a"], newPriceCents: 100 }, "", NOW),
    );
    expect(p.blastRadius.warnings.join(" ")).toContain("below the $2.20 ingredient cost");
  });

  it("warns about a steep rise and its volume cost", () => {
    const s = fixture();
    const p = unwrap(
      buildPriceChangeProposal(s, { itemId: "burger", branchIds: ["a"], newPriceCents: 2000 }, "", NOW),
    );
    expect(p.blastRadius.warnings.join(" ")).toContain("33%");
  });

  it("spans every branch when none is named", () => {
    const s = fixture();
    const p = unwrap(
      buildPriceChangeProposal(s, { itemId: "burger", branchIds: [], newPriceCents: 1600 }, "", NOW),
    );
    expect(p.blastRadius.branchIds).toEqual(["a", "b"]);
    expect(p.changes).toHaveLength(2);
  });

  it("rejects an unknown item", () => {
    const s = fixture();
    expect(
      expectError(
        buildPriceChangeProposal(s, { itemId: "ghost", branchIds: ["a"], newPriceCents: 100 }, "", NOW),
      ),
    ).toContain("Unknown menu item");
  });

  it("rejects a negative price", () => {
    const s = fixture();
    expect(
      expectError(
        buildPriceChangeProposal(s, { itemId: "burger", branchIds: ["a"], newPriceCents: -1 }, "", NOW),
      ),
    ).toContain("zero or more");
  });

  it("rejects a branch list that matches nothing real", () => {
    const s = fixture();
    expect(
      expectError(
        buildPriceChangeProposal(
          s,
          { itemId: "burger", branchIds: ["nowhere"], newPriceCents: 1600 },
          "",
          NOW,
        ),
      ),
    ).toContain("No matching branches");
  });
});

describe("eighty-six proposals", () => {
  it("prices the lost margin as a negative delta", () => {
    const s = fixture();
    const p = unwrap(
      buildEightySixProposal(s, { itemId: "burger", branchIds: ["a"], restore: false }, "Out of beef.", NOW),
    );
    expect(p.blastRadius.weeklyMarginDeltaCents).toBe(-25_600);
    expect(p.blastRadius.ordersAffectedLast7d).toBe(10);
    expect(p.changes[0]).toMatchObject({ before: "On sale", after: "Off menu" });
  });

  it("warns when pulling a large share of branch revenue", () => {
    const s = fixture();
    const p = unwrap(
      buildEightySixProposal(s, { itemId: "burger", branchIds: ["a"], restore: false }, "", NOW),
    );
    expect(p.blastRadius.warnings.join(" ")).toContain("100% of Alpha revenue");
  });

  it("warns when restoring an item the branch cannot make", () => {
    const s = fixture();
    s.stock[0].qty = 0;
    s.menu[0].eightySixedAt = ["a"];
    const p = unwrap(
      buildEightySixProposal(s, { itemId: "burger", branchIds: ["a"], restore: true }, "", NOW),
    );
    expect(p.blastRadius.warnings.join(" ")).toContain("no stock");
    expect(p.blastRadius.weeklyMarginDeltaCents).toBe(0);
  });
});

describe("restock proposals", () => {
  it("shows the before and after count", () => {
    const s = fixture();
    const p = unwrap(
      buildRestockProposal(s, { branchId: "a", ingredientId: "x", deltaQty: 8 }, "Delivery landed.", NOW),
    );
    expect(p.changes[0]).toMatchObject({ before: "2 kg", after: "10 kg" });
    expect(p.blastRadius.cashDeltaCents).toBe(0);
  });

  it("warns when a correction would go negative", () => {
    const s = fixture();
    const p = unwrap(
      buildRestockProposal(s, { branchId: "a", ingredientId: "x", deltaQty: -5 }, "", NOW),
    );
    expect(p.blastRadius.warnings.join(" ")).toContain("negative");
    expect(p.changes[0].after).toBe("0 kg");
  });

  it("rejects a no-op adjustment", () => {
    const s = fixture();
    expect(
      expectError(buildRestockProposal(s, { branchId: "a", ingredientId: "x", deltaQty: 0 }, "", NOW)),
    ).toContain("non-zero");
  });
});

describe("purchase order proposals", () => {
  it("records the cash leaving the business as a negative delta", () => {
    const s = fixture();
    const p = unwrap(
      buildPurchaseOrderProposal(
        s,
        { supplierId: "sup", branchId: "a", lines: [{ ingredientId: "x", qty: 6 }] },
        "Cover the weekend.",
        NOW,
      ),
    );
    expect(p.blastRadius.cashDeltaCents).toBe(-6_000);
    expect(p.title).toContain("$60.00");
  });

  it("warns when the order is under the supplier minimum", () => {
    const s = fixture();
    const p = unwrap(
      buildPurchaseOrderProposal(
        s,
        { supplierId: "sup", branchId: "a", lines: [{ ingredientId: "y", qty: 1 }] },
        "",
        NOW,
      ),
    );
    expect(p.blastRadius.warnings.join(" ")).toContain("minimum");
  });

  it("rejects an empty order", () => {
    const s = fixture();
    expect(
      expectError(buildPurchaseOrderProposal(s, { supplierId: "sup", branchId: "a", lines: [] }, "", NOW)),
    ).toContain("at least one line");
  });

  it("rejects an unknown supplier", () => {
    const s = fixture();
    expect(
      expectError(
        buildPurchaseOrderProposal(
          s,
          { supplierId: "ghost", branchId: "a", lines: [{ ingredientId: "x", qty: 1 }] },
          "",
          NOW,
        ),
      ),
    ).toContain("Unknown supplier");
  });
});

describe("refund proposals", () => {
  it("records the refund as cash leaving", () => {
    const s = fixture();
    const p = unwrap(
      buildRefundProposal(s, { orderId: "ord_0", amountCents: 1500, reason: "Cold food." }, "", NOW),
    );
    expect(p.blastRadius.cashDeltaCents).toBe(-1_500);
    expect(p.changes[1]).toMatchObject({ subject: "Cash", after: "−$15.00" });
  });

  it("refuses to refund more than the order was worth", () => {
    const s = fixture();
    expect(
      expectError(
        buildRefundProposal(s, { orderId: "ord_0", amountCents: 5_000, reason: "x" }, "", NOW),
      ),
    ).toContain("exceeds");
  });

  it("refuses to refund an already refunded order", () => {
    const s = fixture();
    s.orders[0].status = "refunded";
    expect(
      expectError(
        buildRefundProposal(s, { orderId: "ord_0", amountCents: 100, reason: "x" }, "", NOW),
      ),
    ).toContain("already refunded");
  });

  it("refuses a zero or negative refund", () => {
    const s = fixture();
    expect(
      expectError(buildRefundProposal(s, { orderId: "ord_0", amountCents: 0, reason: "x" }, "", NOW)),
    ).toContain("greater than zero");
  });

  it("warns on a full refund and on a missing reason", () => {
    const s = fixture();
    const p = unwrap(
      buildRefundProposal(s, { orderId: "ord_0", amountCents: 3_000, reason: "  " }, "", NOW),
    );
    expect(p.blastRadius.warnings).toHaveLength(2);
    expect(p.risk).toBe("high");
  });
});

describe("shift change proposals", () => {
  it("rejects a change that alters nothing", () => {
    const s = fixture();
    expect(
      expectError(buildShiftChangeProposal(s, { shiftId: "shift_1", newStaffName: "Ada" }, "", NOW)),
    ).toContain("does not alter anything");
  });

  it("describes a reassignment", () => {
    const s = fixture();
    const p = unwrap(
      buildShiftChangeProposal(s, { shiftId: "shift_1", newStaffName: "Grace" }, "Ada called in sick.", NOW),
    );
    expect(p.changes[0]).toMatchObject({ field: "Assigned to", before: "Ada", after: "Grace" });
  });

  it("rejects an unknown shift", () => {
    const s = fixture();
    expect(
      expectError(buildShiftChangeProposal(s, { shiftId: "ghost", newStaffName: "Grace" }, "", NOW)),
    ).toContain("Unknown shift");
  });
});

describe("applying proposals", () => {
  it("writes a per-branch price override", () => {
    const s = fixture();
    const p = unwrap(
      buildPriceChangeProposal(s, { itemId: "burger", branchIds: ["a"], newPriceCents: 1650 }, "", NOW),
    );
    const next = applyProposal(s, p);

    expect(next.menu[0].priceOverrides.a).toBe(1650);
    expect(next.menu[0].priceOverrides.b).toBe(1700);
    // The original state is untouched.
    expect(s.menu[0].priceOverrides.a).toBeUndefined();
  });

  it("adds and removes an eighty-six without duplicating branches", () => {
    const s = fixture();
    const off = unwrap(
      buildEightySixProposal(s, { itemId: "burger", branchIds: ["a"], restore: false }, "", NOW),
    );
    const afterOff = applyProposal(applyProposal(s, off), off);
    expect(afterOff.menu[0].eightySixedAt).toEqual(["a"]);

    const on = unwrap(
      buildEightySixProposal(afterOff, { itemId: "burger", branchIds: ["a"], restore: true }, "", NOW),
    );
    expect(applyProposal(afterOff, on).menu[0].eightySixedAt).toEqual([]);
  });

  it("clamps a stock correction at zero", () => {
    const s = fixture();
    const p = unwrap(
      buildRestockProposal(s, { branchId: "a", ingredientId: "x", deltaQty: -99 }, "", NOW),
    );
    const next = applyProposal(s, p);
    expect(next.stock[0].qty).toBe(0);
  });

  it("adds delivered quantities to the ordering branch only", () => {
    const s = fixture();
    const p = unwrap(
      buildPurchaseOrderProposal(
        s,
        { supplierId: "sup", branchId: "a", lines: [{ ingredientId: "x", qty: 6 }] },
        "",
        NOW,
      ),
    );
    const next = applyProposal(s, p);
    expect(next.stock[0].qty).toBe(8);
    expect(next.stock[2].qty).toBe(20);
  });

  it("marks the order refunded and records the amount", () => {
    const s = fixture();
    const p = unwrap(
      buildRefundProposal(s, { orderId: "ord_0", amountCents: 1500, reason: "Cold." }, "", NOW),
    );
    const next = applyProposal(s, p);
    expect(next.orders[0].status).toBe("refunded");
    expect(next.orders[0].refundedCents).toBe(1500);
  });

  it("reassigns a shift", () => {
    const s = fixture();
    const p = unwrap(
      buildShiftChangeProposal(s, { shiftId: "shift_1", newStaffName: "Grace" }, "", NOW),
    );
    expect(applyProposal(s, p).shifts[0].staffName).toBe("Grace");
  });
});

describe("sellableNow", () => {
  it("reports portions the branch can still produce", () => {
    const s = fixture();
    expect(sellableNow(s, "burger", "a")).toBe(10);
  });

  it("reports zero for an item that is off the menu", () => {
    const s = fixture();
    s.menu[0].eightySixedAt = ["a"];
    expect(sellableNow(s, "burger", "a")).toBe(0);
  });

  it("reports zero for an unknown item", () => {
    const s = fixture();
    expect(sellableNow(s, "ghost", "a")).toBe(0);
  });
});
