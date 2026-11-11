import { Outlet, useLocation, useNavigation } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { useMyRoles } from '@/features/protocols/my-roles'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { NAV_ITEMS, isNavItemActive } from '@/components/layout/nav'

export function AppLayout() {
  const { pathname } = useLocation()
  const { profile } = useAuth()
  // Lazy pages load before the URL changes; show that the click registered.
  const navigation = useNavigation()
  const roles = useMyRoles()
  const section = NAV_ITEMS.find((item) => isNavItemActive(item, pathname))

  return (
    <SidebarProvider>
      <AppSidebar isAdmin={profile?.is_admin ?? false} isManager={[...(roles.data?.values() ?? [])].includes('manager')} />
      <SidebarInset>
        {navigation.state === 'loading' ? (
          <div role="progressbar" aria-label="Loading page" className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary" />
        ) : null}
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
