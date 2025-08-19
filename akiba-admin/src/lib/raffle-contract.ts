// lib/raffle-contract.ts
import { createPublicClient, http, type Abi, Address } from "viem";
import { celo } from "viem/chains";
import raffleAbi from "@/lib/abi/RaffleManager.json";

export const RAFFLE_MANAGER = "0xD75dfa972C6136f1c594Fec1945302f885E1ab29" as Address;

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
});

export async function getRoundCount() {
  const count = await publicClient.readContract({
    address: RAFFLE_MANAGER,
    abi: raffleAbi.abi as Abi,
    functionName: "roundIdCounter",
  });
  return Number(count);
}

/** getActiveRound(id) or fallback to getRound if available.
 * RaffleManager.getActiveRound returns:
 * [roundId, start, end, maxTickets, totalTickets, rewardToken, rewardPool, ticketCostPoints, winnersSelected]
 */
export async function fetchRounds(ids: bigint[]) {
  const calls = ids.map((id) => ({
    address: RAFFLE_MANAGER,
    abi: raffleAbi.abi as Abi,
    functionName: "getActiveRound" as any,
    args: [id],
  }));

  const resActive = await publicClient.multicall({
    allowFailure: true,
    contracts: calls,
  });

  // Fallback for ended rounds
  const callsRound = ids.map((id) => ({
    address: RAFFLE_MANAGER,
    abi: raffleAbi.abi as Abi,
    functionName: "getRound" as any,
    args: [id],
  }));
  const resRound = await publicClient.multicall({
    allowFailure: true,
    contracts: callsRound,
  });

  const out: AdminRound[] = [];
  for (let i = 0; i < ids.length; i++) {
    const r = resActive[i].status === "success" ? resActive[i] : resRound[i];
    if (r.status !== "success") continue;
    const [roundId, start, end, maxT, totalT, rewardToken, rewardPool, _cost, winnersSel] = r.result as any[];
    out.push({
      id: Number(roundId),
      starts: Number(start),
      ends: Number(end),
      maxTickets: Number(maxT),
      totalTickets: Number(totalT),
      winnersSelected: Boolean(winnersSel),
      // ✅ new: expose reward data for UI
      rewardToken: rewardToken as Address,
      rewardPool: BigInt(rewardPool),
    });
  }
  return out;
}

export type AdminRound = {
  id: number;
  starts: number;
  ends: number;
  maxTickets: number;
  totalTickets: number;
  winnersSelected: boolean;
  // ✅ new
  rewardToken: Address;
  rewardPool: bigint; // raw units (use token decimals to format)
};
