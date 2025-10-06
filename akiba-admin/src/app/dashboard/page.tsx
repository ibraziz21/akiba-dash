// app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUnits, decodeEventLog, erc20Abi, type Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Card from "@/components/Card";
// ⬇️ use your V3 ABI here (same one as in lib/raffle-contract.ts)
import managerAbi from "@/lib/abi/AkibaV3.json";
import { RAFFLE_MANAGER, readPrizeNFT } from "@/lib/raffle-contract";

const MILES = "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b" as const;

// Known reward tokens (for cash/miles raffles)
const TOKENS = [
  { symbol: "USDT",       address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
  { symbol: "cUSD",       address: "0x765de816845861e75a25fca122bb6898b8b1282a", decimals: 18 },
  { symbol: "AkibaMiles", address: MILES,                                         decimals: 18 },
] as const;
type Token = (typeof TOKENS)[number];

// Fixed VRF fee in CELO
const FIXED_FEE_CELO = "0.011";

type RaffleType = 0 | 1 | 2 | 3; // 0 single, 1 top3, 2 top5, 3 physical

export default function CreateRaffleV3() {
  const pc = usePublicClient();
  const { writeContractAsync, status } = useWriteContract();
  const isPending = status === "pending";

  // form state
  const [token,       setToken]       = useState<Token>(TOKENS[0]);
  const [reward,      setReward]      = useState("");
  const [startMin,    setStartMin]    = useState("0");
  const [days,        setDays]        = useState("7");
  const [maxTick,     setMaxTick]     = useState("1000");
  const [costPts,     setCostPts]     = useState("10");
  const [raffleType,  setRaffleType]  = useState<RaffleType>(0);
  const [rewardURI,   setRewardURI]   = useState("");
  const [prizeNft,    setPrizeNft]    = useState<`0x${string}` | null>(null);

  // randomness
  const [autoRequest, setAutoRequest] = useState(true);
  const [lastRoundId, setLastRoundId] = useState<string>("");

  useEffect(() => {
    readPrizeNFT().then(setPrizeNft).catch(() => setPrizeNft(null));
  }, []);

  const isPhysical = raffleType === 3;
  const displayToken =
    isPhysical && prizeNft
      ? { symbol: "PrizeNFT", address: prizeNft, decimals: 0 }
      : token;

  const rewardValid = useMemo(() => {
    if (isPhysical) return true; // reward forced to 0
    const n = Number(reward);
    return Number.isFinite(n) && n > 0;
  }, [reward, isPhysical]);

  async function onSubmit() {
    try {
      if (!rewardValid) {
        alert("Reward must be greater than 0 (unless Physical).");
        return;
      }
      if (isPhysical && !prizeNft) {
        alert("Prize NFT address not set on the contract yet.");
        return;
      }

      const now     = Math.floor(Date.now() / 1000);
      const startTs = now + Number(startMin) * 60;
      const durSec  = Number(days) * 86_400;

      const tokenAddr: `0x${string}` =
        isPhysical ? (prizeNft as `0x${string}`) : (displayToken.address as `0x${string}`);

      const rewardWei = isPhysical
        ? 0n
        : parseUnits(reward, (displayToken as any).decimals || 18);

      const costWei = parseUnits(costPts || "0", 18);

      // 1) approve ERC20 if needed (USDT/cUSD only — NOT miles and NOT the prizeNFT)
      if (tokenAddr.toLowerCase() !== MILES.toLowerCase() &&
          (!isPhysical || tokenAddr.toLowerCase() !== (prizeNft || "").toLowerCase())) {
        await writeContractAsync({
          abi: erc20Abi,
          address: tokenAddr,
          functionName: "approve",
          args: [RAFFLE_MANAGER, rewardWei],
        });
      }

      // 2) create round (V3 signature)
      // createRaffleRound(
      //   uint256 startTime,
      //   uint256 duration,
      //   uint32   maxTickets,
      //   address  token,
      //   uint8    raffleType,
      //   uint256  rewardPool,
      //   uint256  ticketCostPoints,
      //   string   rewardURI
      // )
      const txHash = await writeContractAsync({
        abi: managerAbi,
        address: RAFFLE_MANAGER,
        functionName: "createRaffleRound",
        args: [
          BigInt(startTs),
          BigInt(durSec),
          BigInt(maxTick),
          tokenAddr,
          raffleType,
          rewardWei,
          costWei,
          rewardURI || "",
        ],
      });

      const receipt = await pc!.waitForTransactionReceipt({ hash: txHash as Hex });

      // 3) extract roundId from RoundCreated
      let roundId: bigint | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: managerAbi,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: any };

          if (decoded.eventName === "RoundCreated") {
            const a = decoded.args;
            roundId = (a?.roundId ?? (Array.isArray(a) ? a[0] : undefined)) as bigint | undefined;
            if (roundId) break;
          }
        } catch { /* ignore */ }
      }

      setLastRoundId(roundId?.toString() ?? "");

      // 4) request randomness (fixed fee)
      if (autoRequest && roundId) {
        const fee = parseUnits(FIXED_FEE_CELO, 18);
        const hash2 = await writeContractAsync({
          address: RAFFLE_MANAGER,
          abi: managerAbi,
          functionName: "requestRoundRandomness",
          args: [roundId],
          value: fee,
        });
        await pc!.waitForTransactionReceipt({ hash: hash2 as Hex });
      }

      alert(
        `Round #${roundId?.toString() ?? "?"} created${
          autoRequest ? " & randomness requested" : ""
        }! 🎉`
      );
      setReward("");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Transaction failed");
    }
  }

  const submitDisabled = isPending || !rewardValid;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <Card title="Create Raffle (V3)">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {/* raffle type */}
          <div>
            <Label htmlFor="rtype">Raffle type</Label>
            <select
              id="rtype"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={raffleType}
              onChange={(e) => setRaffleType(Number(e.target.value) as RaffleType)}
            >
              <option value={0}>Single winner</option>
              <option value={1}>Top 3 (50/30/20)</option>
              <option value={2}>Top 5 (50/25/15/10/10)</option>
              <option value={3}>Physical prize (NFT voucher)</option>
            </select>
          </div>

          {/* token + reward */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="token">Reward token</Label>
              {isPhysical ? (
                <Input id="token" disabled value={prizeNft ? `PrizeNFT (${prizeNft})` : "PrizeNFT (unset)"} />
              ) : (
                <select
                  id="token"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={token.symbol}
                  onChange={(e) =>
                    setToken(TOKENS.find((t) => t.symbol === e.target.value)!)
                  }
                >
                  {TOKENS.map((t) => (
                    <option key={t.symbol} value={t.symbol}>
                      {t.symbol}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <Label htmlFor="reward">
                {isPhysical ? "Reward pool" : `Reward pool (${displayToken.symbol})`}
              </Label>
              <Input
                id="reward"
                placeholder={isPhysical ? "0 (physical prize)" : "e.g. 500"}
                value={isPhysical ? "0" : reward}
                onChange={(e) => setReward(e.target.value)}
                disabled={isPhysical}
              />
              {!rewardValid && reward !== "" && (
                <p className="mt-1 text-xs text-red-600">Enter an amount &gt; 0</p>
              )}
            </div>
          </div>

          {/* rewardURI (used for physical NFT voucher; harmless for others) */}
          <div>
            <Label htmlFor="ruri">Reward URI (image/metadata)</Label>
            <Input
              id="ruri"
              placeholder="ipfs://... or https://..."
              value={rewardURI}
              onChange={(e) => setRewardURI(e.target.value)}
            />
          </div>

          {/* timing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start">Starts in (minutes)</Label>
              <Input
                id="start"
                placeholder="0"
                value={startMin}
                onChange={(e) => setStartMin(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="duration">Duration (days)</Label>
              <Input
                id="duration"
                placeholder="7"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
          </div>

          {/* tickets */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="max">Maximum tickets</Label>
              <Input
                id="max"
                placeholder="1000"
                value={maxTick}
                onChange={(e) => setMaxTick(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cost">Ticket cost (AkibaMiles)</Label>
              <Input
                id="cost"
                placeholder="10"
                value={costPts}
                onChange={(e) => setCostPts(e.target.value)}
              />
            </div>
          </div>

          {/* randomness toggle */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoRequest}
                onChange={(e) => setAutoRequest(e.target.checked)}
              />
              Request randomness immediately (fee {FIXED_FEE_CELO} CELO)
            </label>
          </div>

          <Button disabled={submitDisabled} type="submit">
            {isPending ? "Submitting…" : "Create"}
          </Button>

          {lastRoundId && (
            <p className="text-xs text-gray-500 mt-2">
              Last created round: #{lastRoundId}
            </p>
          )}
        </form>
      </Card>
    </main>
  );
}
