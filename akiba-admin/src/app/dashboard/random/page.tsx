'use client'

import { useState } from 'react'
import { parseEther } from 'viem'
import { useWriteContract } from 'wagmi'
import { Input }  from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Card       from '@/components/Card'
import managerAbiArtifact from '@/lib/abi/RaffleManager.json'


const RAFFLE_MANAGER = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29'


export default function RequestRandom() {
  const { writeContractAsync, status } = useWriteContract()
  const isPending = status === 'pending'

  const [roundId, setRoundId] = useState('')
  const [fee, setFee]         = useState('0.05') // CELO – matches RNG costs

  const request = async () => {
    try {
      await writeContractAsync({
        address: RAFFLE_MANAGER,
        abi: managerAbiArtifact.abi,
        functionName: 'requestRoundRandomness',
        args: [BigInt(roundId)],
        value: parseEther(fee),          // msg.value
      })
      alert('Randomness requested 🎲')
      setRoundId('')
    } catch (e) {
      console.error(e)
      alert('Transaction failed')
    }
  }

  return (
    <Card title="Select Random Number">
      <div className="space-y-4">
        <Input
          placeholder="Round ID"
          value={roundId}
          onChange={e => setRoundId(e.target.value)}
        />
        <Input
          placeholder="Fee in CELO (msg.value)"
          value={fee}
          onChange={e => setFee(e.target.value)}
        />
        <Button
          onClick={request}
          disabled={isPending || !roundId}
        >
          {isPending ? 'Requesting…' : 'Request VRF'}
        </Button>
      </div>
    </Card>
  )
}
