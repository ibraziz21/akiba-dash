// hooks/useDrawableRounds.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { gqlFetch } from "@/lib/subgraph";

type RC = { roundId: string; startTime: string; endTime: string; maxTickets: string; roundType?: number | null };
type PJ = { roundId: string; tickets: string };
type WS = { roundId: string };
type MWS = { roundId: string };
type RCL = { roundId: string };
type RRQ = { roundId: string };

type Gql = {
  roundCreateds: RC[];
  participantJoineds: PJ[];
  winnerSelecteds: WS[];
  multiWinnersSelecteds: MWS[];
  raffleCloseds: RCL[];
  randomnessRequesteds: RRQ[];
};

const QUERY = /* GraphQL */ `
  query DrawRounds {
    roundCreateds(first: 200, orderBy: roundId, orderDirection: desc) {
      roundId
      startTime
      endTime
      maxTickets
      roundType
    }
    participantJoineds(first: 1000, orderBy: id, orderDirection: desc) {
      roundId
      tickets
    }
    winnerSelecteds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
    multiWinnersSelecteds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
    raffleCloseds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
    randomnessRequesteds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
  }
`;

export type DrawableRound = {
  id: number;
  endsIn: number;            // seconds until end; <=0 means ended
  ended: boolean;            // convenience flag
  maxTickets: number;
  totalTickets: number;
  maxReached: boolean;       // total >= max
  drawn: boolean;
  closed: boolean;
  raffleType: number;        // 0 single, 1 top-3, 2 top-5, 3 physical
  randRequested: boolean;    // VRF requested
  meetsThreshold: boolean;   // >= 20% sold
  underThreshold: boolean;   // < 20% sold
  canDraw: boolean;          // ended/maxed, threshold met, not drawn/closed, VRF requested
  canClose: boolean;         // ended, threshold NOT met, not drawn/closed
};

export function useDrawableRounds() {
  return useQuery({
    queryKey: ["draw-rounds-v3"],
    queryFn: async (): Promise<DrawableRound[]> => {
      const d = await gqlFetch<Gql>(QUERY);
      const now = Math.floor(Date.now() / 1000);

      // totals
      const totals = new Map<string, number>();
      for (const e of d.participantJoineds || []) {
        const n = Number(e.tickets || 0);
        totals.set(e.roundId, (totals.get(e.roundId) || 0) + (Number.isFinite(n) ? n : 0));
      }

      // sets
      const drawn = new Set<string>();
      for (const e of d.winnerSelecteds || []) drawn.add(e.roundId);
      for (const e of d.multiWinnersSelecteds || []) drawn.add(e.roundId);

      const closed = new Set<string>();
      for (const e of d.raffleCloseds || []) closed.add(e.roundId);

      const randReq = new Set<string>();
      for (const e of d.randomnessRequesteds || []) randReq.add(e.roundId);

      // derive
      const list: DrawableRound[] = [];
      for (const r of d.roundCreateds || []) {
        const end = Number(r.endTime || 0);
        const maxT = Number(r.maxTickets || 0);
        const tot  = totals.get(r.roundId) || 0;

        const isDrawn  = drawn.has(r.roundId);
        const isClosed = closed.has(r.roundId);
        const ended    = end > 0 && now > end;
        const maxed    = maxT > 0 && tot >= maxT;

        const meetsThreshold  = maxT > 0 && (tot * 100) >= (maxT * 20);
        const underThreshold  = maxT > 0 && (tot * 100) <  (maxT * 20);

        const canDraw  = !isDrawn && !isClosed && (ended || maxed) && meetsThreshold && randReq.has(r.roundId);
        const canClose = !isDrawn && !isClosed && ended && underThreshold;

        list.push({
          id: Number(r.roundId),
          endsIn: end - now,
          ended,
          maxTickets: maxT,
          totalTickets: tot,
          maxReached: maxed,
          drawn: isDrawn,
          closed: isClosed,
          raffleType: Number(r.roundType ?? 0),
          randRequested: randReq.has(r.roundId),
          meetsThreshold,
          underThreshold,
          canDraw,
          canClose,
        });
      }

      return list.sort((a, b) => b.id - a.id);
    },
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}
