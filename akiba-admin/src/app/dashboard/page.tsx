// app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUnits, decodeEventLog, erc20Abi, type Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Card from "@/components/Card";
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

// 🔔 Fire-and-forget call to our Telegram announce API
async function notifyTelegramRoundCreated(payload: any) {
  try {
    console.log("Notifying Telegram raffle-started API with payload:", payload);
    const res = await fetch("/api/admin/raffle-started", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("raffle-started API returned non-OK", res.status);
    }
  } catch (err) {
    console.error("Failed to call /api/admin/raffle-started", err);
  }
}

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
  const [cardTitle, setCardTitle] = useState("");
const [description, setDescription] = useState("");
const [cardImageUrl, setCardImageUrl] = useState("");
const [prizeTitle, setPrizeTitle] = useState("");
const [winners, setWinners] = useState("1");

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
        } catch {
          // ignore decode failures for other events
        }
      }

      const roundIdStr = roundId?.toString() ?? "";
      setLastRoundId(roundIdStr);

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

      // 5) notify Telegram (fire-and-forget)
      if (roundId) {
        const payload = {
          roundId: roundIdStr,
          raffleType,
          isPhysical,
          tokenSymbol: displayToken.symbol,
          tokenAddress: tokenAddr,
          rewardHuman: isPhysical ? "Physical prize" : reward,
          rewardWei: rewardWei.toString(),
          ticketCostMiles: costPts,
          maxTickets: maxTick,
          startTime: startTs,
          durationSeconds: durSec,
          rewardURI: rewardURI || null,
        };
        void notifyTelegramRoundCreated(payload);
      }

      if (roundId) {
        const metaPayload = {
          roundId: Number(roundId),
          kind: isPhysical ? "physical" : "token",
          cardTitle: cardTitle || null,
          description: description || null,
          cardImageUrl: cardImageUrl || null,
          prizeTitle:
            prizeTitle ||
            (isPhysical
              ? "Physical prize"
              : `${reward || "0"} ${displayToken.symbol}`),
          winners: winners ? Number(winners) : (raffleType === 2 ? 5 : raffleType === 1 ? 3 : 1),
        };
      
        try {
          await fetch("/api/admin/raffles/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metaPayload),
          });
        } catch (err) {
          console.error("Failed to save raffle_meta", err);
          // you can still continue; on-chain round is fine, UI will just fall back
        }
      }
      

      alert(
        `Round #${roundIdStr || "?"} created${
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

          {/* UI metadata (off-chain) */}
<div className="border-t pt-4 space-y-4">
  <h3 className="font-medium text-sm">Display / UI settings</h3>

  <div>
    <Label htmlFor="cardTitle">Card title</Label>
    <Input
      id="cardTitle"
      placeholder={isPhysical ? "e.g. JBL Tune 700BT Headphones" : "e.g. 500 USDT Weekly Jackpot"}
      value={cardTitle}
      onChange={(e) => setCardTitle(e.target.value)}
    />
    <p className="mt-1 text-xs text-gray-500">
      Shown on the raffle card. If empty, frontend falls back to "{`rewardPool token`}".
    </p>
  </div>

  <div>
    <Label htmlFor="desc">Description / blurb</Label>
    <Input
      id="desc"
      placeholder="Short description for the sheet"
      value={description}
      onChange={(e) => setDescription(e.target.value)}
    />
  </div>

  <div>
    <Label htmlFor="img">Card image URL</Label>
    <Input
      id="img"
      placeholder="https://... (Supabase bucket URL)"
      value={cardImageUrl}
      onChange={(e) => setCardImageUrl(e.target.value)}
    />
    <p className="mt-1 text-xs text-gray-500">
      Upload the image to Supabase and paste the public URL here.
    </p>
  </div>

  <div>
    <Label htmlFor="prizeTitle">Prize title (optional)</Label>
    <Input
      id="prizeTitle"
      placeholder={isPhysical ? "JBL Tune 700BT Wireless Over-Ear..." : "Optional override"}
      value={prizeTitle}
      onChange={(e) => setPrizeTitle(e.target.value)}
    />
  </div>

  <div>
    <Label htmlFor="winners">Number of winners</Label>
    <Input
      id="winners"
      type="number"
      min={1}
      placeholder="1"
      value={winners}
      onChange={(e) => setWinners(e.target.value)}
    />
    <p className="mt-1 text-xs text-gray-500">
      e.g. 1 for single winner, 3 for Top-3, 5 for Top-5.
    </p>
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
