// app/api/admin/past-raffles/route.ts
import { NextResponse } from 'next/server';
import { createPublicClient, http, type Abi, erc20Abi, Address, formatUnits } from 'viem';
import { celo } from 'viem/chains';
import managerAbi from '@/lib/abi/RaffleManager.json'; // for direct fallback calls

const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/115307/akiba-v-2/version/latest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const publicClient = createPublicClient({ chain: celo, transport: http() });

// Base query for past rounds + winners (optionally includes maxTickets if your subgraph has it)
const GQL = /* GraphQL */ `
  query Past($limit: Int!) {
    rounds: roundCreateds(
      first: $limit
      orderBy: blockTimestamp
      orderDirection: desc
    ) {
      roundId
      startTime
      endTime
      rewardToken
      rewardPool
      maxTickets
    }

    wins: winnerSelecteds(
      first: $limit
      orderBy: blockTimestamp
      orderDirection: desc
    ) {
      roundId
      winner
      reward
      blockTimestamp
    }
  }
`;

// Count tickets per round (preferred path with roundId_in)
const GQL_TICKETS = /* GraphQL */ `
  query Tickets($ids: [BigInt!]!) {
    participantJoineds(where: { roundId_in: $ids }, first: 5000) {
      roundId
    }
  }
`;

// Fallback if your subgraph build doesn’t support _in filters
const GQL_TICKETS_FALLBACK = /* GraphQL */ `
  query TicketsFallback {
    participantJoineds(first: 5000, orderBy: blockTimestamp, orderDirection: desc) {
      roundId
    }
  }
`;

type RoundNode = {
  roundId: string;
  startTime: string;
  endTime: string;
  rewardToken: string;
  rewardPool: string;
  maxTickets?: string | null;
};
type WinNode = {
  roundId: string;
  winner: string;
  reward: string;
  blockTimestamp: string;
};

