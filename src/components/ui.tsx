"use client";

/** Shared presentational primitives. No business logic lives here. */

import type { ReactNode } from "react";

import type { RiskLevel } from "@/lib/types";

const RISK_STYLES: Record<RiskLevel, { bg: string; fg: string; label: string }> = {
  low: { bg: "var(--color-risk-low-soft)", fg: "var(--color-risk-low)", label: "Low risk" },
  medium: {
    bg: "var(--color-risk-medium-soft)",
    fg: "var(--color-risk-medium)",
    label: "Medium risk",
  },
  high: { bg: "var(--color-risk-high-soft)", fg: "var(--color-risk-high)", label: "High risk" },
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const s = RISK_STYLES[risk];
  return (
    <span className="chip" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  plain = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad";
  /** Keeps the label as written. Use for values — "19h" must not become "19H". */
  plain?: boolean;
}) {
  const tones: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: "var(--surface-sunken)", fg: "var(--text-secondary)" },
    accent: { bg: "color-mix(in srgb, var(--accent) 16%, transparent)", fg: "var(--accent)" },
    good: { bg: "var(--color-risk-low-soft)", fg: "var(--color-risk-low)" },
    warn: { bg: "var(--color-risk-medium-soft)", fg: "var(--color-risk-medium)" },
    bad: { bg: "var(--color-risk-high-soft)", fg: "var(--color-risk-high)" },
  };
  const s = tones[tone];
  return (
    <span
      className="chip"
      style={{
        background: s.bg,
        color: s.fg,
        ...(plain ? { textTransform: "none" as const, letterSpacing: "normal" } : null),
      }}
    >
      {children}
    </span>
  );
}

/**
 * A single headline figure. `tone` colours only the value, never the label, so
 * a screen full of tiles still reads as one block.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const colors: Record<string, string> = {
    neutral: "var(--text-primary)",
    good: "var(--color-risk-low)",
    warn: "var(--color-risk-medium)",
    bad: "var(--color-risk-high)",
  };
  return (
    <div className="panel px-4 py-3">
      <div
        className="text-[0.6875rem] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div className="tnum mt-1 text-xl font-semibold" style={{ color: colors[tone] }}>
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      className="rounded-lg border border-dashed px-4 py-8 text-center"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <p className="text-sm font-medium">{title}</p>
      {hint ? (
        <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function WarningIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ArrowIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function BotIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1a.75.75 0 0 1 .75.75V3h2.5A2.75 2.75 0 0 1 16 5.75v6.5A2.75 2.75 0 0 1 13.25 15h-6.5A2.75 2.75 0 0 1 4 12.25v-6.5A2.75 2.75 0 0 1 6.75 3h2.5V1.75A.75.75 0 0 1 10 1ZM7.5 7.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM7 11.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" />
      <path d="M2.75 7.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3a.75.75 0 0 1 .75-.75Zm14.5 0a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3a.75.75 0 0 1 .75-.75Z" />
      <path d="M6.5 16.5a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75Z" />
    </svg>
  );
}
