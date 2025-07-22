// hooks/useAdminRounds.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { gqlFetch } from "@/lib/subgraph";
import { AdminRound, fetchRounds, getRoundCount } from "@/lib/raffle-contract";

type JoinEvent = { roundId: string };
type WinEvent  = { roundId: string };

type GqlData = {
  participantJoineds: JoinEvent[];
  winnerSelecteds: WinEvent[];
};

const PARTICIPANTS_QUERY = /* GraphQL */ `
  query AdminRounds($ids: [BigInt!]) {
    participantJoineds(where: { roundId_in: $ids }) {
      roundId
    }
    winnerSelecteds(where: { roundId_in: $ids }) {
      roundId
    }
  }
`;

export function useAdminRounds() {
  return useQuery({
    queryKey: ["adminRounds"],
    queryFn: async () => {
      // 1. total rounds
      const total = await getRoundCount();
      if (total === 0) return [] as CombinedRound[];

      const ids = Array.from({ length: total }, (_, i) => BigInt(i + 1));

      // 2. on-chain data
      const chainRounds = await fetchRounds(ids);

      // 3. subgraph participants/wins
      const data = await gqlFetch<GqlData>(PARTICIPANTS_QUERY, {
        ids: ids.map((b) => b.toString()),
      });

      const participantsCount: Record<string, number> = {};
      data.participantJoineds.forEach((e) => {
        participantsCount[e.roundId] = (participantsCount[e.roundId] || 0) + 1;
      });

      const winnersSet = new Set(data.winnerSelecteds.map((w) => Number(w.roundId)));

      // 4. merge
      const now = Math.floor(Date.now() / 1000);
      return chainRounds.map((r) => {
        const endsIn = r.ends - now;
        const activeByTime = endsIn > 0;
        const drawn = winnersSet.has(r.id) || r.winnersSelected;

        return {
          ...r,
          active: activeByTime && !drawn,
          endsIn,
          participantEvents: participantsCount[r.id.toString()] || 0,
          maxReached: r.totalTickets >= r.maxTickets && r.maxTickets > 0,
          drawn,
        };
      });
    },
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}

export type CombinedRound = AdminRound & {
  active: boolean;
  endsIn: number;
  participantEvents: number;
  maxReached: boolean;
  drawn: boolean;
};
