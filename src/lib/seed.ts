/**
 * Deterministic seed data for the Tandem demo.
 *
 * The dataset is generated from a fixed PRNG seed so every judge, on every
 * machine, sees the same numbers — but it is anchored to the current date so
 * "last 7 days" always means the 7 days before now.
 */

import type {
  AppState,
  Branch,
  Ingredient,
  MenuItem,
  Order,
  OrderChannel,
  OrderLine,
  Shift,
  StaffRole,
  StockLevel,
  Supplier,
} from "./types";

/** mulberry32 — small, fast, deterministic PRNG. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

function intBetween(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export const BRANCHES: Branch[] = [
  { id: "downtown", name: "Downtown", city: "Portland", seats: 64, openNow: true },
  { id: "riverside", name: "Riverside", city: "Portland", seats: 48, openNow: true },
  { id: "airport", name: "Airport", city: "Portland", seats: 32, openNow: true },
];

export const SUPPLIERS: Supplier[] = [
  { id: "sup_meats", name: "Cascade Meats", leadTimeDays: 1, minimumOrderCents: 20_000 },
  { id: "sup_produce", name: "Valley Produce Co.", leadTimeDays: 1, minimumOrderCents: 10_000 },
  { id: "sup_dry", name: "Northwest Dry Goods", leadTimeDays: 3, minimumOrderCents: 15_000 },
];

/**
 * Wholesale costs, set so the chain runs at a food cost in the high twenties as
 * a share of revenue — the band a real casual-dining operator would recognise.
 * `seed.test.ts` pins that so a future tweak to a price or a recipe cannot
 * quietly turn the demo into a business nobody would believe.
 */
export const INGREDIENTS: Ingredient[] = [
  { id: "lamb", name: "Lamb shoulder", unit: "kg", costPerUnitCents: 2_900, supplierId: "sup_meats" },
  { id: "beef", name: "Beef chuck", unit: "kg", costPerUnitCents: 2_350, supplierId: "sup_meats" },
  { id: "chicken", name: "Chicken thigh", unit: "kg", costPerUnitCents: 1_400, supplierId: "sup_meats" },
  { id: "rice", name: "Long-grain rice", unit: "kg", costPerUnitCents: 430, supplierId: "sup_dry" },
  { id: "carrot", name: "Carrots", unit: "kg", costPerUnitCents: 280, supplierId: "sup_produce" },
  { id: "onion", name: "Onions", unit: "kg", costPerUnitCents: 215, supplierId: "sup_produce" },
  { id: "flour", name: "Flour", unit: "kg", costPerUnitCents: 240, supplierId: "sup_dry" },
  { id: "oil", name: "Sunflower oil", unit: "l", costPerUnitCents: 690, supplierId: "sup_dry" },
  { id: "yogurt", name: "Yogurt", unit: "l", costPerUnitCents: 600, supplierId: "sup_produce" },
  { id: "greens", name: "Fresh herbs", unit: "kg", costPerUnitCents: 1_800, supplierId: "sup_produce" },
  { id: "tea", name: "Green tea", unit: "kg", costPerUnitCents: 5_000, supplierId: "sup_dry" },
  { id: "sugar", name: "Sugar", unit: "kg", costPerUnitCents: 240, supplierId: "sup_dry" },
];

