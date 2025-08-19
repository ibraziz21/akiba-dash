// components/admin-round-row.tsx
"use client";

import { formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import type { CombinedRound } from "@/hooks/useAdminRounds";

type Props = {
  round: CombinedRound;
  onDraw: (id: number) => Promise<void>;
  drawing: boolean;
};

export default function AdminRoundRow({ round, onDraw, drawing }: Props) {
  const status = round.drawn ? "Winner selected" : round.active ? "Active" : "Ended";
  const endsLabel =
    round.endsIn <= 0
      ? "Ended"
      : round.endsIn >= 86_400
      ? `${Math.floor(round.endsIn / 86_400)}d`
      : `${Math.floor(round.endsIn / 3600)}h ${Math.floor((round.endsIn % 3600) / 60)}m`;

  const canDraw = !round.drawn && (round.endsIn <= 0 || round.maxReached);

  // ✅ Use formatted reward from the hook
  let rewardDisplay = round.rewardText;
  if (!rewardDisplay && round.rewardAmount && round.symbol) {
    rewardDisplay = `${round.rewardAmount} ${round.symbol}`;
  }

  // optional last-resort fallback if the hook couldn't resolve token meta:
  if (!rewardDisplay) {
    const raw = (round as any).rewardPool as bigint | undefined; // bigint base units
    if (typeof raw === "bigint") {
      // assume 18 decimals if unknown; you can change this if your token isn’t 18
      const approx = formatUnits(raw, 18);
      rewardDisplay = round.symbol ? `${approx} ${round.symbol}` : approx;
    }
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white shadow-sm">
      <div className="min-w-0">
        <h3 className="font-semibold">Raffle #{round.id}</h3>
        <p className="text-sm text-gray-500">
          Status: <span className="font-medium">{status}</span>
          {" · "}
          Tickets: {round.totalTickets}/{round.maxTickets}
          {round.maxReached && <span className="ml-1 text-emerald-600">Max reached</span>}
          {" · "}
          Joins: {round.participantEvents}
          {" · "}
          Ends in: {endsLabel}
        </p>
      </div>

      {/* Reward column — now formatted */}
      <div className="md:w-64">
        <p className="text-sm text-gray-500">
          Reward: <span className="font-medium">{rewardDisplay ?? "—"}</span>
        </p>
      </div>

      <Button size="sm" disabled={drawing || !canDraw} onClick={() => onDraw(round.id)}>
        {round.drawn ? "Drawn" : drawing ? "Drawing…" : "Draw winner"}
      </Button>
    </div>
  );
}
