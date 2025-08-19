// hooks/useAdminRounds.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { gqlFetch } from "@/lib/subgraph";
import {
  AdminRound,
  fetchRounds,
  getRoundCount,
  publicClient,
} from "@/lib/raffle-contract";
import { erc20Abi, type Abi, type Address, formatUnits } from "viem";

/* ──────────────────────────────────────────────────────────────── */
/* Graph — joins + winners                                          */
/* ──────────────────────────────────────────────────────────────── */

type JoinEvent = { roundId: string };
type WinEvent = { roundId: string };

type GqlData = {
  participantJoineds: JoinEvent[];
  winnerSelecteds: WinEvent[];
};

const PARTICIPANTS_AND_WINS = /* GraphQL */ `
  query AdminRoundsMeta($ids: [BigInt!]!) {
    participantJoineds(where: { roundId_in: $ids }, first: 1000) {
      roundId
    }
    winnerSelecteds(where: { roundId_in: $ids }, first: 1000) {
      roundId
    }
  }
`;

/* ──────────────────────────────────────────────────────────────── */
/* Types                                                            */
/* ──────────────────────────────────────────────────────────────── */

export type CombinedRound = AdminRound & {
  /** time-based active (endsIn > 0) AND not drawn */
  active: boolean;
  /** seconds remaining (can be <= 0 if ended) */
  endsIn: number;
  /** # of participantJoineds from subgraph */
  participantEvents: number;
  /** reached max tickets */
  maxReached: boolean;
  /** drawn if subgraph winner exists OR contract says winnersSelected */
  drawn: boolean;

  /** Formatted reward amount (e.g., "100.00") if token meta available */
  rewardAmount?: string;
  /** Token symbol (e.g., "USDT") */
  symbol?: string;
  /** Convenience “amount + symbol” text (e.g., "100.00 USDT") */
  rewardText?: string;
};

/* ──────────────────────────────────────────────────────────────── */
/* Hook                                                             */
/* ──────────────────────────────────────────────────────────────── */

export function useAdminRounds(limit: number = 20) {
  return useQuery({
    queryKey: ["admin-rounds", limit],
    queryFn: async (): Promise<CombinedRound[]> => {
      // 1) figure out IDs to read
      const count = await getRoundCount();
      if (!count) return [];

      const start = Math.max(1, count - limit + 1);
      const ids   = Array.from({ length: count - start + 1 }, (_, i) => BigInt(start + i));

      // 2) onchain rounds (AdminRound has rewardToken: Address; rewardPool: bigint)
      const baseRounds = await fetchRounds(ids); // AdminRound[]

      // 3) subgraph meta
      const idStrings = baseRounds.map((r) => r.id.toString());

      let joins: JoinEvent[] = [];
      let wins: WinEvent[] = [];
      try {
        const data = await gqlFetch<GqlData>(PARTICIPANTS_AND_WINS, { ids: idStrings });
        joins = data.participantJoineds ?? [];
        wins  = data.winnerSelecteds ?? [];
      } catch {
        // fallback if subgraph filter isn't available
        const FALLBACK_GQL = /* GraphQL */ `
          query Fallback {
            participantJoineds(first: 1000, orderBy: blockTimestamp, orderDirection: desc) { roundId }
            winnerSelecteds(first: 1000, orderBy: blockTimestamp, orderDirection: desc) { roundId }
          }
        `;
        const data = await gqlFetch<GqlData>(FALLBACK_GQL);
        joins = data.participantJoineds ?? [];
        wins  = data.winnerSelecteds ?? [];
      }

      const participantsCount: Record<string, number> = {};
      for (const j of joins) {
        if (!idStrings.includes(j.roundId)) continue;
        participantsCount[j.roundId] = (participantsCount[j.roundId] || 0) + 1;
      }
      const winnersSet = new Set(wins.filter(w => idStrings.includes(w.roundId)).map(w => Number(w.roundId)));

      // 4) resolve token metas (symbol/decimals) for reward formatting
      // AdminRound defines rewardToken; rewardPool (bigint). Build distinct list:
      const distinctTokens = Array.from(
        new Set(
          baseRounds
            .map(r => (r as any).rewardToken as Address | undefined)
            .filter((a): a is Address => !!a)
        )
      );

      let tokenMeta: Record<string, { symbol: string; decimals: number }> = {};
      if (distinctTokens.length > 0) {
        const contracts = distinctTokens.flatMap((addr) => [
          { address: addr, abi: erc20Abi as Abi, functionName: "symbol" } as const,
          { address: addr, abi: erc20Abi as Abi, functionName: "decimals" } as const,
        ]);
        const res = await publicClient.multicall({ contracts, allowFailure: true });
        for (let i = 0; i < distinctTokens.length; i++) {
          const addr  = distinctTokens[i].toLowerCase() as Address;
          const sym   = res[i * 2];
          const dec   = res[i * 2 + 1];
          tokenMeta[addr] = {
            symbol:   sym.status === "success" ? (sym.result as string) : "???",
            decimals: dec.status === "success" ? Number(dec.result) : 18,
          };
        }
      }

      // 5) merge, compute deriveds; DO NOT overwrite rewardPool (bigint)
      const nowSec = Math.floor(Date.now() / 1000);

      const enriched: CombinedRound[] = baseRounds
        .map((r) => {
          const endsIn = r.ends - nowSec;
          const drawn = winnersSet.has(r.id) || r.winnersSelected;
          const maxReached = r.maxTickets > 0 && r.totalTickets >= r.maxTickets;

          // reward formatting
          let rewardAmount: string | undefined;
          let symbol: string | undefined;
          let rewardText: string | undefined;

          const tokenAddr = (r as any).rewardToken as Address | undefined;
          const rawPool   = (r as any).rewardPool as bigint | undefined;

          if (tokenAddr && typeof rawPool === "bigint") {
            const meta = tokenMeta[tokenAddr.toLowerCase()];
            if (meta) {
              rewardAmount = formatUnits(rawPool, meta.decimals);
              symbol = meta.symbol;
              rewardText = `${rewardAmount} ${symbol}`;
            }
          }

          // IMPORTANT: keep bigint rewardPool from r; add formatted fields separately
          const out: CombinedRound = {
            ...r,
            active: endsIn > 0 && !drawn,
            endsIn,
            participantEvents: participantsCount[r.id.toString()] || 0,
            maxReached,
            drawn,
            rewardAmount,
            symbol,
            rewardText,
          };

          return out;
        })
        .sort((a, b) => b.id - a.id);

      return enriched;
    },
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}