export const MENU: MenuItem[] = [
  {
    id: "plov_lamb",
    name: "Lamb Plov",
    category: "mains",
    priceCents: 1_650,
    priceOverrides: { airport: 1_850 },
    recipe: [
      { ingredientId: "lamb", qty: 0.18 },
      { ingredientId: "rice", qty: 0.15 },
      { ingredientId: "carrot", qty: 0.09 },
      { ingredientId: "onion", qty: 0.04 },
      { ingredientId: "oil", qty: 0.03 },
    ],
    eightySixedAt: [],
    prepMinutes: 14,
  },
  {
    id: "plov_beef",
    name: "Beef Plov",
    category: "mains",
    priceCents: 1_450,
    priceOverrides: {},
    recipe: [
      { ingredientId: "beef", qty: 0.17 },
      { ingredientId: "rice", qty: 0.15 },
      { ingredientId: "carrot", qty: 0.09 },
      { ingredientId: "onion", qty: 0.04 },
      { ingredientId: "oil", qty: 0.03 },
    ],
    eightySixedAt: [],
    prepMinutes: 14,
  },
  {
    id: "kebab_chicken",
    name: "Chicken Kebab",
    category: "mains",
    priceCents: 1_200,
    priceOverrides: {},
    recipe: [
      { ingredientId: "chicken", qty: 0.22 },
      { ingredientId: "onion", qty: 0.03 },
      { ingredientId: "greens", qty: 0.01 },
    ],
    eightySixedAt: [],
    prepMinutes: 11,
  },
  {
    id: "kebab_lamb",
    name: "Lamb Kebab",
    category: "mains",
    priceCents: 1_750,
    priceOverrides: {},
    recipe: [
      { ingredientId: "lamb", qty: 0.2 },
      { ingredientId: "onion", qty: 0.03 },
      { ingredientId: "greens", qty: 0.01 },
    ],
    eightySixedAt: [],
    prepMinutes: 13,
  },
  {
    id: "samsa",
    name: "Beef Samsa",
    category: "mains",
    priceCents: 550,
    priceOverrides: {},
    recipe: [
      { ingredientId: "beef", qty: 0.07 },
      { ingredientId: "flour", qty: 0.09 },
      { ingredientId: "onion", qty: 0.03 },
      { ingredientId: "oil", qty: 0.01 },
    ],
    eightySixedAt: [],
    prepMinutes: 8,
  },
  {
    id: "lagman",
    name: "Lagman Noodles",
    category: "mains",
    priceCents: 1_350,
    priceOverrides: {},
    recipe: [
      { ingredientId: "beef", qty: 0.12 },
      { ingredientId: "flour", qty: 0.11 },
      { ingredientId: "carrot", qty: 0.05 },
      { ingredientId: "onion", qty: 0.04 },
      { ingredientId: "greens", qty: 0.01 },
    ],
    eightySixedAt: [],
    prepMinutes: 16,
  },
  {
    id: "salad_achichuk",
    name: "Achichuk Salad",
    category: "sides",
    priceCents: 480,
    priceOverrides: {},
    recipe: [
      { ingredientId: "onion", qty: 0.06 },
      { ingredientId: "greens", qty: 0.02 },
    ],
    eightySixedAt: [],
    prepMinutes: 4,
  },
  {
    id: "bread",
    name: "Tandoor Bread",
    category: "sides",
    priceCents: 300,
    priceOverrides: {},
    recipe: [
      { ingredientId: "flour", qty: 0.12 },
      { ingredientId: "oil", qty: 0.01 },
    ],
    eightySixedAt: [],
    prepMinutes: 6,
  },
  {
    id: "yogurt_side",
    name: "Herbed Yogurt",
    category: "sides",
    priceCents: 350,
    priceOverrides: {},
    recipe: [
      { ingredientId: "yogurt", qty: 0.15 },
      { ingredientId: "greens", qty: 0.01 },
    ],
    eightySixedAt: [],
    prepMinutes: 3,
  },
  {
    id: "tea_pot",
    name: "Pot of Green Tea",
    category: "drinks",
    priceCents: 400,
    priceOverrides: {},
    recipe: [
      { ingredientId: "tea", qty: 0.008 },
      { ingredientId: "sugar", qty: 0.02 },
    ],
    eightySixedAt: [],
    prepMinutes: 3,
  },
  {
    id: "ayran",
    name: "Ayran",
    category: "drinks",
    priceCents: 320,
    priceOverrides: {},
    recipe: [{ ingredientId: "yogurt", qty: 0.25 }],
    eightySixedAt: [],
    prepMinutes: 2,
  },
  {
    id: "halva",
    name: "Sesame Halva",
    category: "desserts",
    priceCents: 450,
    priceOverrides: {},
    recipe: [
      { ingredientId: "sugar", qty: 0.06 },
      { ingredientId: "flour", qty: 0.03 },
      { ingredientId: "oil", qty: 0.02 },
    ],
    eightySixedAt: [],
    prepMinutes: 2,
  },
];

