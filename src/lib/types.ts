/**
 * Domain model for Tandem — a multi-branch restaurant back office that a
 * manager and their AI agent operate together.
 *
 * All money is stored as integer cents. Never use floats for money.
 */

export type BranchId = string;
export type ItemId = string;
export type IngredientId = string;
export type OrderId = string;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Branch {
  id: BranchId;
  name: string;
  city: string;
  /** Seats in the dining room; drives the covers-per-hour ceiling. */
  seats: number;
  openNow: boolean;
}

export type MenuCategory = "mains" | "sides" | "drinks" | "desserts";

/** How much of one ingredient a single portion of a menu item consumes. */
export interface RecipeLine {
  ingredientId: IngredientId;
  /** In the ingredient's own unit. */
  qty: number;
}

export interface MenuItem {
  id: ItemId;
  name: string;
  category: MenuCategory;
  /** Menu price, in cents. Chain-wide unless overridden in `priceOverrides`. */
  priceCents: number;
  /** Per-branch price overrides, in cents. */
  priceOverrides: Partial<Record<BranchId, number>>;
  recipe: RecipeLine[];
  /** Branches where this item is currently 86'd (unavailable). */
  eightySixedAt: BranchId[];
  prepMinutes: number;
}

export type Unit = "kg" | "l" | "unit";

export interface Ingredient {
  id: IngredientId;
  name: string;
  unit: Unit;
  /** Purchase cost per unit, in cents. */
  costPerUnitCents: number;
  supplierId: string;
}

export interface Supplier {
  id: string;
  name: string;
  leadTimeDays: number;
  /** Minimum order value, in cents. Orders below this are rejected. */
  minimumOrderCents: number;
}

/** Live stock of one ingredient at one branch. */
export interface StockLevel {
  branchId: BranchId;
  ingredientId: IngredientId;
  qty: number;
  /** Reorder threshold — below this the branch risks running out. */
  parLevel: number;
}

export type OrderStatus = "placed" | "preparing" | "delivering" | "completed" | "refunded";
export type OrderChannel = "dine_in" | "takeaway" | "delivery";

export interface OrderLine {
  itemId: ItemId;
  qty: number;
  /** Price actually charged per portion, in cents (may differ from today's menu price). */
  unitPriceCents: number;
}

export interface Order {
  id: OrderId;
  branchId: BranchId;
  lines: OrderLine[];
  status: OrderStatus;
  channel: OrderChannel;
  /** ISO timestamp. */
  placedAt: string;
  /** Set when status is `refunded`. */
  refundedCents?: number;
}

export type StaffRole = "chef" | "server" | "courier" | "manager";

export interface Shift {
  id: string;
  branchId: BranchId;
  staffName: string;
  role: StaffRole;
  /** ISO timestamp. */
  start: string;
  /** ISO timestamp. */
  end: string;
}

// ---------------------------------------------------------------------------
// Proposals — the core of Tandem.
//
// An agent never mutates the business directly. Every write tool produces a
// Proposal: a fully-costed description of what *would* change. The page shows
// it to the human with its blast radius, and only a human decision applies it.
// ---------------------------------------------------------------------------

export type ProposalKind =
  | "price_change"
  | "eighty_six"
  | "restock"
  | "purchase_order"
  | "refund"
  | "shift_change";

export type RiskLevel = "low" | "medium" | "high";

/** One concrete before/after change the proposal would apply. */
export interface Change {
  /** Human-readable subject, e.g. "Lamb Plov — Downtown". */
  subject: string;
  field: string;
  before: string;
  after: string;
}

/**
 * The consequences the *page* computes — the agent cannot know these, because
 * they depend on recipes, stock, order history and cash position.
 */
export interface BlastRadius {
  /** Branches the change touches. */
  branchIds: BranchId[];
  /** Immediate cash movement, in cents. Negative = money leaves the business. */
  cashDeltaCents: number;
  /** Projected change in weekly gross margin, in cents. */
  weeklyMarginDeltaCents: number;
  /** Orders in the last 7 days that would have been affected. */
  ordersAffectedLast7d: number;
  /** Share of last-7d revenue that flows through the affected items, 0..1. */
  revenueShare: number;
  /** Specific things that go wrong if this is approved. */
  warnings: string[];
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired" | "auto_approved";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  /** One-line summary for the card header. */
  title: string;
  /** Why the agent is asking for this, in the agent's own words. */
  rationale: string;
  changes: Change[];
  blastRadius: BlastRadius;
  risk: RiskLevel;
  status: ProposalStatus;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp; set once a human decides. */
  decidedAt?: string;
  /** Free-text note the human attached to their decision. */
  decisionNote?: string;
  /** Opaque payload used to apply the change on approval. */
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Standing approvals — the "trust ladder".
//
// Confirming every trivial action is worse than no agent at all. The human can
// grant narrow, revocable standing approvals so low-stakes work flows without
// interruption while anything above the ceiling still stops for a decision.
// ---------------------------------------------------------------------------

export interface StandingApproval {
  id: string;
  kind: ProposalKind;
  /** Auto-approve only while cash impact stays within this many cents. */
  maxCashImpactCents: number;
  /** Auto-approve only while risk is at or below this level. */
  maxRisk: RiskLevel;
  /** Remaining uses before the grant lapses. */
  usesRemaining: number;
  createdAt: string;
}

export type Actor = "agent" | "human";

export interface AuditEntry {
  id: string;
  at: string;
  actor: Actor;
  /** WebMCP tool name that produced this entry, when it came from a tool call. */
  tool?: string;
  summary: string;
  proposalId?: string;
  /** How a proposal resolved, when this entry records a decision. */
  decision?: ProposalStatus;
}

export type ViewId = "overview" | "menu" | "stock" | "orders" | "staff" | "audit";

export interface AppState {
  branches: Branch[];
  menu: MenuItem[];
  ingredients: Ingredient[];
  suppliers: Supplier[];
  stock: StockLevel[];
  orders: Order[];
  shifts: Shift[];
  proposals: Proposal[];
  standingApprovals: StandingApproval[];
  audit: AuditEntry[];
  /** Which section the UI is showing — agents can steer this so the human follows along. */
  view: ViewId;
  /** Branch filter, or null for the whole chain. */
  focusedBranchId: BranchId | null;
  /** Entity the agent asked the UI to highlight, so the human sees what it means. */
  highlightedId: string | null;
}
