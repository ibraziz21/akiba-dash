// app/dashboard/page.tsx
'use client'

import { useState } from 'react'
import { parseUnits,erc20Abi } from 'viem'
import {  useAccount, useWriteContract } from 'wagmi'

import { Label }  from '@/components/ui/label'
import { Input }  from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Card       from '@/components/Card'
import managerAbi from '@/lib/abi/RaffleManager.json'

/* ─── constants ───────────────────────────────────────────── */
const RAFFLE_MANAGER = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29'                             // ← set real addr
const MILES          = '0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b'

const TOKENS = [
  { symbol: 'USDT',        address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
  { symbol: 'cUSD',        address: '0x765de816845861e75a25fca122bb6898b8b1282a', decimals: 18 },
  { symbol: 'AkibaMiles',  address: MILES,                                           decimals: 18 },
] as const
type Token = (typeof TOKENS)[number]

/* ─── component ───────────────────────────────────────────── */
export default function CreateRaffle() {
  const { address } = useAccount()
  const { writeContractAsync, status } = useWriteContract()
  const isPending = status === 'pending'

  /* form state */
  const [reward,   setReward]   = useState('')
  const [token,    setToken]    = useState<Token>(TOKENS[0])
  const [startMin, setStartMin] = useState('0')
  const [days,     setDays]     = useState('7')
  const [maxTick,  setMaxTick]  = useState('1000')
  const [costPts,  setCostPts]  = useState('10')

  async function onSubmit() {
    try {
      const now      = Math.floor(Date.now() / 1_000)
      const startTs  = now + Number(startMin) * 60
      const durSec   = Number(days) * 86_400
      const rewardWei = parseUnits(reward, token.decimals)
      const costWei   = parseUnits(costPts, 18)

      /* approve if token ≠ AkibaMiles */
      if (token.address.toLowerCase() !== MILES.toLowerCase()) {
        await writeContractAsync({
          abi: erc20Abi,
          address: token.address,
          functionName: 'approve',
          args: [RAFFLE_MANAGER as `0x${string}`, rewardWei],
        })
      }

      await writeContractAsync({
        abi: managerAbi.abi as any,
        address: RAFFLE_MANAGER,
        functionName: 'createRaffleRound',
        args: [
          BigInt(startTs),
          BigInt(durSec),
          BigInt(maxTick),
          token.address as `0x${string}`,
          rewardWei,
          costWei,
        ],
      })

      alert('Raffle round created 🎉')
      setReward('')
    } catch (e) {
      console.error(e)
      alert('Transaction failed')
    }
  }

  return (
    <Card title="Create Raffle">
      <form
        className="space-y-6"
        onSubmit={e => {
          e.preventDefault()
          onSubmit()
        }}
      >
        {/* token + reward */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="token">Reward token</Label>
            <select
              id="token"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={token.symbol}
              onChange={e => setToken(TOKENS.find(t => t.symbol === e.target.value)!)}
            >
              {TOKENS.map(t => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              The ERC-20 that will be sent to the winner.
            </p>
          </div>

          <div>
            <Label htmlFor="reward">Reward pool ({token.symbol})</Label>
            <Input
              id="reward"
              placeholder="e.g. 500"
              value={reward}
              onChange={e => setReward(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Whole tokens; we’ll convert to wei/μ internally.
            </p>
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
              onChange={e => setStartMin(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="duration">Duration (days)</Label>
            <Input
              id="duration"
              placeholder="7"
              value={days}
              onChange={e => setDays(e.target.value)}
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
              onChange={e => setMaxTick(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cost">Ticket cost (AkibaMiles points)</Label>
            <Input
              id="cost"
              placeholder="10"
              value={costPts}
              onChange={e => setCostPts(e.target.value)}
            />
          </div>
        </div>

        <Button disabled={isPending || !address} type="submit">
          {isPending ? 'Submitting…' : 'Create Raffle'}
        </Button>
      </form>
    </Card>
  )
}