export async function GET() {
  try {
    // 1) subgraph: base
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: GQL, variables: { limit: 100 } }),
    });
    const raw = await res.json();
    if (!res.ok || raw.errors) {
      return NextResponse.json(
        { error: 'Subgraph error', detail: raw.errors || res.statusText },
        { status: 502 }
      );
    }

    const rounds: RoundNode[] = raw.data.rounds ?? [];
    const wins:   WinNode[]   = raw.data.wins   ?? [];

    const winByRound: Record<string, WinNode> = {};
    for (const w of wins) winByRound[w.roundId] = w;

    // 2) token meta
    const tokenAddrs = Array.from(new Set(rounds.map(r => r.rewardToken.toLowerCase()))).filter(Boolean) as Address[];
    const contracts = tokenAddrs.flatMap(addr => ([
      { address: addr, abi: erc20Abi as Abi, functionName: 'symbol' } as const,
      { address: addr, abi: erc20Abi as Abi, functionName: 'decimals' } as const,
    ]));
    const results = await publicClient.multicall({ contracts, allowFailure: true });

    const tokenMeta: Record<string, { symbol: string; decimals: number }> = {};
    for (let i = 0; i < tokenAddrs.length; i++) {
      const addr = tokenAddrs[i];
      const symRes = results[i * 2];
      const decRes = results[i * 2 + 1];
      tokenMeta[addr.toLowerCase()] = {
        symbol:   symRes.status === 'success' ? (symRes.result as string) : '???',
        decimals: decRes.status === 'success' ? Number(decRes.result) : 18,
      };
    }

    // 3) build past list (format reward for display)
    const nowSec = Math.floor(Date.now() / 1000);
    const past = rounds
      .filter(r => Number(r.endTime) < nowSec || !!winByRound[r.roundId])
      .map(r => {
        const meta = tokenMeta[r.rewardToken.toLowerCase()] ?? { symbol: '???', decimals: 18 };
        const w    = winByRound[r.roundId];

        return {
          roundId: Number(r.roundId),
          start:   Number(r.startTime),
          end:     Number(r.endTime),
          durationSec: Number(r.endTime) - Number(r.startTime),
          rewardToken: r.rewardToken as Address,
          symbol: meta.symbol,
          rewardPool: formatUnits(BigInt(r.rewardPool), meta.decimals), // string for display
          winner: w?.winner ?? null,
          winnerReward: w ? formatUnits(BigInt(w.reward), meta.decimals) : null,
          winnerTs: w ? Number(w.blockTimestamp) : null,
          totalTickets: undefined as number | undefined,
          maxTickets: r.maxTickets != null ? Number(r.maxTickets) : undefined,
        };
      })
      .sort((a, b) => b.roundId - a.roundId);

    const ids = past.map(p => p.roundId);
    const idsBig = ids.map(n => BigInt(n));
    const idsStr = ids.map(n => n.toString());

    // 4) ✅ totalTickets from subgraph participantJoineds (works for ended rounds)
    let joins: { roundId: string }[] = [];
    try {
      const ticketsRes = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: GQL_TICKETS, variables: { ids: idsStr } }),
      });
      const ticketsJson = await ticketsRes.json();
      if (!ticketsRes.ok || ticketsJson.errors) throw new Error('primary tickets query failed');
      joins = ticketsJson.data?.participantJoineds ?? [];
    } catch {
      // fallback: grab recent and filter
      const ticketsRes = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: GQL_TICKETS_FALLBACK }),
      });
      const ticketsJson = await ticketsRes.json();
      joins = ticketsJson.data?.participantJoineds ?? [];
    }

    const countByRound: Record<number, number> = {};
    for (const j of joins) {
      const id = Number(j.roundId);
      if (!ids.includes(id)) continue;
      countByRound[id] = (countByRound[id] || 0) + 1;
    }
    for (const r of past) {
      if (countByRound[r.roundId] != null) r.totalTickets = countByRound[r.roundId];
    }

    // 5) Try on-chain for maxTickets/totalTickets on ended rounds (dual fallback: getActiveRound → getRound)
    //    If your contract doesn't have getRound, this step just skips silently.
    const activeCalls = idsBig.map((id) => ({
      address: past[0]?.rewardToken ? (past[0].rewardToken as Address) : ('0x0000000000000000000000000000000000000000' as Address), // placeholder, replaced below
      abi: managerAbi.abi as Abi,
      functionName: 'getActiveRound' as const,
      args: [id],
    }));
    // Fix address for all calls to the RaffleManager:
    for (const c of activeCalls) c.address = (process.env.NEXT_PUBLIC_RAFFLE_MANAGER ||
      '0xD75dfa972C6136f1c594Fec1945302f885E1ab29') as Address;

    const roundCalls = idsBig.map((id) => ({
      address: activeCalls[0].address,
      abi: managerAbi.abi as Abi,
      functionName: 'getRound' as const,
      args: [id],
    }));

    try {
      const [activeRes, roundRes] = await Promise.all([
        publicClient.multicall({ contracts: activeCalls, allowFailure: true }),
        publicClient.multicall({ contracts: roundCalls, allowFailure: true }),
      ]);

      for (let i = 0; i < ids.length; i++) {
        const pick = activeRes[i].status === 'success' ? activeRes[i] : roundRes[i];
        if (pick?.status !== 'success') continue;

        // Expect tuple layout:
        // [roundId, start, end, maxT, totalT, rewardToken, rewardPool, ticketCostPoints, winnersSelected]
        const tuple = pick.result as any[];
        if (!Array.isArray(tuple) || tuple.length < 5) continue;

        const maxT = Number(tuple[3]);
        const totalT = Number(tuple[4]);

        const target = past.find(p => p.roundId === ids[i]);
        if (!target) continue;

        // prefer on-chain totals; keep subgraph count as fallback
        if (Number.isFinite(totalT)) target.totalTickets = totalT;
        if (Number.isFinite(maxT))   target.maxTickets   = maxT;
      }
    } catch {
      // ignore on-chain failure; subgraph totals already populated
    }

    return NextResponse.json({ raffles: past });
  } catch (e) {
    console.error('[past-raffles] error', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
