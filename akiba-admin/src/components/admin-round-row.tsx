// components/admin-round-row.tsx
"use client";

import { CombinedRound } from "@/hooks/useAdminRounds";
import { Button } from "@/components/ui/button";

type Props = {
  round: CombinedRound;
  onDraw: (id: number) => Promise<void>;
  drawing: boolean;
};

export default function AdminRoundRow({ round, onDraw, drawing }: Props) {
  const status = round.drawn
    ? "Winner selected"
    : round.active
      ? "Active"
      : "Ended";

  const endsLabel = round.endsIn <= 0
    ? "Ended"
    : round.endsIn >= 86_400
      ? `${Math.floor(round.endsIn / 86_400)}d`
      : `${Math.floor(round.endsIn / 3600)}h ${Math.floor((round.endsIn % 3600) / 60)}m`;

  return (
    <div className="rounded-lg border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white shadow-sm">
      <div>
        <h3 className="font-semibold">Raffle #{round.id}</h3>
        <p className="text-sm text-gray-500">
          Status: <span className="font-medium">{status}</span>
          {" · "}
          Tickets: {round.totalTickets}/{round.maxTickets}
          {round.maxReached && <span className="ml-1 text-[#219653]">Max reached</span>}
          {" · "}
          Joins: {round.participantEvents}
          {" · "}
          Ends in: {endsLabel}
        </p>
      </div>

      <Button
        size="sm"
        disabled={drawing || round.drawn || !round.active}
        onClick={() => onDraw(round.id)}
      >
        {round.drawn ? "Drawn" : drawing ? "Drawing…" : "Draw winner"}
      </Button>
    </div>
  );
}
