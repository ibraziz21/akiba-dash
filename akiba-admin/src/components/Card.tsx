import { cn } from '@/lib/utils'

export default function Card({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('rounded-lg bg-white p-6 shadow', className)}
    >
      <h1 className="mb-4 text-xl font-bold">{title}</h1>
      {children}
    </section>
  )
}
