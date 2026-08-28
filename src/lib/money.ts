/** Money formatting. All amounts crossing this boundary are integer cents. */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Whole dollars — for headline figures where cents are noise. */
export function formatCentsCompact(cents: number): string {
  return usdCompact.format(cents / 100);
}

/** Always carries an explicit sign, so a delta never reads as an absolute. */
export function formatCentsDelta(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${usd.format(Math.abs(cents) / 100)}`;
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Renders a days-of-cover figure, including the unbounded case. */
export function formatDays(days: number): string {
  if (!Number.isFinite(days)) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

export function formatQty(qty: number, unit: string): string {
  const rounded = Math.round(qty * 100) / 100;
  return `${rounded} ${unit}`;
}
