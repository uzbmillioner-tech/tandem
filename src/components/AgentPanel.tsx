"use client";

/**
 * The agent rail: what the agent can do here, what it is asking for, and what
 * it has already done.
 *
 * Connection state is shown rather than hidden. A manager needs to know whether
 * the agent half of this app is live, and anyone opening the page in a browser
 * without WebMCP needs to be told why — and given the in-page console instead.
 */

import { formatCents } from "@/lib/money";
import { useStore } from "@/lib/store";
import type { TandemAgent } from "@/lib/webmcp/useTandemAgent";
import { ProposalCard } from "./ProposalCard";
import { BotIcon, Chip, EmptyState } from "./ui";

export function AgentPanel({ agent }: { agent: TandemAgent }) {
  const { state, revokeStanding } = useStore();
  const pending = state.proposals.filter((p) => p.status === "pending");

  return (
    <div className="flex flex-col gap-4">
      <ConnectionStatus agent={agent} />

      <section aria-label="Proposals awaiting your decision">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold">Waiting on you</h2>
          {pending.length > 0 ? <Chip tone="warn">{pending.length}</Chip> : null}
        </div>

        {pending.length === 0 ? (
          <EmptyState
            title="Nothing to decide"
            hint="When the agent wants to change something, it appears here with its full cost before anything happens."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
      </section>

      {state.standingApprovals.length > 0 ? (
        <section aria-label="Standing approvals">
          <h2 className="mb-2 text-sm font-semibold">Standing approvals</h2>
          <div className="panel divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {state.standingApprovals.map((g) => (
              <div key={g.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {g.kind.replace(/_/g, " ")} up to {formatCents(g.maxCashImpactCents)}
                  </p>
                  <p className="text-[0.6875rem]" style={{ color: "var(--text-secondary)" }}>
                    {g.usesRemaining} use{g.usesRemaining === 1 ? "" : "s"} left · max {g.maxRisk} risk
                  </p>
                </div>
                <button className="btn" onClick={() => revokeStanding(g.id)}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ActivityFeed agent={agent} />
    </div>
  );
}

function ConnectionStatus({ agent }: { agent: TandemAgent }) {
  const { support, registered, error } = agent.status;

  const connected = support === "supported" || support === "deprecated-api";

  return (
    <section className="panel px-3 py-2.5" aria-label="Agent connection">
      <div className="flex items-center gap-2">
        <BotIcon className="size-4" />
        <h2 className="text-sm font-semibold">Agent interface</h2>
        <span className="ml-auto">
          {connected ? (
            <Chip tone="good">{registered.length} tools live</Chip>
          ) : (
            <Chip tone="warn">Not connected</Chip>
          )}
        </span>
      </div>

      {error ? (
        <p className="mt-2 text-xs" style={{ color: "var(--color-risk-high)" }}>
          Registration failed: {error}
        </p>
      ) : null}

      {support === "deprecated-api" ? (
        <p className="mt-2 text-xs" style={{ color: "var(--color-risk-medium)" }}>
          Connected through the deprecated <code>navigator.modelContext</code>. This browser predates
          Chromium 150; everything works, but the API has since moved to{" "}
          <code>document.modelContext</code>.
        </p>
      ) : null}

      {!connected ? (
        <div className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <p>This browser does not expose WebMCP, so no agent can see the tools. To connect one:</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            <li>
              Chrome: enable <code>chrome://flags/#enable-webmcp-testing</code> and relaunch.
            </li>
            <li>Or open this page in the ChatGPT desktop app&rsquo;s built-in browser.</li>
          </ul>
          <p className="mt-1.5">
            You can still drive every tool yourself from the console below — it calls exactly the
            same code an agent would.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function ActivityFeed({ agent }: { agent: TandemAgent }) {
  return (
    <section aria-label="Tool activity">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Tool activity</h2>
        {agent.activity.length > 0 ? (
          <button className="btn ml-auto" onClick={agent.clearActivity}>
            Clear
          </button>
        ) : null}
      </div>

      {agent.activity.length === 0 ? (
        <EmptyState title="No calls yet" hint="Every tool call the agent makes is logged here as it happens." />
      ) : (
        <ol className="panel divide-y text-xs" style={{ borderColor: "var(--border-subtle)" }}>
          {agent.activity.map((call) => (
            <li key={call.id} className="px-3 py-2">
              <div className="flex items-baseline gap-2">
                <code className="font-mono text-[0.6875rem] font-semibold" style={{ color: "var(--accent)" }}>
                  {call.toolName}
                </code>
                <span className="ml-auto tnum text-[0.625rem]" style={{ color: "var(--text-muted)" }}>
                  {new Date(call.at).toLocaleTimeString()}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                {call.summary}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
