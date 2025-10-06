// lib/raffle-contract.ts
import { createPublicClient, http, type Abi, type Address } from "viem";
import { celo } from "viem/chains";
// ⬇️ V3 ABI (update the path to your actual file)
import raffleAbi from "@/lib/abi/AkibaV3.json";

export const RAFFLE_MANAGER =
  (process.env.NEXT_PUBLIC_RAFFLE_MANAGER as Address) ||
  ("0xD75dfa972C6136f1c594Fec1945302f885E1ab29" as Address);

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
});

export async function getRoundCount() {
  const count = await publicClient.readContract({
    address: RAFFLE_MANAGER,
    abi: raffleAbi as Abi,
    functionName: "roundIdCounter",
  });
  return Number(count);
}

/**
 * Fetch ACTIVE rounds only (V3 has no `getRound`/public getter for ended rounds).
 * For ended rounds + metadata (raffleType, winners[], amounts, etc.),
 * use the subgraph.
 *
 * V3 getActiveRound returns:
 * [roundId, start, end, maxTickets, totalTickets, rewardToken, rewardPool, ticketCostPoints, winnerSelected]
 */
export async function fetchActiveRounds(ids: bigint[]) {
  const calls = ids.map((id) => ({
    address: RAFFLE_MANAGER,
    abi: raffleAbi as Abi,
    functionName: "getActiveRound" as const,
    args: [id],
  }));

  const res = await publicClient.multicall({
    allowFailure: true,
    contracts: calls,
  });

  const out: AdminRound[] = [];
  for (let i = 0; i < ids.length; i++) {
    const r = res[i];
    if (r.status !== "success") continue; // inactive/nonexistent → skip
    const [
      roundId,
      start,
      end,
      maxT,
      totalT,
      rewardToken,
      rewardPool,
      _ticketCostPoints,
      winnersSel,
    ] = r.result as any[];

    out.push({
      id: Number(roundId),
      starts: Number(start),
      ends: Number(end),
      maxTickets: Number(maxT),
      totalTickets: Number(totalT),
      winnersSelected: Boolean(winnersSel),
      rewardToken:
        (rewardToken?.toLowerCase?.() ===
        "0x0000000000000000000000000000000000000000"
          ? null
          : (rewardToken as Address)) ?? null,
      rewardPool: BigInt(rewardPool),
    });
  }
  return out;
}

/** Read the Prize NFT address (used for physical raffles) */
export async function readPrizeNFT(): Promise<`0x${string}`> {
  const addr = await publicClient.readContract({
    address: RAFFLE_MANAGER,
    abi: raffleAbi as Abi,
    functionName: "prizeNFT",
  });
  return addr as `0x${string}`;
}

/** Optional helper for results pages */
export async function getWinners(roundId: bigint): Promise<`0x${string}`[]> {
  const winners = await publicClient.readContract({
    address: RAFFLE_MANAGER,
    abi: raffleAbi as Abi,
    functionName: "winnersOf",
    args: [roundId],
  });
  return winners as `0x${string}`[];
}

export type AdminRound = {
  id: number;
  starts: number;
  ends: number;
  maxTickets: number;
  totalTickets: number;
  winnersSelected: boolean;
  // V3: address(0) for Physical prize rounds
  rewardToken: Address | null;
  rewardPool: bigint; // raw units
};
