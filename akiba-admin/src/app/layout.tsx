import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import AdminNav from '@/components/AdminNav'
import Providers from '@/app/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Akiba Dashboard',
  description: 'Akiba Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
      <Providers>
      <div className="min-h-screen bg-muted/20 pb-10">
        <div className="mx-auto max-w-3xl pt-8">
          <AdminNav />
          <div className="rounded-b-lg bg-white p-6 shadow">{children}</div>
        </div>
      </div>
    </Providers>
        </body>
    </html>
  )
}