const STAFF: { name: string; role: StaffRole }[] = [
  { name: "Dilnoza R.", role: "manager" },
  { name: "Marcus T.", role: "chef" },
  { name: "Aziza K.", role: "chef" },
  { name: "Sam O.", role: "server" },
  { name: "Priya N.", role: "server" },
  { name: "Jonas W.", role: "server" },
  { name: "Elena V.", role: "courier" },
  { name: "Tom B.", role: "courier" },
];

const CHANNELS: OrderChannel[] = ["dine_in", "dine_in", "takeaway", "delivery"];

/**
 * Relative demand weight per menu item. Mains carry the revenue; sides and
 * drinks attach to them. Kept explicit so the analytics in the UI are stable
 * and explainable rather than noise.
 */
const DEMAND: Record<string, number> = {
  plov_lamb: 22,
  plov_beef: 16,
  kebab_chicken: 14,
  kebab_lamb: 9,
  samsa: 18,
  lagman: 11,
  salad_achichuk: 12,
  bread: 20,
  yogurt_side: 7,
  tea_pot: 17,
  ayran: 9,
  halva: 6,
};

/** Branch traffic multipliers — Downtown is the flagship. */
const BRANCH_WEIGHT: Record<string, number> = {
  downtown: 1.0,
  riverside: 0.72,
  airport: 0.55,
};

function weightedItem(rng: () => number): string {
  const entries = Object.entries(DEMAND);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [id, w] of entries) {
    roll -= w;
    if (roll <= 0) return id;
  }
  return entries[0][0];
}

function priceFor(item: MenuItem, branchId: string): number {
  return item.priceOverrides[branchId] ?? item.priceCents;
}

/** Builds 7 days of order history ending at `now`. */
function buildOrders(now: Date, rng: () => number): Order[] {
  const orders: Order[] = [];
  const menuById = new Map(MENU.map((m) => [m.id, m]));
  let n = 0;

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const day = new Date(now);
    day.setDate(day.getDate() - dayOffset);
    const weekday = day.getDay();
    // Fri/Sat run hot, Mon/Tue run cold.
    const dayFactor = weekday === 5 || weekday === 6 ? 1.3 : weekday === 1 || weekday === 2 ? 0.82 : 1.0;

    for (const branch of BRANCHES) {
      const base = 34 * BRANCH_WEIGHT[branch.id] * dayFactor;
      const count = Math.round(base * (0.9 + rng() * 0.2));

      for (let i = 0; i < count; i++) {
        // Service peaks at lunch (12) and dinner (19).
        const peak = rng() < 0.45 ? 12 : 19;
        const hour = Math.min(22, Math.max(10, peak + intBetween(rng, -2, 2)));
        const placed = new Date(day);
        placed.setHours(hour, intBetween(rng, 0, 59), 0, 0);

        // Today's later orders haven't happened yet.
        if (placed.getTime() > now.getTime()) continue;

        const lineCount = intBetween(rng, 1, 3);
        const lines: OrderLine[] = [];
        const seen = new Set<string>();
        for (let j = 0; j < lineCount; j++) {
          const itemId = weightedItem(rng);
          if (seen.has(itemId)) continue;
          seen.add(itemId);
          const item = menuById.get(itemId);
          if (!item) continue;
          lines.push({
            itemId,
            qty: intBetween(rng, 1, 2),
            unitPriceCents: priceFor(item, branch.id),
          });
        }
        if (lines.length === 0) continue;

        const isToday = dayOffset === 0;
        const minutesOld = (now.getTime() - placed.getTime()) / 60_000;
        let status: Order["status"] = "completed";
        if (isToday && minutesOld < 12) status = "placed";
        else if (isToday && minutesOld < 25) status = "preparing";
        else if (isToday && minutesOld < 45) status = "delivering";

        orders.push({
          id: `ord_${String(++n).padStart(5, "0")}`,
          branchId: branch.id,
          lines,
          status,
          channel: pick(rng, CHANNELS),
          placedAt: placed.toISOString(),
        });
      }
    }
  }

  return orders.sort((a, b) => a.placedAt.localeCompare(b.placedAt));
}

