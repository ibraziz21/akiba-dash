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

/** getActiveRound(id) or fallback to getRound if you have it.
 * RaffleManager.getActiveRound returns:
 * [roundId, start, end, maxTickets, totalTickets, rewardToken, rewardPool, ticketCostPoints, winnersSelected]
 */
export async function fetchRounds(ids: bigint[]) {
  const multicallRes = await publicClient.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: RAFFLE_MANAGER,
      abi: raffleAbi.abi as Abi,
      functionName: "getActiveRound",
      args: [id],
    })),
  });

  return ids.map((id, i) => {
    const r = multicallRes[i];
    if (r.status !== "success") return null;
    const [roundId, start, end, maxT, totalT, _rtok, _rpool, _cost, winnersSel] = r.result as any[];
    return {
      id: Number(roundId),
      starts: Number(start),
      ends: Number(end),
      maxTickets: Number(maxT),
      totalTickets: Number(totalT),
      winnersSelected: Boolean(winnersSel),
    };
  }).filter(Boolean) as AdminRound[];
}

export type AdminRound = {
  id: number;
  starts: number;
  ends: number;
  maxTickets: number;
  totalTickets: number;
  winnersSelected: boolean;
};
