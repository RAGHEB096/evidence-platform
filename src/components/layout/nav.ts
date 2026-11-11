import {
  FileTextIcon,
  FolderKanbanIcon,
  ImagesIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Hidden from non-administrators. A UX nicety only: RLS is the control. */
  adminOnly?: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboardIcon },
  { label: 'Protocols', to: '/protocols', icon: FolderKanbanIcon },
  { label: 'Evidence Library', to: '/evidence', icon: ImagesIcon },
  { label: 'Generated Documents', to: '/documents', icon: FileTextIcon },
  { label: 'User Management', to: '/users', icon: UsersIcon, adminOnly: true },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
]

export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly)
}

/** The dashboard matches only itself; other items also match their sub-routes. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  return pathname === item.to || pathname.startsWith(item.to + '/')
}
