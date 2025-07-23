'use client'
import Link          from 'next/link'
import { usePathname } from 'next/navigation'
import { cn }        from '@/lib/utils'
import ConnectButton from '@/components/ConnectButton'

const tabs = [
  { href: '/dashboard',        label: 'Create'  },
  { href: '/dashboard/random', label: 'Random'  },
  { href: '/dashboard/draw',   label: 'Draw'    },
  { href: '/dashboard/past-raffles',   label: 'Past Raffles'    },
]

export default function AdminNav() {
  const path = usePathname()
  return (
    <nav className="mb-6 flex gap-2">
      {tabs.map(t => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            'rounded-t-lg px-4 py-2 text-sm',
            path.startsWith(t.href)
              ? 'bg-white font-semibold shadow'
              : 'bg-gray-200 hover:bg-gray-300',
          )}
        >
          {t.label}
        </Link>
      ))}
       <ConnectButton />
    </nav>
  )
}
