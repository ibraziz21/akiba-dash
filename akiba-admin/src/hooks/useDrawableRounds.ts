// hooks/useDrawableRounds.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { gqlFetch } from "@/lib/subgraph";
import { Address, PublicClient } from "viem";
// import your configured client, e.g.:
import {publicClient} from "@/lib/raffle-contract";
import { RAFFLE_MANAGER } from "@/lib/raffle-contract";

const DEBUG = false;
const NS = "useDrawableRounds";

const dbg = (label: string, ...args: any[]) => { if (DEBUG) console.log(`[${NS}] ${label}`, ...args); };

type RC  = { roundId: string; startTime: string; endTime: string; maxTickets: string; roundType?: number | null };
type PJ  = { roundId: string; tickets: string };
type WS  = { roundId: string };
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

export type DrawableRound = {
  id: number;
  endsIn: number;
  ended: boolean;
  maxTickets: number;
  totalTickets: number;
  maxReached: boolean;
  drawn: boolean;
  closed: boolean;
  raffleType: number;
  randRequested: boolean;
  meetsThreshold: boolean;
  underThreshold: boolean;
  canDraw: boolean;
  canClose: boolean;
  rewardToken?: string;
  rewardPool?: string;
  ticketCostPoints?: string;
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
    participantJoineds(first: 1000, orderBy: id, orderDirection: desc) { roundId tickets }
    winnerSelecteds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
    multiWinnersSelecteds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
    raffleCloseds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
    randomnessRequesteds(first: 1000, orderBy: roundId, orderDirection: desc) { roundId }
  }
`;

// --- Contract bits ---
const ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "getActiveRound",
    inputs: [{ name: "_roundId", type: "uint256" }],
    outputs: [
      { name: "roundId", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "maxTickets", type: "uint32" },
      { name: "totalTickets", type: "uint32" },
      { name: "rewardToken", type: "address" },
      { name: "rewardPool", type: "uint256" },
      { name: "ticketCostPoints", type: "uint256" },
      { name: "winnerSelected", type: "bool" },
    ],
  },
] as const;

function n(x: unknown, fb = 0) {
  try {
    if (typeof x === "number") return Number.isFinite(x) ? x : fb;
    if (typeof x === "string") return Number.isFinite(+x) ? +x : fb;
    if (typeof x === "bigint") { const y = Number(x); return Number.isFinite(y) ? y : fb; }
  } catch {}
  return fb;
}

async function fetchOnchainActive(roundIds: number[], pc: PublicClient, addr: Address) {
  if (!roundIds.length) return new Map<number, any>();
  const res = await pc.multicall({
    allowFailure: true,
    contracts: roundIds.map((id) => ({
      address: addr,
      abi: ABI,
      functionName: "getActiveRound" as const,
      args: [BigInt(id)],
    })),
  });
  const out = new Map<number, {
    startTime: number; endTime: number; maxTickets: number; totalTickets: number;
    rewardToken: string; rewardPool: string; ticketCostPoints: string; winnerSelected: boolean;
  }>();
  res.forEach((r, i) => {
    const id = roundIds[i];
    if (!r || r.status !== "success") return;
    const [_, st, et, maxT, tot, rt, rp, tcp, ws] = r.result as unknown as [
      bigint,bigint,bigint,number,number,`0x${string}`,bigint,bigint,boolean
    ];
    out.set(id, {
      startTime: n(st), endTime: n(et), maxTickets: n(maxT), totalTickets: n(tot),
      rewardToken: rt, rewardPool: (rp as bigint).toString(), ticketCostPoints: (tcp as bigint).toString(), winnerSelected: ws,
    });
  });
  dbg("onchain active merged", Object.fromEntries(out));
  return out;
}

export function useDrawableRounds() {
  return useQuery({
    queryKey: ["draw-rounds-v3:merged"],
    queryFn: async (): Promise<DrawableRound[]> => {
      const d = await gqlFetch<Gql>(QUERY);
      const now = Math.floor(Date.now() / 1000);

      // Subgraph totals (used only as fallback)
      const totals = new Map<string, number>();
      for (const e of d.participantJoineds || []) {
        const t = Number(e.tickets || 0);
        totals.set(e.roundId, (totals.get(e.roundId) || 0) + (Number.isFinite(t) ? t : 0));
      }

      // Event flags
      const drawn = new Set<string>();
      for (const e of d.winnerSelecteds || []) drawn.add(e.roundId);
      for (const e of d.multiWinnersSelecteds || []) drawn.add(e.roundId);
      const closed = new Set<string>();
      for (const e of d.raffleCloseds || []) closed.add(e.roundId);
      const randReq = new Set<string>();
      for (const e of d.randomnessRequesteds || []) randReq.add(e.roundId);

      // On-chain override candidates (not drawn/closed)
      const candidateIds = (d.roundCreateds || [])
        .filter((r) => !drawn.has(r.roundId) && !closed.has(r.roundId))
        .map((r) => Number(r.roundId));

      const onchain = await fetchOnchainActive(candidateIds, publicClient as PublicClient, RAFFLE_MANAGER as Address);

      // Build rows (use on-chain if present, else subgraph)
      const rows: DrawableRound[] = (d.roundCreateds || []).map((r) => {
        const id = Number(r.roundId);
        const oc = onchain.get(id);
        const end = oc ? oc.endTime : n(r.endTime);
        const maxT = oc ? oc.maxTickets : n(r.maxTickets);
        const tot  = oc ? oc.totalTickets : (totals.get(r.roundId) || 0);

        const isDrawn  = drawn.has(r.roundId);
        const isClosed = closed.has(r.roundId);
        const ended    = end > 0 && now > end;
        const maxed    = maxT > 0 && tot >= maxT;

        const meetsThreshold = maxT > 0 && (tot * 100) >= (maxT * 10);
        const underThreshold = maxT > 0 && (tot * 100) <  (maxT * 10);

        return {
          id,
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
          canDraw: !isDrawn && !isClosed && (ended || maxed) && meetsThreshold && randReq.has(r.roundId),
          canClose: !isDrawn && !isClosed && ended && underThreshold,
          ...(oc ? { rewardToken: oc.rewardToken, rewardPool: oc.rewardPool, ticketCostPoints: oc.ticketCostPoints } : {}),
        };
      });

      const sorted = rows.sort((a, b) => b.id - a.id);
      dbg("final", sorted.map(x => ({ id: x.id, tot: x.totalTickets, max: x.maxTickets, canDraw: x.canDraw, canClose: x.canClose })));
      return sorted;
    },
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}
