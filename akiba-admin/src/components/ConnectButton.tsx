'use client'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Button } from '@/components/ui/button'

export default function ConnectButton() {
  const { address } = useAccount()
  const { connectAsync, connectors, status: connectStatus } = useConnect()
  const { disconnectAsync } = useDisconnect()

  const injectedConnector = connectors.find(c => c.id === 'injected')
  const isConnecting = connectStatus === 'pending'

  if (address)
    return (
      <Button variant="secondary" size="sm" onClick={() => disconnectAsync()}>
        {address.slice(0, 6)}…{address.slice(-4)} (Disconnect)
      </Button>
    )

  return (
    <Button
      size="sm"
      disabled={!injectedConnector || isConnecting}
      onClick={() => {
        if (!injectedConnector) return          // ① guard for TS
        connectAsync({ connector: injectedConnector }) // ② now defined
      }}
    >
      {isConnecting ? 'Connecting…' : 'Connect Wallet'}
    </Button>
  )
}
