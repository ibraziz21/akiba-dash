// hooks/useAdminRounds.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { gqlFetch } from "@/lib/subgraph";

const DEBUG = true;

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

type RC = {
  id: string;
  roundId: string;
  startTime: string;
  endTime: string;
  maxTickets: string;
  ticketCostPoints?: string | null;
  roundType?: number | null; // v3 emits roundType
};

type WS  = { roundId: string };
type MWS = { roundId: string };
type RCL = { roundId: string };

type JoinEvt = { id: string; roundId: string; tickets: string };

type AdminRoundsBase = {
  roundCreateds: RC[];
  winnerSelecteds: WS[];
  multiWinnersSelecteds: MWS[];
  raffleCloseds: RCL[];
};

type AdminRoundsJoins = {
  participantJoineds: JoinEvt[];
};

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

/* ────────────────────────────────────────────────────────────────────────── */
/* GraphQL Queries                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

const BASE_QUERY = /* GraphQL */ `
  query AdminRoundsBase {
    roundCreateds(first: 100, orderBy: roundId, orderDirection: desc) {
      id
      roundId
      startTime
      endTime
      maxTickets
      ticketCostPoints
      roundType
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

const JOINS_PAGE_QUERY = /* GraphQL */ `
  query AdminRoundsJoins($ids: [String!]!, $cursor: String) {
    participantJoineds(
      first: 1000
      orderBy: id
      orderDirection: desc
      where: {
        roundId_in: $ids
        id_lt: $cursor
      }
    ) {
      id
      roundId
      tickets
    }
  }
`;

const JOINS_FIRST_PAGE_QUERY = /* GraphQL */ `
  query AdminRoundsJoinsFirst($ids: [String!]!) {
    participantJoineds(
      first: 1000
      orderBy: id
      orderDirection: desc
      where: { roundId_in: $ids }
    ) {
      id
      roundId
      tickets
    }
  }
`;

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

async function fetchAllJoinsForRounds(roundIds: string[]) {
  const ticketSum = new Map<string, number>();
  const joinCount = new Map<string, number>();

  if (roundIds.length === 0) {
    if (DEBUG) console.log("[useAdminRounds] No roundIds passed to fetchAllJoinsForRounds");
    return { ticketSum, joinCount };
  }

  let totalEvents = 0;

  // 1) first page
  let page = await gqlFetch<AdminRoundsJoins>(JOINS_FIRST_PAGE_QUERY, { ids: roundIds });
  let events = page.participantJoineds;

  if (DEBUG) {
    console.groupCollapsed("[useAdminRounds] Joins First Page");
    console.log("roundIds", roundIds);
    console.log("events.length", events.length);
    console.groupEnd();
  }

  while (events.length) {
    totalEvents += events.length;

    // accumulate
    for (const e of events) {
      const n = Number(e.tickets || 0);
      const add = Number.isFinite(n) ? n : 0;
      ticketSum.set(e.roundId, (ticketSum.get(e.roundId) || 0) + add);
      joinCount.set(e.roundId, (joinCount.get(e.roundId) || 0) + 1);
    }

    // 2) next page using id_lt cursor (last id from current page)
    const cursor = events[events.length - 1].id;
    if (DEBUG) {
      console.groupCollapsed("[useAdminRounds] Joins Page Pagination");
      console.log("cursor(id_lt)", cursor);
      console.groupEnd();
    }
    page = await gqlFetch<AdminRoundsJoins>(JOINS_PAGE_QUERY, { ids: roundIds, cursor });
    events = page.participantJoineds;

    if (DEBUG) {
      console.groupCollapsed("[useAdminRounds] Next Page");
      console.log("events.length", events.length);
      console.groupEnd();
    }
  }

  if (DEBUG) {
    console.groupCollapsed("[useAdminRounds] Joins Aggregation Summary");
    console.log("totalEvents", totalEvents);
    console.log("ticketSum (obj)", Object.fromEntries(ticketSum));
    console.log("joinCount (obj)", Object.fromEntries(joinCount));
    console.groupEnd();
  }

  return { ticketSum, joinCount };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Hook                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export function useAdminRounds() {
  return useQuery({
    queryKey: ["admin-rounds-v3-events"],
    queryFn: async (): Promise<CombinedRound[]> => {
      const base = await gqlFetch<AdminRoundsBase>(BASE_QUERY);
      const now = Math.floor(Date.now() / 1000);
      const roundIds = (base.roundCreateds || []).map((r) => r.roundId);

      if (DEBUG) {
        console.groupCollapsed("[useAdminRounds] Base Payload");
        console.log("roundCreateds", base.roundCreateds);
        console.log("winnerSelecteds", base.winnerSelecteds);
        console.log("multiWinnersSelecteds", base.multiWinnersSelecteds);
        console.log("raffleCloseds", base.raffleCloseds);
        console.groupEnd();
      }

      const drawnSet = new Set<string>();
      for (const e of base.winnerSelecteds || []) drawnSet.add(e.roundId);
      for (const e of base.multiWinnersSelecteds || []) drawnSet.add(e.roundId);

      const closedSet = new Set<string>();
      for (const e of base.raffleCloseds || []) closedSet.add(e.roundId);

      if (DEBUG) {
        console.groupCollapsed("[useAdminRounds] Flags");
        console.log("drawnSet", Array.from(drawnSet));
        console.log("closedSet", Array.from(closedSet));
        console.groupEnd();
      }

      const { ticketSum, joinCount } = await fetchAllJoinsForRounds(roundIds);

      const rounds: CombinedRound[] = (base.roundCreateds || []).map((r) => {
        const start = Number(r.startTime || 0);
        const end   = Number(r.endTime || 0);
        const maxT  = Number(r.maxTickets || 0);
        const tot   = ticketSum.get(r.roundId) || 0;
        const drawn = drawnSet.has(r.roundId);
        const closed = closedSet.has(r.roundId);
        const active = !drawn && !closed && now >= start && now <= end;

        const res: CombinedRound = {
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

        if (DEBUG) {
          console.groupCollapsed(`[useAdminRounds] Derived Round #${res.id}`);
          console.log("raw", r);
          console.log("derived", res);
          if (res.maxTickets > 0 && (res.totalTickets >= res.maxTickets) !== res.maxReached) {
            console.warn(`⚠️ [useAdminRounds] Inconsistency on #${res.id}: totalTickets>=maxTickets != maxReached`, {
              totalTickets: res.totalTickets,
              maxTickets: res.maxTickets,
              maxReached: res.maxReached,
            });
          }
          console.groupEnd();
        }

        return res;
      });

      rounds.sort((a, b) => b.id - a.id);

      if (DEBUG) {
        console.groupCollapsed("[useAdminRounds] Final Combined Rounds");
        console.table(rounds.map(r => ({
          id: r.id,
          totalTickets: r.totalTickets,
          maxTickets: r.maxTickets,
          participantEvents: r.participantEvents,
          active: r.active,
          endsIn: r.endsIn,
          drawn: r.drawn,
          raffleType: r.raffleType,
          maxReached: r.maxReached
        })));
        console.groupEnd();
      }

      return rounds;
    },
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}
