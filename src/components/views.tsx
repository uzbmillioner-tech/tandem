"use client";

/**
 * The six sections of the back office.
 *
 * Every one of these reads the same store the agent's tools read, so a change
 * the manager approves lands on screen in the same frame the tool call returns.
 * Rows carry stable ids because `show_section` lets the agent highlight one, so
 * a sentence like "this is the item I mean" points at something real.
 */

import {
  coverageGaps,
  daysOfCover,
  effectivePriceCents,
  findIngredient,
  findItem,
  lastNDays,
  marginCents,
  marginRatio,
  portionCostCents,
  portionMarginCents,
  portionsAvailable,
  revenueCents,
  stockAlerts,
  topItemsByRevenue,
} from "@/lib/analytics";
import { formatCents, formatDays, formatPercent, formatQty } from "@/lib/money";
import { useStore } from "@/lib/store";
import type { AppState, BranchId } from "@/lib/types";
import { Chip, EmptyState, SectionHeader, StatTile } from "./ui";

/** Branches currently in view — the focused one, or all of them. */
function scope(state: AppState): BranchId[] {
  return state.focusedBranchId ? [state.focusedBranchId] : state.branches.map((b) => b.id);
}

function branchName(state: AppState, id: BranchId): string {
  return state.branches.find((b) => b.id === id)?.name ?? id;
}

function highlightClass(state: AppState, id: string): string {
  return state.highlightedId === id ? "row-highlight" : "";
}

// ---------------------------------------------------------------------------

