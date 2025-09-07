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

// Set to your Prize NFT address
const PRIZE_NFT      = "0x07A49d420eC876001Bc02FF3421114b9108Ba058" as const;

const TOKENS = [
  { symbol: "USDT",       address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
  { symbol: "cUSD",       address: "0x765de816845861e75a25fca122bb6898b8b1282a", decimals: 18 },
  { symbol: "AkibaMiles", address: MILES,                                         decimals: 18 },
] as const;
type Token = (typeof TOKENS)[number];

const RAFFLE_TYPES = [
  { label: "Single winner",  value: 0 },
  { label: "Triple winners", value: 1 },
  { label: "Quintuple",      value: 2 },
  { label: "Physical (NFT)", value: 3 },
] as const;

const FIXED_FEE_CELO = "0.011";

function getCreateInputsLen(abi: any): number {
  const frag = (abi as any[]).find((x) => x?.type === "function" && x?.name === "createRaffleRound");
  return frag?.inputs?.length ?? 0;
}

export default function CreateRaffleAndRandomize() {
  const pc = usePublicClient();
  const { writeContractAsync, status } = useWriteContract();
  const isPending = status === "pending";

  const inputsLen = useMemo(() => getCreateInputsLen(managerAbi), []);
  const isV3 = inputsLen >= 8;

  // form state
  const [raffleType, setRaffleType] = useState<number>(isV3 ? 3 : 0); // default to Physical if supported
  const [token, setToken] = useState<Token>(TOKENS[0]);
  const [reward, setReward] = useState("");
  const [rewardURI, setRewardURI] = useState("");
  const [startMin, setStartMin] = useState("0");

  // duration: days for digital; minutes for physical
  const [days, setDays] = useState("7");
  const [mins, setMins] = useState("30");

  const [maxTick, setMaxTick] = useState("1000");
  const [costPts, setCostPts] = useState("10");

  const [autoRequest, setAutoRequest] = useState(true);
  const [lastRoundId, setLastRoundId] = useState<string>("");

  const isPhysical = isV3 && raffleType === 3;
  const effectiveToken = isPhysical ? PRIZE_NFT : (token.address as `0x${string}`);

  const rewardValid = useMemo(() => {
    if (isPhysical) return true;
    const n = Number(reward);
    return Number.isFinite(n) && n > 0;
  }, [reward, isPhysical]);

  const rewardUriValid = useMemo(() => {
    if (!isPhysical) return true;
    return rewardURI.trim().length > 0;
  }, [isPhysical, rewardURI]);

  const durationValid = useMemo(() => {
    const n = Number(isPhysical ? mins : days);
    return Number.isFinite(n) && n > 0;
  }, [isPhysical, mins, days]);

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
      if (!durationValid) {
        alert(`Duration must be > 0 ${isPhysical ? "minutes" : "days"}.`);
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const startTs = now + Number(startMin || "0") * 60;
      const durSec = isPhysical
        ? Math.floor(Number(mins || "0") * 60)
        : Math.floor(Number(days || "0") * 86_400);

      const rewardWei = isPhysical ? 0n : parseUnits(reward || "0", token.decimals);
      const costWei = parseUnits(costPts || "0", 18);

      // Approve if using ERC20 reward (not Miles, not NFT, not Physical)
      const needsApprove = !isPhysical && effectiveToken.toLowerCase() !== MILES.toLowerCase();
      if (needsApprove) {
        await writeContractAsync({
          abi: erc20Abi,
          address: effectiveToken,
          functionName: "approve",
          args: [RAFFLE_MANAGER, rewardWei],
        });
      }

      const argsV3: readonly [
        bigint, bigint, bigint, `0x${string}`, number, bigint, bigint, string
      ] = [
        BigInt(startTs),
        BigInt(durSec),
        BigInt(maxTick),
        effectiveToken,
        Number(raffleType),
        BigInt(rewardWei),
        BigInt(costWei),
        rewardURI || "",
      ];

      const argsV2: readonly [
        bigint, bigint, bigint, `0x${string}`, bigint, bigint
      ] = [
        BigInt(startTs),
        BigInt(durSec),
        BigInt(maxTick),
        token.address as `0x${string}`,
        BigInt(rewardWei),
        BigInt(costWei),
      ];

      const txHash = await writeContractAsync({
        abi: managerAbi,
        address: RAFFLE_MANAGER,
        functionName: "createRaffleRound",
        args: (isV3 ? argsV3 : argsV2) as any,
      });

      const receipt = await pc!.waitForTransactionReceipt({ hash: txHash as Hex });

      // extract roundId from event
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
        } catch {}
      }
      if (!roundId) {
        const counter = await pc!.readContract({
          address: RAFFLE_MANAGER,
          abi: managerAbi,
          functionName: "roundIdCounter",
        });
        roundId = counter as bigint;
      }
      setLastRoundId(roundId?.toString() ?? "");

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

      if (isPhysical) setReward("0");
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Transaction failed");
    }
  }

  const submitDisabled = isPending || !rewardValid || !rewardUriValid || !durationValid;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <Card title="Create Raffle (and optionally request randomness)">
        {!isV3 && (
          <p className="mb-4 text-xs text-amber-600">
            Connected contract exposes 6-arg <code>createRaffleRound</code> (v2). Physical raffles and
            <code> raffleType</code>/<code>rewardURI</code> are not supported by this address/ABI.
          </p>
        )}

        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {/* Raffle Type + Reward URI (only for v3) */}
          {isV3 && (
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
              <div>
                <Label htmlFor="ruri">
                  Reward metadata URI{isPhysical ? " (required for Physical)" : " (optional)"}
                </Label>
                <Input
                  id="ruri"
                  placeholder="ipfs://… or https://…"
                  value={rewardURI}
                  onChange={(e) => setRewardURI(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Token + Reward */}
          <div className="grid grid-cols-2 gap-4">
            {isV3 && isPhysical ? (
              <div>
                <Label>Prize NFT (fixed)</Label>
                <Input value={PRIZE_NFT} readOnly />
              </div>
            ) : (
              <div>
                <Label htmlFor="token">Reward token</Label>
                <select
                  id="token"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={token.symbol}
                  onChange={(e) => setToken(TOKENS.find((t) => t.symbol === e.target.value)!)}
                >
                  {TOKENS.map((t) => (
                    <option key={t.symbol} value={t.symbol}>
                      {t.symbol}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label htmlFor="reward">
                {isV3 && isPhysical ? "Reward pool (ignored for Physical)" : `Reward pool (${token.symbol})`}
              </Label>
              <Input
                id="reward"
                placeholder={isV3 && isPhysical ? "0" : "e.g. 500"}
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                disabled={isV3 && isPhysical}
              />
            </div>
          </div>

          {/* Timing */}
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

            {/* Duration switches units based on type */}
            {isPhysical ? (
              <div>
                <Label htmlFor="durationMins">Duration (minutes)</Label>
                <div className="flex gap-2">
                  <Input
                    id="durationMins"
                    placeholder="30"
                    value={mins}
                    onChange={(e) => setMins(e.target.value)}
                  />
                  <div className="flex items-center gap-1">
                    {[15, 30, 45, 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        className="text-xs border rounded px-2 py-1 hover:bg-muted"
                        onClick={() => setMins(String(m))}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="durationDays">Duration (days)</Label>
                <Input
                  id="durationDays"
                  placeholder="7"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Tickets */}
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

          {/* Randomness */}
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
