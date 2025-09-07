// app/dashboard/page.tsx
"use client";

import { useMemo, useState } from "react";
import { parseUnits, decodeEventLog, erc20Abi, type Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Card from "@/components/Card";
import { abi as managerAbi } from "@/lib/abi/RaffleManager.json";

const RAFFLE_MANAGER = "0xD75dfa972C6136f1c594Fec1945302f885E1ab29" as const;
const MILES          = "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b" as const;

// TODO: set to your deployed Physical Prize NFT contract
const PRIZE_NFT      = "0x0000000000000000000000000000000000000000" as const;

const TOKENS = [
  { symbol: "USDT",       address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
  { symbol: "cUSD",       address: "0x765de816845861e75a25fca122bb6898b8b1282a", decimals: 18 },
  { symbol: "AkibaMiles", address: MILES,                                         decimals: 18 },
] as const;
type Token = (typeof TOKENS)[number];

// Raffle types from contract (uint8)
const RAFFLE_TYPES = [
  { label: "Single winner",  value: 0 },
  { label: "Triple winners", value: 1 },
  { label: "Quintuple",      value: 2 },
  { label: "Physical (NFT)", value: 3 },
] as const;

// Fixed VRF fee in CELO
const FIXED_FEE_CELO = "0.011";

export default function CreateRaffleAndRandomize() {
  const pc = usePublicClient();
  const { writeContractAsync, status } = useWriteContract();
  const isPending = status === "pending";

  // form state
  const [raffleType, setRaffleType] = useState<number>(0); // 0..3
  const [token, setToken] = useState<Token>(TOKENS[0]);
  const [reward, setReward] = useState("");                // numeric
  const [rewardURI, setRewardURI] = useState("");          // string (e.g., ipfs://...)
  const [startMin, setStartMin] = useState("0");
  const [days, setDays] = useState("7");
  const [maxTick, setMaxTick] = useState("1000");
  const [costPts, setCostPts] = useState("10");

  // randomness
  const [autoRequest, setAutoRequest] = useState(true);
  const [lastRoundId, setLastRoundId] = useState<string>("");

  const isPhysical = raffleType === 3;

  // effective token (for Physical we must pass PRIZE_NFT)
  const effectiveToken = useMemo(
    () => (isPhysical ? PRIZE_NFT : (token.address as `0x${string}`)),
    [isPhysical, token.address]
  );

  // validation: reward required for non-physical; optional/zero for physical
  const rewardValid = useMemo(() => {
    if (isPhysical) return true; // contract allows 0
    const n = Number(reward);
    return Number.isFinite(n) && n > 0;
  }, [reward, isPhysical]);

  // extra: require a rewardURI for Physical
  const rewardUriValid = useMemo(() => {
    if (!isPhysical) return true;
    return rewardURI.trim().length > 0;
  }, [isPhysical, rewardURI]);

  async function onSubmit() {
    try {
      if (!rewardValid) {
        alert("Reward must be greater than 0 for non-physical raffles.");
        return;
      }
      if (!rewardUriValid) {
        alert("Reward metadata URI is required for Physical (NFT) raffles.");
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const startTs = now + Number(startMin || "0") * 60;
      const durSec = Number(days || "0") * 86_400;

      // rewardPool: ignored for Physical (send 0), else parse with token decimals
      const rewardWei = isPhysical ? 0n : parseUnits(reward || "0", token.decimals);
      const costWei = parseUnits(costPts || "0", 18);

      // 1) approve ERC20 if needed (not Miles, not Prize NFT, not Physical)
      const needsApprove =
        !isPhysical &&
        effectiveToken.toLowerCase() !== MILES.toLowerCase();

      if (needsApprove) {
        await writeContractAsync({
          abi: erc20Abi,
          address: effectiveToken,
          functionName: "approve",
          args: [RAFFLE_MANAGER, rewardWei],
        });
      }

      // 2) create round (new signature)
      const txHash = await writeContractAsync({
        abi: managerAbi,
        address: RAFFLE_MANAGER,
        functionName: "createRaffleRound",
        args: [
          BigInt(startTs),                // _startTime
          BigInt(durSec),                 // _duration
          BigInt(maxTick),                // _maxTickets
          effectiveToken,                 // _token
          Number(raffleType),             // _raffleType (uint8)
          BigInt(rewardWei),              // _rewardPool
          BigInt(costWei),                // _ticketCostPoints
          rewardURI || "",                // _rewardURI
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
            roundId = (a?.roundId ??
              (Array.isArray(a) ? a[0] : undefined)) as bigint | undefined;
            if (roundId) break;
          }
        } catch {
          // ignore
        }
      }

      // fallback: ask the counter
      if (!roundId) {
        const counter = await pc!.readContract({
          address: RAFFLE_MANAGER,
          abi: managerAbi,
          functionName: "roundIdCounter",
        });
        roundId = counter as bigint;
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

      // reset some fields
      setReward(isPhysical ? "0" : "");
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Transaction failed");
    }
  }

  const submitDisabled = isPending || !rewardValid || !rewardUriValid;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <Card title="Create Raffle (and optionally request randomness)">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {/* Raffle Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rtype">Raffle Type</Label>
              <select
                id="rtype"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                value={raffleType}
                onChange={(e) => setRaffleType(Number(e.target.value))}
              >
                {RAFFLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Reward URI (required for Physical) */}
            <div>
              <Label htmlFor="ruri">
                Reward metadata URI{isPhysical ? " (required for Physical)" : " (optional)"}
              </Label>
              <Input
                id="ruri"
                placeholder="e.g. ipfs://Qm... or https://…"
                value={rewardURI}
                onChange={(e) => setRewardURI(e.target.value)}
              />
            </div>
          </div>

          {/* Token + reward */}
          <div className="grid grid-cols-2 gap-4">
            {!isPhysical ? (
              <div>
                <Label htmlFor="token">Reward token</Label>
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
              </div>
            ) : (
              <div>
                <Label>Prize NFT (fixed)</Label>
                <Input value={PRIZE_NFT} readOnly />
              </div>
            )}

            <div>
              <Label htmlFor="reward">
                {isPhysical
                  ? "Reward pool (ignored for Physical)"
                  : `Reward pool (${token.symbol})`}
              </Label>
              <Input
                id="reward"
                placeholder={isPhysical ? "0" : "e.g. 500"}
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                disabled={isPhysical}
              />
              {!rewardValid && reward !== "" && (
                <p className="mt-1 text-xs text-red-600">
                  Enter an amount &gt; 0
                </p>
              )}
              {isPhysical && rewardURI.trim().length === 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  Provide a Reward URI for the NFT metadata.
                </p>
              )}
            </div>
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
