"use client";

/**
 * The approval card — the moment the whole app exists for.
 *
 * An agent has asked to change something. This card is the site's answer to a
 * question the agent cannot answer for itself: *what would that actually cost?*
 * Everything on it is computed from live recipes, stock, seven days of orders
 * and supplier terms.
 *
 * The decision is never pre-selected and the buttons carry no default focus, so
 * a stray keystroke cannot approve money leaving the business.
 */

import { useState } from "react";

import { formatCents, formatCentsDelta, formatPercent } from "@/lib/money";
import { useStore } from "@/lib/store";
import type { Proposal, ProposalKind } from "@/lib/types";
import { ArrowIcon, Chip, RiskBadge, WarningIcon } from "./ui";

const KIND_LABELS: Record<ProposalKind, string> = {
  price_change: "Price change",
  eighty_six: "Menu availability",
  restock: "Stock correction",
  purchase_order: "Purchase order",
  refund: "Refund",
  shift_change: "Shift change",
};

/** Standing approvals are offered only where a mistake stays small and reversible. */
const STANDING_ELIGIBLE: ProposalKind[] = ["restock", "eighty_six", "shift_change"];

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { decide, grantStanding, state } = useStore();
  const [note, setNote] = useState("");
  const [offerStanding, setOfferStanding] = useState(false);

  const b = proposal.blastRadius;
  const branchNames = b.branchIds
    .map((id) => state.branches.find((x) => x.id === id)?.name ?? id)
    .join(", ");

  const canOfferStanding =
    STANDING_ELIGIBLE.includes(proposal.kind) && proposal.risk !== "high";

  function approve() {
    if (offerStanding) {
      grantStanding({
        kind: proposal.kind,
        // Anything of this size or smaller passes without asking again.
        maxCashImpactCents: Math.max(2_000, Math.abs(b.cashDeltaCents)),
        maxRisk: proposal.risk,
        usesRemaining: 5,
      });
    }
    decide(proposal.id, "approved", note.trim() || undefined);
  }

  return (
    <article
      className="panel animate-proposal-in overflow-hidden"
      aria-label={`Proposal: ${proposal.title}`}
    >
      <header
        className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-sunken)" }}
      >
        <Chip tone="accent">{KIND_LABELS[proposal.kind]}</Chip>
        <RiskBadge risk={proposal.risk} />
        <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
          {branchNames}
        </span>
      </header>

      <div className="px-4 py-3">
        <h3 className="text-sm font-semibold">{proposal.title}</h3>

        {proposal.rationale ? (
          <blockquote
            className="mt-2 border-l-2 pl-3 text-sm italic"
            style={{ borderColor: "var(--accent)", color: "var(--text-secondary)" }}
          >
            {proposal.rationale}
          </blockquote>
        ) : null}

        {/* What changes. Stacked rather than tabular: this card lives in a
            narrow rail, and a five-column before/after table clips exactly the
            value the reader needs. */}
        <ul
          className="mt-3 divide-y rounded-lg border"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {proposal.changes.map((c, i) => (
            <li key={`${c.subject}-${c.field}-${i}`} className="px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-medium">{c.subject}</span>
                <span className="text-[0.6875rem]" style={{ color: "var(--text-muted)" }}>
                  {c.field}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="tnum" style={{ color: "var(--text-secondary)" }}>
                  {c.before}
                </span>
                <ArrowIcon className="size-3 shrink-0" />
                <span className="tnum font-semibold">{c.after}</span>
              </div>
            </li>
          ))}
        </ul>

        {/* What it costs — the part the agent could not have known */}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Metric
            label="Cash movement"
            value={b.cashDeltaCents === 0 ? "None" : formatCentsDelta(b.cashDeltaCents)}
            tone={b.cashDeltaCents < 0 ? "bad" : "neutral"}
          />
          <Metric
            label="Weekly margin"
            value={
              b.weeklyMarginDeltaCents === 0 ? "No change" : formatCentsDelta(b.weeklyMarginDeltaCents)
            }
            tone={b.weeklyMarginDeltaCents < 0 ? "bad" : b.weeklyMarginDeltaCents > 0 ? "good" : "neutral"}
          />
          <Metric label="Orders touched" value={`${b.ordersAffectedLast7d} / wk`} />
          <Metric label="Revenue share" value={formatPercent(b.revenueShare, 1)} />
        </dl>

        {b.warnings.length > 0 ? (
          <ul
            className="mt-3 space-y-1.5 rounded-lg px-3 py-2.5 text-xs"
            style={{ background: "var(--color-risk-high-soft)", color: "var(--color-risk-high)" }}
          >
            {b.warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <WarningIcon className="mt-px size-3.5 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Decision */}
      <div
        className="border-t px-4 py-3"
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-sunken)" }}
      >
        <label className="sr-only" htmlFor={`note-${proposal.id}`}>
          Note back to the agent
        </label>
        <input
          id={`note-${proposal.id}`}
          className="field"
          placeholder="Optional — tell the agent why (it sees this)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {canOfferStanding ? (
          <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={offerStanding}
              onChange={(e) => setOfferStanding(e.target.checked)}
            />
            <span style={{ color: "var(--text-secondary)" }}>
              Stop asking for {KIND_LABELS[proposal.kind].toLowerCase()}s this size — next 5 times,
              up to {formatCents(Math.max(2_000, Math.abs(b.cashDeltaCents)))}. Revocable at any
              time.
            </span>
          </label>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={approve}>
            Approve
          </button>
          <button
            className="btn btn-danger"
            onClick={() => decide(proposal.id, "rejected", note.trim() || undefined)}
          >
            Reject
          </button>
          <span className="ml-auto self-center text-xs" style={{ color: "var(--text-muted)" }}>
            The agent is waiting on this call.
          </span>
        </div>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const colors = {
    neutral: "var(--text-primary)",
    good: "var(--color-risk-low)",
    bad: "var(--color-risk-high)",
  };
  return (
    <div>
      <dt
        className="text-[0.625rem] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </dt>
      <dd className="tnum text-sm font-semibold" style={{ color: colors[tone] }}>
        {value}
      </dd>
    </div>
  );
}
