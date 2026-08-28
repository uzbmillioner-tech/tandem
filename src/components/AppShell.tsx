"use client";

/**
 * The application frame: navigation, branch focus, and the split between the
 * manager's workspace and the agent's rail.
 *
 * The rail is not a chat window. The agent's conversation happens wherever the
 * agent lives — this is the part of it that needs a human, pulled out and given
 * the numbers to decide on.
 */

import { useState } from "react";

import { useStore } from "@/lib/store";
import type { ViewId } from "@/lib/types";
import { useTandemAgent } from "@/lib/webmcp/useTandemAgent";
import { AgentConsole } from "./AgentConsole";
import { AgentPanel } from "./AgentPanel";
import { AuditView, MenuView, OrdersView, OverviewView, StaffView, StockView } from "./views";
import { Chip } from "./ui";

const NAV: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "menu", label: "Menu" },
  { id: "stock", label: "Stock" },
  { id: "orders", label: "Orders" },
  { id: "staff", label: "Staff" },
  { id: "audit", label: "Audit" },
];

export function AppShell() {
  const { state, ready, setView, setFocus, reset } = useStore();
  const agent = useTandemAgent();
  const [confirmReset, setConfirmReset] = useState(false);

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Loading the shift…
        </p>
      </div>
    );
  }

  const pendingCount = state.proposals.filter((p) => p.status === "pending").length;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header
        className="sticky top-0 z-20 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-panel)" }}
      >
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight">Tandem</span>
            <span className="hidden text-xs sm:inline" style={{ color: "var(--text-secondary)" }}>
              the back office you run with your agent
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <label className="sr-only" htmlFor="branch-focus">
              Branch focus
            </label>
            <select
              id="branch-focus"
              className="field w-auto"
              value={state.focusedBranchId ?? ""}
              onChange={(e) => setFocus(e.target.value || null)}
            >
              <option value="">All branches</option>
              {state.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            {confirmReset ? (
              <>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    reset();
                    setConfirmReset(false);
                  }}
                >
                  Confirm reset
                </button>
                <button className="btn" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setConfirmReset(true)} title="Restore the demo data">
                Reset demo
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[110rem] flex-1 gap-4 px-4 py-4 lg:grid-cols-[9.5rem_minmax(0,1fr)_24rem]">
        {/* min-w-0 lets the scrolling tab strip below actually scroll: without it
            the row of buttons sets the grid column's min-content width and pushes
            the whole page sideways on a phone. */}
        <nav aria-label="Sections" className="min-w-0">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {NAV.map((item) => {
              const active = state.view === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setView(item.id)}
                    aria-current={active ? "page" : undefined}
                    className="w-full whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm font-medium transition-colors"
                    style={{
                      background: active ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent",
                      color: active ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0">
          {state.view === "overview" ? <OverviewView /> : null}
          {state.view === "menu" ? <MenuView /> : null}
          {state.view === "stock" ? <StockView /> : null}
          {state.view === "orders" ? <OrdersView /> : null}
          {state.view === "staff" ? <StaffView /> : null}
          {state.view === "audit" ? <AuditView /> : null}

          <div className="mt-5">
            <AgentConsole agent={agent} />
          </div>
        </main>

        <aside aria-label="Agent" className="min-w-0">
          {pendingCount > 0 ? (
            <div className="mb-3 lg:hidden">
              <Chip tone="warn">
                {pendingCount} proposal{pendingCount === 1 ? "" : "s"} waiting below
              </Chip>
            </div>
          ) : null}
          <AgentPanel agent={agent} />
        </aside>
      </div>
    </div>
  );
}
