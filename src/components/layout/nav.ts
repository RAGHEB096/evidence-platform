import {
  FileTextIcon,
  FolderKanbanIcon,
  ImagesIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /**
   * Who sees the item: administrators only, or administrators and protocol
   * managers. A UX nicety only: RLS is the control.
   */
  audience?: 'admin' | 'manager'
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboardIcon },
  { label: 'Protocols', to: '/protocols', icon: FolderKanbanIcon },
  { label: 'Evidence Library', to: '/evidence', icon: ImagesIcon },
  { label: 'Generated Documents', to: '/documents', icon: FileTextIcon },
  { label: 'Audit Trail', to: '/audit', icon: ScrollTextIcon, audience: 'manager' },
  { label: 'User Management', to: '/users', icon: UsersIcon, audience: 'admin' },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
]

export function visibleNavItems(isAdmin: boolean, isManager = false): NavItem[] {
  return NAV_ITEMS.filter((item) => isAdmin || !item.audience || (item.audience === 'manager' && isManager))
}

/** The dashboard matches only itself; other items also match their sub-routes. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  return pathname === item.to || pathname.startsWith(item.to + '/')
}
