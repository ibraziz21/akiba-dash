// hooks/useAdminRounds.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { gqlFetch } from "@/lib/subgraph";

type RC = {
  id: string;
  roundId: string;
  startTime: string;
  endTime: string;
  maxTickets: string;
  rewardToken?: string | null;
  rewardPool?: string;
  ticketCostPoints?: string;
  roundType?: number | null; // v3 emits roundType (not raffleType)
};

type PJ  = { roundId: string; tickets: string };
type WS  = { roundId: string };
type MWS = { roundId: string };
type RCL = { roundId: string };

type GqlData = {
  roundCreateds: RC[];
  participantJoineds: PJ[];
  winnerSelecteds: WS[];
  multiWinnersSelecteds: MWS[];
  raffleCloseds: RCL[];
};

const QUERY = /* GraphQL */ `
  query AdminRounds {
    roundCreateds(first: 100, orderBy: roundId, orderDirection: desc) {
      id
      roundId
      startTime
      endTime
      maxTickets
      ticketCostPoints
      roundType
    }
    participantJoineds(first: 2000, orderBy: id, orderDirection: desc) {
      roundId
      tickets
    }
    winnerSelecteds(first: 1000, orderBy: roundId, orderDirection: desc) {
      roundId
    }
    multiWinnersSelecteds(first: 1000, orderBy: roundId, orderDirection: desc) {
      roundId
    }
    raffleCloseds(first: 1000, orderBy: roundId, orderDirection: desc) {
      roundId
    }
  }
`;

export type CombinedRound = {
  id: number;
  active: boolean;
  endsIn: number;            // seconds remaining (<=0 means ended)
  maxTickets: number;
  totalTickets: number;
  maxReached: boolean;
  drawn: boolean;
  raffleType: number;        // 0=single, 1=top-3, 2=top-5, 3=physical
  participantEvents: number; // count of join events seen
};

export function useAdminRounds() {
  return useQuery({
    queryKey: ["admin-rounds-v3-events"],
    queryFn: async (): Promise<CombinedRound[]> => {
      const data = await gqlFetch<GqlData>(QUERY);
      const now = Math.floor(Date.now() / 1000);

      // sum tickets per round + count joins
      const ticketSum = new Map<string, number>();
      const joinCount = new Map<string, number>();
      for (const e of data.participantJoineds || []) {
        const n = Number(e.tickets || 0);
        ticketSum.set(e.roundId, (ticketSum.get(e.roundId) || 0) + (Number.isFinite(n) ? n : 0));
        joinCount.set(e.roundId, (joinCount.get(e.roundId) || 0) + 1);
      }

      // drawn flags
      const drawnSet = new Set<string>();
      for (const e of data.winnerSelecteds || []) drawnSet.add(e.roundId);
      for (const e of data.multiWinnersSelecteds || []) drawnSet.add(e.roundId);

      // closed rounds (explicit closeRaffle)
      const closedSet = new Set<string>();
      for (const e of data.raffleCloseds || []) closedSet.add(e.roundId);

      return (data.roundCreateds || []).map((r) => {
        const start = Number(r.startTime);
        const end   = Number(r.endTime);
        const maxT  = Number(r.maxTickets || 0);
        const tot   = ticketSum.get(r.roundId) || 0;
        const drawn = drawnSet.has(r.roundId);
        const closed = closedSet.has(r.roundId);

        // derive "active" purely from events
        const active = !drawn && !closed && now >= start && now <= end;

        return {
          id: Number(r.roundId),
          active,
          endsIn: end - now,
          maxTickets: maxT,
          totalTickets: tot,
          maxReached: maxT > 0 && tot >= maxT,
          drawn,
          raffleType: Number(r.roundType ?? 0),
          participantEvents: joinCount.get(r.roundId) || 0,
        };
      });
    },
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}