export function OverviewView() {
  const { state } = useStore();
  const ids = scope(state);
  const w = lastNDays(new Date(), 7);

  const revenue = revenueCents(state, w, ids);
  const margin = marginCents(state, w, ids);
  const alerts = stockAlerts(state, w, ids);
  const critical = alerts.filter((a) => a.severity === "critical");
  const pending = state.proposals.filter((p) => p.status === "pending");
  const offMenu = state.menu.filter((m) => m.eightySixedAt.some((b) => ids.includes(b)));
  const top = topItemsByRevenue(state, w, ids).slice(0, 6);

  return (
    <div>
      <SectionHeader
        title="Overview"
        description={`Last seven days across ${ids.length === 1 ? branchName(state, ids[0]) : "all branches"}.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Revenue" value={formatCents(revenue)} sub="last 7 days" />
        <StatTile
          label="Gross margin"
          value={formatCents(margin)}
          sub={formatPercent(revenue > 0 ? margin / revenue : 0)}
          tone="good"
        />
        <StatTile
          label="Below par"
          value={alerts.length}
          sub={`${critical.length} critical`}
          tone={critical.length > 0 ? "bad" : alerts.length > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Awaiting you"
          value={pending.length}
          sub={pending.length === 1 ? "proposal" : "proposals"}
          tone={pending.length > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Needs attention</h3>
          {alerts.length === 0 && offMenu.length === 0 ? (
            <EmptyState title="Nothing pressing" hint="Stock is at par and the full menu is on sale." />
          ) : (
            <ul className="panel divide-y text-sm" style={{ borderColor: "var(--border-subtle)" }}>
              {alerts.slice(0, 5).map((a) => {
                const ing = findIngredient(state, a.ingredientId);
                return (
                  <li key={`${a.branchId}-${a.ingredientId}`} className="flex items-center gap-2 px-3 py-2">
                    <Chip tone={a.severity === "critical" ? "bad" : "warn"} plain>
                      {formatDays(a.daysOfCover)}
                    </Chip>
                    <span className="min-w-0 flex-1 truncate">
                      {ing?.name ?? a.ingredientId} at {branchName(state, a.branchId)}
                    </span>
                    <span className="tnum text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatQty(a.qty, ing?.unit ?? "")} / {a.parLevel}
                    </span>
                  </li>
                );
              })}
              {offMenu.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <Chip tone="bad">Off menu</Chip>
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {m.eightySixedAt.map((b) => branchName(state, b)).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Top sellers</h3>
          <div className="panel table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Portions</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.itemId} className={highlightClass(state, r.itemId)}>
                    <td className="font-medium">{findItem(state, r.itemId)?.name ?? r.itemId}</td>
                    <td className="tnum">{r.units}</td>
                    <td className="tnum">{formatCents(r.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MenuView() {
  const { state } = useStore();
  const branchId = state.focusedBranchId ?? state.branches[0].id;

  return (
    <div>
      <SectionHeader
        title="Menu"
        description={`Prices, costs and what the kitchen can still make at ${branchName(state, branchId)}.`}
      />

      <div className="panel table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Price</th>
              <th>Cost</th>
              <th>Margin</th>
              <th>Makeable</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {state.menu.map((m) => {
              const off = m.eightySixedAt.includes(branchId);
              const canMake = portionsAvailable(state, m, branchId);
              const ratio = marginRatio(state, m, branchId);
              return (
                <tr key={m.id} className={highlightClass(state, m.id)}>
                  <td className="font-medium">{m.name}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{m.category}</td>
                  <td className="tnum">{formatCents(effectivePriceCents(m, branchId))}</td>
                  <td className="tnum" style={{ color: "var(--text-secondary)" }}>
                    {formatCents(portionCostCents(state, m))}
                  </td>
                  <td className="tnum">
                    {formatCents(portionMarginCents(state, m, branchId))}{" "}
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatPercent(ratio, 0)}
                    </span>
                  </td>
                  <td className="tnum">
                    {Number.isFinite(canMake) ? (
                      <span style={{ color: canMake < 10 ? "var(--color-risk-high)" : undefined }}>
                        {canMake}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{off ? <Chip tone="bad">Off menu</Chip> : <Chip tone="good">On sale</Chip>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StockView() {
  const { state } = useStore();
  const ids = scope(state);
  const w = lastNDays(new Date(), 7);

  const rows = state.stock
    .filter((s) => ids.includes(s.branchId))
    .map((s) => ({ ...s, cover: daysOfCover(state, s.ingredientId, s.branchId, w) }))
    .sort((a, b) => a.cover - b.cover);

  return (
    <div>
      <SectionHeader
        title="Stock"
        description="Days of cover come from what this branch actually sold, not from a flat assumption."
      />

      <div className="panel table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Branch</th>
              <th>On hand</th>
              <th>Par</th>
              <th>Cover</th>
              <th>Blocks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const ing = findIngredient(state, s.ingredientId);
              const blocked = state.menu
                .filter((m) => m.recipe.some((r) => r.ingredientId === s.ingredientId))
                .slice(0, 3)
                .map((m) => m.name)
                .join(", ");
              const short = s.qty < s.parLevel;

              return (
                <tr
                  key={`${s.branchId}-${s.ingredientId}`}
                  className={highlightClass(state, s.ingredientId)}
                >
                  <td className="font-medium">{ing?.name ?? s.ingredientId}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{branchName(state, s.branchId)}</td>
                  <td className="tnum" style={{ color: short ? "var(--color-risk-high)" : undefined }}>
                    {formatQty(s.qty, ing?.unit ?? "")}
                  </td>
                  <td className="tnum" style={{ color: "var(--text-secondary)" }}>
                    {s.parLevel}
                  </td>
                  <td className="tnum">
                    {s.cover < 1 ? (
                      <Chip tone="bad" plain>
                        {formatDays(s.cover)}
                      </Chip>
                    ) : s.cover < 3 ? (
                      <Chip tone="warn" plain>
                        {formatDays(s.cover)}
                      </Chip>
                    ) : (
                      formatDays(s.cover)
                    )}
                  </td>
                  <td className="max-w-56 truncate" style={{ color: "var(--text-secondary)" }}>
                    {blocked || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function OrdersView() {
  const { state } = useStore();
  const ids = scope(state);

  const rows = [...state.orders]
    .filter((o) => ids.includes(o.branchId))
    .reverse()
    .slice(0, 40);

  return (
    <div>
      <SectionHeader title="Orders" description="The forty most recent orders in scope." />

      <div className="panel table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Branch</th>
              <th>Placed</th>
              <th>Channel</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const total = o.lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
              const items = o.lines
                .map((l) => `${l.qty}× ${findItem(state, l.itemId)?.name ?? l.itemId}`)
                .join(", ");
              return (
                <tr key={o.id} className={highlightClass(state, o.id)}>
                  <td className="font-mono text-xs">{o.id}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{branchName(state, o.branchId)}</td>
                  <td className="tnum text-xs" style={{ color: "var(--text-secondary)" }}>
                    {new Date(o.placedAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>{o.channel.replace("_", " ")}</td>
                  <td className="max-w-64 truncate">{items}</td>
                  <td className="tnum font-medium">{formatCents(total)}</td>
                  <td>
                    {o.status === "refunded" ? (
                      <Chip tone="bad">refunded</Chip>
                    ) : o.status === "completed" ? (
                      <Chip tone="neutral">completed</Chip>
                    ) : (
                      <Chip tone="accent">{o.status}</Chip>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StaffView() {
  const { state } = useStore();
  const ids = scope(state);
  const w = lastNDays(new Date(), 7);

  return (
    <div>
      <SectionHeader
        title="Staff"
        description="Today's roster, with any hour where cover falls short of the branch's typical demand."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {ids.map((branchId) => {
          const roster = state.shifts.filter((s) => s.branchId === branchId);
          const gaps = coverageGaps(state, branchId, w);

          return (
            <section key={branchId} className="panel p-3">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{branchName(state, branchId)}</h3>
                {gaps.length === 0 ? (
                  <Chip tone="good">covered</Chip>
                ) : (
                  <Chip tone="warn">{gaps.length} short hour{gaps.length === 1 ? "" : "s"}</Chip>
                )}
              </div>

              <ul className="divide-y text-sm" style={{ borderColor: "var(--border-subtle)" }}>
                {roster.map((s) => (
                  <li
                    key={s.id}
                    className={`flex items-center gap-2 py-1.5 ${highlightClass(state, s.id)}`}
                  >
                    <span className="font-mono text-[0.6875rem]" style={{ color: "var(--text-muted)" }}>
                      {s.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{s.staffName}</span>
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {s.role}
                    </span>
                    <span className="tnum text-xs">
                      {new Date(s.start).getHours()}:00–{new Date(s.end).getHours()}:00
                    </span>
                  </li>
                ))}
              </ul>

              {gaps.length > 0 ? (
                <p className="mt-2 text-xs" style={{ color: "var(--color-risk-medium)" }}>
                  Short at{" "}
                  {gaps.map((g) => `${g.hour}:00 (${g.staffOnDuty} of ${g.staffNeeded})`).join(", ")}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AuditView() {
  const { state } = useStore();
  const decided = state.proposals.filter((p) => p.status !== "pending");

  return (
    <div>
      <SectionHeader
        title="Audit"
        description="Every proposal the agent raised and what happened to it. Nothing changes this business without a line here."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Decisions</h3>
          {decided.length === 0 ? (
            <EmptyState title="No decisions yet" hint="Approve or reject a proposal and it lands here." />
          ) : (
            <ul className="panel divide-y text-sm" style={{ borderColor: "var(--border-subtle)" }}>
              {decided.slice(0, 20).map((p) => (
                <li key={p.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Chip
                      tone={
                        p.status === "approved" || p.status === "auto_approved"
                          ? "good"
                          : p.status === "rejected"
                            ? "bad"
                            : "neutral"
                      }
                    >
                      {p.status.replace("_", " ")}
                    </Chip>
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  </div>
                  {p.decisionNote ? (
                    <p className="mt-1 text-xs italic" style={{ color: "var(--text-secondary)" }}>
                      “{p.decisionNote}”
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Activity log</h3>
          {state.audit.length === 0 ? (
            <EmptyState title="Nothing logged yet" />
          ) : (
            <ol className="panel divide-y text-xs" style={{ borderColor: "var(--border-subtle)" }}>
              {state.audit.slice(0, 30).map((e) => (
                <li key={e.id} className="flex gap-2 px-3 py-1.5">
                  <span className="tnum shrink-0" style={{ color: "var(--text-muted)" }}>
                    {new Date(e.at).toLocaleTimeString()}
                  </span>
                  <Chip tone={e.actor === "agent" ? "accent" : "neutral"}>{e.actor}</Chip>
                  <span className="min-w-0 flex-1">{e.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
