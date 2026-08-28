/**
 * Contract tests for the tool surface.
 *
 * These pin the things a browser and an agent depend on but that no type can
 * enforce: that the set is what the README says it is, that every description
 * and result stays inside Chrome's size guidance, that read tools are annotated
 * as read-only, and — most importantly — that a write tool cannot mutate on its
 * own, no matter what the agent sends it.
 */

import { describe, expect, it, vi } from "vitest";

import { fixture } from "../fixture.test-helper";
import type { AppState, Proposal } from "../types";
import type { DecisionOutcome, StoreApi } from "../store";
import { createTools } from "./tools";
import type { ToolDefinition } from "./types";

const READ_TOOLS = [
  "analyze_item_performance",
  "get_audit_log",
  "get_business_snapshot",
  "list_branches",
  "list_menu",
  "list_orders",
  "list_proposals",
  "list_shifts",
  "list_stock_alerts",
  "list_suppliers",
];

const PROPOSE_TOOLS = [
  "propose_menu_availability",
  "propose_price_change",
  "propose_purchase_order",
  "propose_refund",
  "propose_shift_change",
  "propose_stock_correction",
];

/** Chrome's WebMCP guidance: descriptions under 500 chars, results under ~1.5K. */
const MAX_DESCRIPTION = 500;
const MAX_RESULT = 1_500;

interface Harness {
  tools: Map<string, ToolDefinition>;
  submitted: Proposal[];
  state: AppState;
}

function harness(outcome: DecisionOutcome = { status: "approved" }): Harness {
  const state = fixture();
  const submitted: Proposal[] = [];

  const store = {
    state,
    ready: true,
    setView: vi.fn(),
    setFocus: vi.fn(),
    setHighlight: vi.fn(),
    submitProposal: async (proposal: Proposal) => {
      submitted.push(proposal);
      return outcome;
    },
    decide: vi.fn(),
    grantStanding: vi.fn(),
    revokeStanding: vi.fn(),
    log: vi.fn(),
    reset: vi.fn(),
  } as unknown as StoreApi;

  const tools = createTools({ getStore: () => store, onCall: () => {} });
  return { tools: new Map(tools.map((t) => [t.name, t])), submitted, state };
}

function run(h: Harness, name: string, input: unknown): Promise<string> {
  const tool = h.tools.get(name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return Promise.resolve(tool.execute(input, {}));
}

describe("tool surface", () => {
  it("registers exactly the documented set", () => {
    const h = harness();
    const names = [...h.tools.keys()].sort();
    expect(names).toEqual([...READ_TOOLS, "show_section", ...PROPOSE_TOOLS].sort());
    expect(names).toHaveLength(17);
  });

  it("annotates every read tool as read-only", () => {
    const h = harness();
    for (const name of READ_TOOLS) {
      expect(h.tools.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("never marks a proposing tool read-only", () => {
    const h = harness();
    for (const name of PROPOSE_TOOLS) {
      expect(h.tools.get(name)?.annotations?.readOnlyHint, name).toBeUndefined();
    }
  });

  it("keeps every description inside the guidance", () => {
    const h = harness();
    for (const tool of h.tools.values()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(MAX_DESCRIPTION);
    }
  });

  it("declares an object input schema for every tool", () => {
    const h = harness();
    for (const tool of h.tools.values()) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
    }
  });
});

describe("read tools", () => {
  it("answer within the result size guidance", async () => {
    const h = harness();
    for (const name of READ_TOOLS) {
      const out = await run(h, name, {});
      expect(out.length, name).toBeGreaterThan(0);
      expect(out.length, name).toBeLessThanOrEqual(MAX_RESULT);
    }
  });

  it("do not raise proposals", async () => {
    const h = harness();
    for (const name of READ_TOOLS) await run(h, name, {});
    expect(h.submitted).toHaveLength(0);
  });

  it("survive junk input instead of throwing", async () => {
    const h = harness();
    for (const name of READ_TOOLS) {
      const out = await run(h, name, { branchIds: "not-an-array", limit: -99, itemId: 42 });
      expect(typeof out, name).toBe("string");
    }
  });
});

describe("proposing tools", () => {
  it("route every change through a decision rather than writing", async () => {
    const h = harness({ status: "approved" });
    const before = structuredClone(h.state);

    await run(h, "propose_price_change", {
      itemId: "burger",
      newPriceCents: 1650,
      branchIds: ["a"],
      rationale: "Cost is up.",
    });

    expect(h.submitted).toHaveLength(1);
    // The tool asked; it did not apply. Applying is the store's job on approval.
    expect(h.state).toEqual(before);
  });

  it("report the manager's rejection and their reason", async () => {
    const h = harness({ status: "rejected", note: "Not this week." });
    const out = await run(h, "propose_refund", {
      orderId: "ord_0",
      amountCents: 1000,
      reason: "Cold food.",
    });

    expect(out).toContain("REJECTED");
    expect(out).toContain("Not this week.");
    expect(out).toContain("Do not retry");
  });

  it("say plainly when a standing approval let it through", async () => {
    const h = harness({ status: "auto_approved", viaStandingApproval: true });
    const out = await run(h, "propose_stock_correction", {
      branchId: "a",
      ingredientId: "x",
      deltaQty: 4,
      rationale: "Delivery counted in.",
    });

    expect(out).toContain("AUTO-APPROVED");
    expect(out).toContain("standing approval");
  });

  it("refuse invalid input without raising a proposal", async () => {
    const h = harness();

    const cases: [string, unknown][] = [
      ["propose_price_change", { itemId: "ghost", newPriceCents: 100, rationale: "x" }],
      ["propose_price_change", { itemId: "burger", newPriceCents: -5, rationale: "x" }],
      ["propose_refund", { orderId: "ord_0", amountCents: 999_999, reason: "x" }],
      ["propose_refund", { orderId: "nope", amountCents: 100, reason: "x" }],
      ["propose_stock_correction", { branchId: "a", ingredientId: "x", deltaQty: 0, rationale: "x" }],
      ["propose_purchase_order", { supplierId: "sup", branchId: "a", lines: [], rationale: "x" }],
      ["propose_shift_change", { shiftId: "ghost", newStaffName: "Grace", rationale: "x" }],
    ];

    for (const [name, input] of cases) {
      const out = await run(h, name, input);
      expect(out, name).toContain("Not proposed");
    }
    expect(h.submitted).toHaveLength(0);
  });

  it("never throws out of a handler, whatever the agent sends", async () => {
    const h = harness();
    for (const name of PROPOSE_TOOLS) {
      const out = await run(h, name, undefined);
      expect(typeof out, name).toBe("string");
    }
    expect(h.submitted).toHaveLength(0);
  });
});

describe("show_section", () => {
  it("steers the manager's view without proposing anything", async () => {
    const h = harness();
    const out = await run(h, "show_section", { section: "stock", branchId: "a" });
    expect(out).toContain("stock");
    expect(h.submitted).toHaveLength(0);
  });
});
