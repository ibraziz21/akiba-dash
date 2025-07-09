/* app/providers.tsx */
'use client'

import { WagmiProvider, createConfig, http, injected } from 'wagmi'
import { celo, celoAlfajores }           from 'viem/chains'
import { ReactNode }                     from 'react'
import { Chain } from 'wagmi/chains'
import { QueryClient, QueryClientProvider }    from '@tanstack/react-query'

/** 1. Define the chains you want */
const chains: readonly [Chain, ...Chain[]] = [celoAlfajores, celo];

/** 2. Give wagmi an http() transport for each chain
 *    (use your own RPC URLs if you prefer)                          */
const transports = {
  [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
  [celo.id]:          http('https://forno.celo.org'),
}

/** 3. Create the wagmi config */
const config = createConfig({
  chains,
  transports,
  /* optional: autoConnect / connectors etc. */

  ssr: true,            // if you’re using Next.js app router
  connectors: [
    injected({ shimDisconnect: true }),              // ← here
    // you can add WalletConnect, Ledger, etc. later
  ],
})

const queryClient = new QueryClient()

export default function Providers({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
          <WagmiProvider config={config}>{children}</WagmiProvider>
        </QueryClientProvider>
      )
}