/** Days of stock a branch aims to hold. Deliveries run every couple of days. */
const PAR_DAYS = 5;

/**
 * Average daily consumption of each ingredient at each branch, read off the
 * generated order history through the recipes those orders consumed.
 */
function dailyUsage(orders: Order[]): Map<string, number> {
  const menuById = new Map(MENU.map((m) => [m.id, m]));
  const totals = new Map<string, number>();

  for (const order of orders) {
    for (const line of order.lines) {
      const item = menuById.get(line.itemId);
      if (!item) continue;
      for (const r of item.recipe) {
        const key = `${order.branchId}/${r.ingredientId}`;
        totals.set(key, (totals.get(key) ?? 0) + r.qty * line.qty);
      }
    }
  }

  for (const [key, total] of totals) totals.set(key, total / 7);
  return totals;
}

/**
 * Sets opening stock so the demo starts with real, discoverable problems.
 *
 * Par levels are derived from what each branch actually consumes rather than
 * being a flat number, so "below par" means something: eight grams of tea per
 * pot and two hundred grams of lamb per plate should not share a threshold.
 *
 * Three shortages are scripted, worst first: Downtown is hours from running out
 * of lamb — which silently threatens its two highest-margin dishes — while
 * Riverside and Airport are merely low. Everything else opens at or above par.
 */
function buildStock(rng: () => number, orders: Order[]): StockLevel[] {
  const usage = dailyUsage(orders);
  const levels: StockLevel[] = [];

  const scripted: Record<string, number> = {
    "downtown/lamb": 2.1,
    "riverside/yogurt": 1.8,
    "airport/flour": 3.4,
  };

  for (const branch of BRANCHES) {
    for (const ing of INGREDIENTS) {
      const key = `${branch.id}/${ing.id}`;
      const perDay = usage.get(key) ?? 0;

      // An ingredient the branch barely touches still needs a floor, or par
      // rounds to nothing and every delivery looks like an overstock.
      const par = Math.max(ing.unit === "unit" ? 10 : 1, Math.round(perDay * PAR_DAYS * 10) / 10);
      const qty = scripted[key] ?? Math.round(par * (1 + rng() * 1.4) * 10) / 10;

      levels.push({ branchId: branch.id, ingredientId: ing.id, qty, parLevel: par });
    }
  }

  return levels;
}

/** Today's roster. Riverside is deliberately one server short at dinner. */
function buildShifts(now: Date, rng: () => number): Shift[] {
  const shifts: Shift[] = [];
  let n = 0;

  for (const branch of BRANCHES) {
    const headcount = branch.id === "downtown" ? 5 : branch.id === "riverside" ? 3 : 3;
    for (let i = 0; i < headcount; i++) {
      const person = STAFF[(i + (branch.id === "downtown" ? 0 : branch.id === "riverside" ? 3 : 5)) % STAFF.length];
      const startHour = i % 2 === 0 ? 10 : 15;
      const start = new Date(now);
      start.setHours(startHour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(startHour + 8, 0, 0, 0);

      shifts.push({
        id: `shift_${String(++n).padStart(3, "0")}`,
        branchId: branch.id,
        staffName: person.name,
        role: person.role,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }

  // Keep the rng consumed consistently even if headcounts change later.
  rng();
  return shifts;
}

export function createSeedState(now: Date = new Date()): AppState {
  const rng = makeRng(0x7a11de3);

  // Orders come first: par levels and opening stock are derived from the trade
  // they represent, so the shortages the agent finds are real consequences of
  // this week's business rather than numbers picked to look alarming.
  const orders = buildOrders(now, rng);

  return {
    branches: BRANCHES.map((b) => ({ ...b })),
    menu: MENU.map((m) => ({ ...m, priceOverrides: { ...m.priceOverrides }, eightySixedAt: [] })),
    ingredients: INGREDIENTS.map((i) => ({ ...i })),
    suppliers: SUPPLIERS.map((s) => ({ ...s })),
    stock: buildStock(rng, orders),
    orders,
    shifts: buildShifts(now, rng),
    proposals: [],
    standingApprovals: [],
    audit: [],
    view: "overview",
    focusedBranchId: null,
    highlightedId: null,
  };
}
