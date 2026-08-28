# Devpost form — every field, ready to paste

Edit at: https://devpost.com/software/tandem-ib6u78/edit

---

## The basics

**Project name**

    Tandem

**Elevator pitch** (200 char limit; this is 151)

    A restaurant back office where an AI agent reads everything and changes nothing alone. Every write is a costed proposal that blocks until a human decides.

**Thumbnail** — `docs/screenshots/03-proposal-card.png`

---

## Project details

**Story** — replace the whole field with `docs/DEVPOST_STORY.md`.

**Built With** (enter one at a time)

    webmcp
    typescript
    next.js
    react
    tailwindcss
    vitest
    playwright
    vercel
    javascript
    html
    css
    chrome
    ai-agents

**"Try it out" links** — live demo first, judges click the top one

    https://tandem-lac.vercel.app
    https://github.com/uzbmillioner-tech/tandem

---

## Project media

**Video Demo Link** — use the full watch URL, not the youtu.be short form

    https://www.youtube.com/watch?v=eQSvT2xH9wo

**Image gallery**, in this order, with captions:

| File | Caption |
|---|---|
| `03-proposal-card.png` | The approval card: what the agent asked for, and what the site computed it would cost. |
| `01-overview.png` | The manager's dashboard. The agent's read-only tools answer from exactly this data. |
| `02-proposal.png` | The write tool has not returned — it is blocked, waiting on the decision in the rail. |
| `04-audit.png` | Every proposal and decision, attributed. Nothing changes without a line here. |

Download them from:
https://github.com/uzbmillioner-tech/tandem/tree/main/docs/screenshots

---

## Additional info (judges and organizers only)

| Field | Answer |
|---|---|
| Submitter Type | Individual |
| Country of residence | Uzbekistan |
| Organization name | *(leave blank)* |
| App Status | New |
| If Existing, explain | *(leave blank — the project is new)* |
| Which AI tools did you leverage | Claude Code (Claude Opus 5) |
| Level of learning | highest option — WebMCP was new to me at the start of this challenge |
| AI value for your career | Yes |

**Live URL that judges can access**

    https://tandem-lac.vercel.app

**URL to your PUBLIC code repo**

    https://github.com/uzbmillioner-tech/tandem

**Which agent(s) or client(s) did you test your WebMCP tools with?**

    Google Chrome with chrome://flags/#enable-webmcp-testing enabled — all 17 tools
    registered successfully via document.modelContext and are visible to the browser.

**Testing instructions for judges**

    No login, no account, no backend — the live URL works immediately.

    To see the WebMCP tools: open in Chrome with chrome://flags/#enable-webmcp-testing
    enabled, or in the ChatGPT desktop app's built-in browser. The rail at the right
    reports how many tools registered.

    If WebMCP is unavailable in your browser, the "Agent console" on the page drives
    the SAME registered tool objects — including the blocking, so a proposal raised
    there waits for your decision exactly as a real agent's would. Five scripted runs
    cover the whole flow; try "Fix the shortage", then "Log some waste".

    "Reset demo" in the header restores the dataset at any point.

---

## Last step, and the one that actually matters

Scroll to the bottom and **submit the project to The WebMCP Challenge**.

A project can be saved, public, and complete while still not being entered — and
an unsubmitted project is never seen by a judge. After submitting, the hackathon
name appears at the top of the project page and it leaves "in progress" in your
portfolio. Verify both.

Deadline: **3 September 2026, 1:00pm PDT** (4 September, 01:00 Tashkent).
