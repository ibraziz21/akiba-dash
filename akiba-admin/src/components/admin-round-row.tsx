// components/admin-round-row.tsx
"use client";

import { DrawableRound as CombinedRound } from "@/hooks/useDrawableRounds";
import { Button } from "@/components/ui/button";

const typeLabel = (t: number) =>
  t === 0 ? "Single" : t === 1 ? "Top-3" : t === 2 ? "Top-5" : t === 3 ? "Physical" : `Type ${t}`;

type Props = {
  round: CombinedRound;
  onDraw: (id: number) => Promise<void>;
  drawing: boolean;
};

export default function AdminRoundRow({ round, onDraw, drawing }: Props) {
  const status = round.drawn ? "Winner selected" : round.ended ? "Ended" : "Active";
  const endsLabel =
    round.endsIn <= 0 ? "Ended" :
    round.endsIn >= 86_400 ? `${Math.floor(round.endsIn / 86_400)}d` :
    `${Math.floor(round.endsIn / 3600)}h ${Math.floor((round.endsIn % 3600) / 60)}m`;

  const canDraw = !round.drawn && (round.ended || round.maxReached);

  return (
    <div className="rounded-lg border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white shadow-sm">
      <div>
        <h3 className="font-semibold">
          Raffle #{round.id} <span className="ml-2 text-xs rounded bg-gray-200 px-2 py-0.5">{typeLabel(round.raffleType)}</span>
        </h3>
        <p className="text-sm text-gray-500">
          Status: <span className="font-medium">{status}</span>
          {" · "}
          Tickets: {round.totalTickets}/{round.maxTickets}
          {round.maxReached && <span className="ml-1 text-[#219653]">Max reached</span>}
          {" · "}
          Ends in: {endsLabel}
        </p>
      </div>

      <Button size="sm" disabled={drawing || !canDraw} onClick={() => onDraw(round.id)}>
        {round.drawn ? "Drawn" : drawing ? "Drawing…" : "Draw winner"}
      </Button>
    </div>
  );
}
