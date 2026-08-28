# Devpost submission draft

Copy into the Devpost form. Everything must be in English.

---

## Project name

Tandem

## Elevator pitch (200 chars max)

> A restaurant back office where an AI agent reads everything and changes
> nothing alone. Every write is a costed proposal that blocks until a human
> decides.

*(151 characters.)*

## Built with

`webmcp` `document.modelcontext` `typescript` `next.js` `react` `tailwindcss` `vitest` `vercel`

---

## About the project

### Inspiration

Most agent integrations answer the wrong question. They ask *"can the agent do
this?"* — and with a good enough API the answer is usually yes. The question a
business actually cares about is *"should it, and what does it cost?"*

I have spent the last year building operations software for a real restaurant
chain: three branches, live orders, real money. The thing that kept me from
letting an agent touch any of it was never capability. It was that a confirmation
dialog saying *"Change price to $16.50? [OK]"* asks a human to approve something
neither party has priced.

The agent knows the dish and the number. It does not know that the dish is 31% of
that branch's revenue, that a 20% rise projects out to eleven fewer covers a
week, or that the branch has enough lamb for eighteen more hours.

**The site knows all of that.** So the site should own the confirmation.

### What it does

Tandem is a back office for a three-branch restaurant chain, built so a manager
and their agent can run it together.

The tool surface is split down the middle:

- **Ten read tools**, annotated `readOnlyHint`. The agent calls them freely.
- **Six write tools that never write.** Each builds a fully-costed *proposal*,
  puts it on the manager's screen, and **the tool call blocks** — the promise
  stays unresolved until a human decides.

What returns to the agent is not a success code it wrote for itself. It is the
manager's decision, in the manager's words:

```
REJECTED by the manager — "Refund $66.00 on ord_00454" was NOT applied.
Nothing changed.
Their reason: Refund policy is 50% after 24h.
Do not retry the same change. Ask what they would prefer, or propose a
different option.
```

The approval card shows what the agent could not compute: cash actually leaving
the business, the weekly margin effect projected through a stated demand
elasticity, orders touched last week, share of branch revenue, and warnings the
page worked out for itself — *"Lamb shoulder has 18h of cover left but Cascade
Meats takes 1 day to deliver, so the branch runs out before this arrives."*

And because confirming every trivial action is worse than having no agent at
all, the manager can grant a **standing approval**: narrow to one kind of
change, bounded by a cash ceiling and a risk ceiling, limited to a use count,
revocable at any time — and still fully audited.

### How I built it

Next.js 16 and TypeScript, no backend. State lives in the browser, which means
the tools and the UI are provably reading the same data rather than two views
that can drift.

Tools are registered on `document.modelContext` — not `navigator.modelContext`,
which was deprecated in Chromium 150 and which most tutorials still show. The
imperative API only, since the declarative `<form toolname>` variant is not
supported in ChatGPT's browser. Everything is registered from the top-level
document, because tools inside an iframe are not discoverable, and a route
change would tear the tool set down underneath an agent mid-conversation — so
Tandem is one page that switches sections in client state.

The consequence engine is a set of pure functions over application state:
portion costs from recipes, days of cover from the ingredient draw of actual
sales, elasticity-adjusted margin projections, supplier lead times against run
rate. Proposal *construction* and proposal *application* are deliberately
separate functions sharing one payload, so what the manager approved and what
actually happens cannot drift apart.

86 tests cover the arithmetic a human approves on. The seed dataset is pinned
too: food cost has to stay in a band a real operator would recognise, or the
demo stops being believable.

### Challenges

**Making the block feel like a feature, not a hang.** A tool call that never
returns is a bug. One that returns the manager's reasoning is a conversation.
That meant honouring the agent's `AbortSignal`, lapsing unanswered proposals
after five minutes, and settling every waiting promise on unmount — a stranded
card is worse than a refusal.

**Registration stability.** Tools close over application state, but rebuilding
them on every render would make the tool list churn underneath a live agent. The
tool set is built once outside React and resolves state at call time.

**Demonstrability.** WebMCP is behind a flag in most browsers today. Rather than
ask people to take the agent half on faith, the page ships an in-page console
that drives *the same registered tool objects* — including the blocking, so a
proposal raised from the console waits for a decision exactly as a real one does.

### What I learned

WebMCP's real leverage is not that it saves an agent from clicking buttons. It
is that the site finally gets to participate in the decision. A REST endpoint
can only say yes or no. A WebMCP tool can say *"here is what that would cost,
ask your human."*

### What's next

Multi-party approval for changes above a threshold; learning standing-approval
ceilings from the decisions a manager has already made; and replacing the demo
dataset with the live chain this was designed for.

---

## Video script (target 2:30)

**0:00–0:20 — The problem.**
Screen: a generic confirm dialog reading "Change price to $16.50? OK / Cancel".
> "This is what approving an agent's action usually looks like. You're being
> asked to authorise something nobody has priced. Is that a good idea? The
> dialog doesn't know. Neither do you."

**0:20–0:45 — Tandem, reading.**
Screen: the dashboard. Run "Morning check" in the console.
> "Tandem is a back office for a restaurant chain. Ten read-only tools — the
> agent uses them freely, because reading changes nothing. It finds Downtown is
> nineteen hours from running out of lamb."

**0:45–1:35 — The handshake.**
Screen: run "Fix the shortage". The proposal card appears.
> "Now it wants to spend money. Watch the tool call — it hasn't returned. It's
> waiting. And the page has computed what the agent couldn't: five hundred and
> fifty-one dollars leaving the business, and a warning that delivery takes a
> day but the lamb runs out in eighteen hours. Ordering doesn't stop the
> stockout. That's the site's knowledge, not the model's."
Click Approve.
> "Now the tool returns — and the stock moves."

**1:35–2:05 — Rejection is a conversation.**
Screen: run "Handle a complaint", type a note, hit Reject.
> "Reject it, and tell it why. The agent gets your reason and is told not to
> retry the same thing. That's a colleague, not a retry loop."

**2:05–2:25 — The trust ladder.**
Screen: approve a small stock correction with the standing-approval box ticked.
> "Confirming everything is worse than no agent at all. So small, reversible
> changes can get a standing approval — one kind of change, one cash ceiling,
> five uses, revocable, and still in the audit log."

**2:25–2:40 — Close.**
Screen: the audit view.
> "Every change to this business has a line here saying who asked and who
> agreed. The agent got faster. Nobody gave up control."

---

## Testing notes for judges

- Live URL works in any browser. If WebMCP isn't available, the **Agent Console**
  on the page drives the same registered tools, blocking included.
- To connect a real agent: Chrome with `chrome://flags/#enable-webmcp-testing`,
  or the ChatGPT desktop app's built-in browser.
- **Reset demo** in the header restores the dataset at any point.
- No login, no account, no backend.
