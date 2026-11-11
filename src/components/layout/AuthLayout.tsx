import { ShieldCheckIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Centred card used by the signed-out pages. */
export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon aria-hidden="true" className="size-4" />
          </div>
          Evidence Platform
        </div>
        <div className="space-y-5 rounded-xl border bg-background p-6 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
