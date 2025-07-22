// app/dashboard/draw/page.tsx
"use client";

import { useState } from "react";
import { useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { useAdminRounds } from "@/hooks/useAdminRounds";
import AdminRoundRow from "@/components/admin-round-row";
import abi from "@/lib/abi/RaffleManager.json";
import { RAFFLE_MANAGER } from "@/lib/raffle-contract";

export default function DrawPage() {
  const { data, isLoading, isError, refetch } = useAdminRounds();
  const { writeContractAsync } = useWriteContract();
  const [drawingId, setDrawingId] = useState<number | null>(null);

  const draw = async (id: number) => {
    try {
      setDrawingId(id);
      await writeContractAsync({
        address: RAFFLE_MANAGER,
        abi: abi.abi,
        functionName: "drawWinner",
        args: [BigInt(id)],
      });
      alert(`Winner drawn for #${id} 🎉`);
      await refetch();
    } catch (e: any) {
      alert(e?.message ?? "Draw failed");
    } finally {
      setDrawingId(null);
    }
  };

  return (
    <main className="p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Draw Winners</h1>
      <p className="text-sm text-gray-600">
        Manage active and ended raffles. Draw a winner once a round is ended or max tickets reached.
      </p>

      {isLoading && <p>Loading raffles…</p>}
      {isError && <p className="text-red-600">Failed to load raffles.</p>}

      {!isLoading && data && data.length === 0 && (
        <p>No rounds found.</p>
      )}

      <div className="space-y-3">
        {data?.map((r) => (
          <AdminRoundRow
            key={r.id}
            round={r}
            onDraw={draw}
            drawing={drawingId === r.id}
          />
        ))}
      </div>

      <Button variant="default" size="sm" onClick={() => refetch()}>
        Refresh
      </Button>
    </main>
  );
}
