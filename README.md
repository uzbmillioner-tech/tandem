# Tandem

**The back office you run with your agent.**

A multi-branch restaurant back office where an AI agent can read everything and
change nothing on its own. Every write is a costed proposal that waits for a
human decision.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

---

## The idea

Most agent integrations answer the wrong question. They ask *"can the agent do
this?"* — and the answer, with a good enough API, is usually yes. The question a
business actually cares about is *"should it, and what does it cost?"*

An agent asked to raise the price of a dish knows the dish and the number. It
does not know that the dish is 31% of that branch's revenue, that a 20% rise
projects out to eleven fewer covers a week, or that the branch has enough lamb
for eighteen more hours. **The site knows all of that.** So in Tandem, the site
owns the confirmation.

That inversion is the whole design:

| | |
|---|---|
| **Read tools** | Annotated `readOnlyHint`. The agent calls them as freely as it likes. |
| **Write tools** | Never write. Each builds a fully-costed *proposal*, puts it on the manager's screen, and **the tool call blocks** until a human decides. |

What comes back to the agent is not a success code it wrote for itself. It is
the manager's decision, in the manager's words:

```
REJECTED by the manager — "Refund $66.00 on ord_00454" was NOT applied. Nothing changed.
Their reason: Refund policy is 50% after 24h.
Do not retry the same change. Ask what they would prefer, or propose a different option.
```

## What the manager sees

When a tool proposes something, an approval card appears with numbers the agent
could not have produced:

- **What changes** — every field, before and after.
- **Cash movement** — money actually leaving the business.
- **Weekly margin effect** — projected through a stated demand elasticity
  (`-0.6`, a single visible constant, not a hidden model).
- **Blast radius** — orders touched last week, share of branch revenue.
- **Warnings the page computed** — "Lamb shoulder has 18h of cover left but
  Cascade Meats takes 1 day to deliver — the branch runs out before this
  arrives."

Nothing is pre-selected and no button holds default focus, so a stray keystroke
cannot move money.

## The trust ladder

Confirming every trivial action is worse than having no agent at all. On
low-stakes proposals the manager can grant a **standing approval**: narrow
(one kind of change), bounded (a cash ceiling and a risk ceiling), finite (a use
count), and revocable from the rail at any time. Anything outside those bounds
falls back to a human decision.

Auto-approved changes are still written to the audit log, attributed, and
reversible — the ladder buys quiet, not opacity.

## Tools

Eighteen tools, registered on the top-level document.

**Read** (`readOnlyHint: true`)
`get_business_snapshot` · `list_branches` · `list_menu` · `list_stock_alerts` ·
`list_orders` · `analyze_item_performance` · `list_shifts` · `list_suppliers` ·
`list_proposals` · `get_audit_log`

**Steer the human's view**
`show_section` — switches the section the manager is looking at, focuses a
branch, highlights a row. So "this is the item I mean" points at something real.

**Propose** (blocks on a human decision)
`propose_price_change` · `propose_menu_availability` · `propose_stock_correction` ·
`propose_purchase_order` · `propose_refund` · `propose_shift_change`

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 86 tests over the money logic
npm run build
```

### Connecting an agent

WebMCP is still shipping. Either:

- **Chrome** — enable `chrome://flags/#enable-webmcp-testing` and relaunch, or
- **ChatGPT desktop app** — open the page in its built-in browser.

The rail tells you which state you are in. **If neither is available, the
in-page Agent Console drives the same registered tool objects**, so the whole
handshake is demonstrable in any browser — including the blocking behaviour,
because a proposal raised from the console waits for your decision exactly as a
real one does.

Four scripted runs are included: a read-only morning check, a stock shortage
that ends in a purchase order, a repricing, and a customer complaint that ends
in a refund request.

## Notes on the WebMCP implementation

- **`document.modelContext`**, not `navigator.modelContext` — the latter was
  deprecated in Chromium 150. The old name is read only as a fallback, and the
  UI says so when it is being used.
- **Imperative API only.** The declarative `<form toolname>` variant is not
  supported in ChatGPT's browser, so every tool is registered in JavaScript.
- **Top-level document only.** Tools inside an iframe are not discoverable, and
  a route change would tear the tool set down underneath an agent
  mid-conversation. Tandem is therefore a single page that switches sections in
  client state, so the tool surface is stable for the life of the tab.
- **Registration is stable.** Tools are built once, outside React, and resolve
  application state at call time — the agent never sees the list churn.
- **Cancellation is honoured.** The `AbortSignal` passed to `execute` settles a
  waiting proposal, so an agent that gives up does not leave a card stranded.
  Unanswered proposals lapse after five minutes rather than hanging forever.
- **Output discipline.** Chrome's guidance asks for results under ~1.5K
  characters; every list is capped and every response clipped.
- **No tool can crash the page.** Handlers are wrapped, and analytics functions
  are total — an unknown id returns a neutral value rather than throwing.

## How it is built

```
src/lib/
  types.ts        Domain model. Money is integer cents throughout.
  seed.ts         Deterministic dataset, anchored to the current clock.
  analytics.ts    The consequence engine — pure functions over state.
  proposals.ts    Builders, risk grading, standing approvals, application.
  store.tsx       Shared state, plus the pending-decision registry.
  webmcp/
    types.ts        Hand-written typings + feature detection.
    tools.ts        The eighteen tools.
    runtime.ts      Tool set built once, outside React.
    useAgentTools.ts / useTandemAgent.ts
src/components/   Shell, views, and the approval card.
```

Construction and application are deliberately separate functions. The numbers on
the card come from the same payload that is later applied, so what was approved
and what happens cannot drift.

### Tests

`npm test` covers the arithmetic a human approves on: margins, elasticity
projections, days of cover, supplier minimums, risk thresholds, standing-approval
bounds, and that a builder never mutates state. The dataset is pinned too — food
cost has to stay in a band a real operator would recognise, or the demo stops
being believable.

## Data

Everything is local. State lives in the browser (`localStorage`) and **Reset
demo** restores the seed. There is no backend and no account.

## Licence

MIT — see [LICENSE](./LICENSE).
