import { Outlet, useLocation } from 'react-router'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { NAV_ITEMS, isNavItemActive } from '@/components/layout/nav'

export function AppLayout() {
  const { pathname } = useLocation()
  const section = NAV_ITEMS.find((item) => isNavItemActive(item, pathname))

  return (
    <SidebarProvider>
      {/* Phase 2 replaces this with the signed-in profile's is_admin flag. */}
      <AppSidebar isAdmin />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="text-sm font-medium text-muted-foreground">{section?.label ?? 'Evidence Platform'}</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
