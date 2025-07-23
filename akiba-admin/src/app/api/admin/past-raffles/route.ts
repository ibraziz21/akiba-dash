// app/api/admin/past-raffles/route.ts
import { NextResponse } from 'next/server';
import { createPublicClient, http, type Abi, erc20Abi, Address, formatUnits } from 'viem';
import { celo } from 'viem/chains';
        // must contain symbol()/decimals()
import managerAbi from '@/lib/abi/RaffleManager.json';     // if you need fallback reads
// ── adjust to your subgraph URL ──
const SUBGRAPH_URL =
  'https://api.studio.thegraph.com/query/115307/akiba-v-2/version/latest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
});

/** GraphQL: get last N rounds + winners */
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

type RoundNode = {
  roundId: string;
  startTime: string;
  endTime: string;
  rewardToken: string;
  rewardPool: string;
};
type WinNode = {
  roundId: string;
  winner: string;
  reward: string;
  blockTimestamp: string;
};

export async function GET() {
  try {
    // 1) fetch from subgraph
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

    // 2) index wins by roundId
    const winByRound: Record<string, WinNode> = {};
    for (const w of wins) {
      winByRound[w.roundId] = w;
    }

    // 3) collect rewardToken addresses to resolve symbol/decimals
    const tokenAddrs = Array.from(
      new Set(rounds.map(r => r.rewardToken.toLowerCase()))
    ).filter(Boolean) as Address[];

    // 4) viem multicall: symbol + decimals
    const contracts = tokenAddrs.flatMap(addr => ([
      {
        address: addr,
        abi: erc20Abi as Abi,
        functionName: 'symbol',
      } as const,
      {
        address: addr,
        abi: erc20Abi as Abi,
        functionName: 'decimals',
      } as const,
    ]));

    const results = await publicClient.multicall({ contracts, allowFailure: true });

    const tokenMeta: Record<string, { symbol: string; decimals: number }> = {};
    for (let i = 0; i < tokenAddrs.length; i++) {
      const addr = tokenAddrs[i];
      const symRes = results[i * 2];
      const decRes = results[i * 2 + 1];

      const symbol   = symRes.status === 'success' ? (symRes.result as string) : '???';
      const decimals = decRes.status === 'success' ? Number(decRes.result) : 18;

      tokenMeta[addr.toLowerCase()] = { symbol, decimals };
    }

    // 5) merge & format
    const nowSec = Math.floor(Date.now() / 1000);
    const past = rounds
      .filter(r => {
        // finished raffle = endTime < now or we have a winner entry
        return Number(r.endTime) < nowSec || !!winByRound[r.roundId];
      })
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
          rewardPool: formatUnits(BigInt(r.rewardPool), meta.decimals),
          winner: w?.winner ?? null,
          winnerReward: w ? formatUnits(BigInt(w.reward), meta.decimals) : null,
          winnerTs: w ? Number(w.blockTimestamp) : null,
        };
      })
      // sort newest -> oldest
      .sort((a, b) => b.roundId - a.roundId);

    return NextResponse.json({ raffles: past });
  } catch (e) {
    console.error('[past-raffles] error', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
