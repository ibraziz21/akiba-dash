// app/dashboard/draw/page.tsx
'use client'
import { useState } from 'react'
import { useWriteContract } from 'wagmi'
import abi from '@/lib/abi/RaffleManager.json'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const RAFFLE_MANAGER = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29'

export default function DrawWinner() {
  const { writeContractAsync, isPending } = useWriteContract()
  const [roundId, setRound] = useState('')

  const draw = () =>
    writeContractAsync({
      address: RAFFLE_MANAGER,
      abi: abi.abi,
      functionName: 'drawWinner',
      args: [BigInt(roundId)],
    }).then(() => alert('Winner drawn 🎉'))

  return (
    <section className="p-6 bg-white rounded-lg shadow">
      <h1 className="text-xl font-bold mb-4">Draw Winner</h1>
      <Input
        placeholder="Round ID"
        value={roundId}
        onChange={e => setRound(e.target.value)}
      />
      <Button onClick={draw} disabled={isPending || !roundId}>
        {isPending ? 'Drawing…' : 'Draw'}
      </Button>
    </section>
  )
}
