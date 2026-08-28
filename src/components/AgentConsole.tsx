"use client";

/**
 * An agent stand-in that runs inside the page.
 *
 * Two reasons this exists rather than being a debug afterthought:
 *
 *  1. WebMCP is behind a flag in most browsers today. Without this, anyone
 *     opening the page normally sees a dashboard and has to take the agent half
 *     on faith.
 *  2. It calls the *same* registered tool objects an agent calls — not a parallel
 *     code path. Whatever you see here is what an agent gets.
 *
 * Write tools block here exactly as they do for a real agent: the call sits
 * unresolved until someone decides on the card in the rail.
 */

import { useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import type { TandemAgent } from "@/lib/webmcp/useTandemAgent";
import type { AppState } from "@/lib/types";
import { Chip, SectionHeader } from "./ui";

interface Step {
  tool: string;
  args: Record<string, unknown>;
}

interface Scenario {
  id: string;
  label: string;
  hint: string;
  build(state: AppState): Step[];
}

/**
 * Scripted runs that mirror how an agent would actually work a shift: look
 * first, then ask. Each one ends in a proposal so the handshake is visible.
 */
const SCENARIOS: Scenario[] = [
  {
    id: "morning",
    label: "Morning check",
    hint: "Read-only. Snapshot plus anything running low.",
    build: () => [
      { tool: "get_business_snapshot", args: {} },
      { tool: "list_stock_alerts", args: {} },
    ],
  },
  {
    id: "restock",
    label: "Fix the shortage",
    hint: "Finds the worst shortage, then asks to buy stock. Spends money — needs your call.",
    build: (state) => {
      // Reproduce the alert the agent would see, then order a week of cover.
      const worst = state.stock
        .filter((s) => s.qty < s.parLevel)
        .sort((a, b) => a.qty / a.parLevel - b.qty / b.parLevel)[0];

      if (!worst) return [{ tool: "list_stock_alerts", args: {} }];

      const ingredient = state.ingredients.find((i) => i.id === worst.ingredientId);
      const topUp = Math.max(1, Math.ceil(worst.parLevel * 1.5 - worst.qty));

      return [
        { tool: "list_stock_alerts", args: { branchIds: [worst.branchId] } },
        { tool: "list_suppliers", args: {} },
        {
          tool: "propose_purchase_order",
          args: {
            supplierId: ingredient?.supplierId ?? state.suppliers[0].id,
            branchId: worst.branchId,
            lines: [{ ingredientId: worst.ingredientId, qty: topUp }],
            rationale: `${ingredient?.name ?? worst.ingredientId} is below par and blocks several mains. This brings it back above par with a week of headroom.`,
          },
        },
      ];
    },
  },
  {
    id: "waste",
    label: "Log some waste",
    hint: "A small stock correction. Low risk — the one place a standing approval is offered.",
    build: (state) => {
      // Pick a well-stocked ingredient so the correction is unremarkable: the
      // point of this run is the standing-approval offer, not the shortage.
      const best = [...state.stock]
        .filter((s) => s.qty > s.parLevel)
        .sort((a, b) => b.qty / b.parLevel - a.qty / a.parLevel)[0];

      if (!best) return [{ tool: "list_stock_alerts", args: {} }];
      const ingredient = state.ingredients.find((i) => i.id === best.ingredientId);

      return [
        { tool: "show_section", args: { section: "stock", branchId: best.branchId } },
        {
          tool: "propose_stock_correction",
          args: {
            branchId: best.branchId,
            ingredientId: best.ingredientId,
            deltaQty: -Math.max(0.5, Math.round(best.qty * 0.05 * 10) / 10),
            rationale: `Kitchen reported spoilage on ${ingredient?.name ?? best.ingredientId}. Writing it off so the count matches the shelf.`,
          },
        },
      ];
    },
  },
  {
    id: "reprice",
    label: "Reprice the top seller",
    hint: "Analyses the best seller, then asks for a 6% rise. No cash moves, but margin does.",
    build: (state) => {
      const item = state.menu[0];
      const newPrice = Math.round(item.priceCents * 1.06);
      return [
        { tool: "analyze_item_performance", args: {} },
        { tool: "analyze_item_performance", args: { itemId: item.id } },
        {
          tool: "propose_price_change",
          args: {
            itemId: item.id,
            newPriceCents: newPrice,
            rationale: `${item.name} is the strongest seller and has absorbed ingredient cost rises without a price move. A 6% rise should hold most of the volume.`,
          },
        },
      ];
    },
  },
  {
    id: "refund",
    label: "Handle a complaint",
    hint: "Finds a recent order and asks to refund it. Money leaves — always needs your call.",
    build: (state) => {
      const order = [...state.orders].reverse().find((o) => o.status === "completed");
      if (!order) return [{ tool: "list_orders", args: { limit: 5 } }];
      const total = order.lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
      return [
        { tool: "list_orders", args: { limit: 5, status: "completed" } },
        {
          tool: "propose_refund",
          args: {
            orderId: order.id,
            amountCents: total,
            reason: "Customer says the order arrived cold and they did not eat it.",
          },
        },
      ];
    },
  },
];

interface Line {
  id: string;
  kind: "call" | "result" | "note";
  text: string;
}

let lineCounter = 0;
function line(kind: Line["kind"], text: string): Line {
  lineCounter += 1;
  return { id: `l${lineCounter}`, kind, text };
}

export function AgentConsole({ agent }: { agent: TandemAgent }) {
  const { state } = useStore();
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedTool, setSelectedTool] = useState(agent.tools[0]?.name ?? "");
  const [argsText, setArgsText] = useState("{}");
  const [argsError, setArgsError] = useState<string | null>(null);

  const byName = useMemo(
    () => new Map(agent.tools.map((t) => [t.name, t])),
    [agent.tools],
  );

  async function runSteps(steps: Step[]) {
    setRunning(true);
    try {
      for (const step of steps) {
        const tool = byName.get(step.tool);
        if (!tool) {
          setTranscript((t) => [...t, line("note", `No such tool: ${step.tool}`)]);
          continue;
        }

        setTranscript((t) => [
          ...t,
          line("call", `${step.tool}(${compactArgs(step.args)})`),
        ]);

        const result = await tool.execute(step.args, {});
        setTranscript((t) => [...t, line("result", result)]);
      }
    } catch (err) {
      setTranscript((t) => [
        ...t,
        line("note", `Run stopped: ${err instanceof Error ? err.message : String(err)}`),
      ]);
    } finally {
      setRunning(false);
    }
  }

  // The handler is rebuilt each render, so `state` here is the state as of the
  // click — which is what a scenario should plan against.
  function runScenario(scenario: Scenario) {
    setTranscript((t) => [...t, line("note", `▶ ${scenario.label}`)]);
    void runSteps(scenario.build(state));
  }

  function runManual() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(argsText || "{}") as Record<string, unknown>;
      setArgsError(null);
    } catch {
      setArgsError("That is not valid JSON.");
      return;
    }
    void runSteps([{ tool: selectedTool, args: parsed }]);
  }

  const active = byName.get(selectedTool);

  return (
    <section className="panel p-4" aria-label="Agent console">
      <SectionHeader
        title="Agent console"
        description="Drive the tools yourself. This calls the same registered tools an agent calls, so a proposal raised here waits for your decision exactly as a real one does."
        actions={
          transcript.length > 0 ? (
            <button className="btn" onClick={() => setTranscript([])} disabled={running}>
              Clear
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className="btn"
            title={s.hint}
            disabled={running}
            onClick={() => runScenario(s)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Manual call */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Call a single tool
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <select
            className="field"
            value={selectedTool}
            onChange={(e) => {
              setSelectedTool(e.target.value);
              setArgsText("{}");
              setArgsError(null);
            }}
          >
            {agent.tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.annotations?.readOnlyHint ? " (read-only)" : ""}
              </option>
            ))}
          </select>

          {active ? (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {active.description}
            </p>
          ) : null}

          <textarea
            className="field font-mono text-xs"
            rows={3}
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            spellCheck={false}
            aria-label="Tool arguments as JSON"
          />
          {argsError ? (
            <p className="text-xs" style={{ color: "var(--color-risk-high)" }}>
              {argsError}
            </p>
          ) : null}

          <button className="btn btn-primary self-start" onClick={runManual} disabled={running}>
            Run
          </button>
        </div>
      </details>

      {running ? (
        <p className="mt-3 text-xs" style={{ color: "var(--color-risk-medium)" }}>
          Running — a proposal may be waiting for your decision in the rail.
        </p>
      ) : null}

      {transcript.length > 0 ? (
        <ol
          className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-lg p-3 text-xs"
          style={{ background: "var(--surface-sunken)" }}
        >
          {transcript.map((l) => (
            <li key={l.id}>
              {l.kind === "call" ? (
                <code className="font-mono" style={{ color: "var(--accent)" }}>
                  → {l.text}
                </code>
              ) : l.kind === "note" ? (
                <span className="font-semibold">{l.text}</span>
              ) : (
                <pre
                  className="whitespace-pre-wrap font-mono leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {l.text}
                </pre>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      <p className="mt-3 text-[0.6875rem]" style={{ color: "var(--text-muted)" }}>
        <Chip tone="neutral">{agent.tools.length} tools</Chip>{" "}
        <span className="ml-1">
          {agent.tools.filter((t) => t.annotations?.readOnlyHint).length} read freely ·{" "}
          {agent.tools.filter((t) => !t.annotations?.readOnlyHint).length} require a decision
        </span>
      </p>
    </section>
  );
}

/** Short one-line rendering of call arguments for the transcript. */
function compactArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  if (json === "{}") return "";
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}
