import { ChevronsUpDownIcon, LogOutIcon, SettingsIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

/** Shows the display name and username only — never the Auth email. */
export function UserMenu() {
  const { profile, signOut } = useAuth()
  if (!profile) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label="Account menu">
              <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
                {initials(profile.display_name)}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{profile.display_name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {profile.username}
                  {profile.is_admin ? ' · Administrator' : ''}
                </span>
              </div>
              <ChevronsUpDownIcon aria-hidden="true" className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{profile.display_name}</div>
              <div className="text-xs text-muted-foreground">{profile.username}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <SettingsIcon aria-hidden="true" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOutIcon aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
