import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, isNavItemActive, visibleNavItems } from '@/components/layout/nav'

describe('navigation', () => {
  it('lists the sections from SPEC 4.1 in order', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Dashboard',
      'Protocols',
      'Evidence Library',
      'Generated Documents',
      'User Management',
      'Settings',
    ])
  })

  it('hides User Management from non-administrators', () => {
    expect(visibleNavItems(false).map((item) => item.label)).not.toContain('User Management')
    expect(visibleNavItems(true).map((item) => item.label)).toContain('User Management')
  })

  it('marks the dashboard active only on the root path', () => {
    const dashboard = NAV_ITEMS[0]!
    expect(isNavItemActive(dashboard, '/')).toBe(true)
    expect(isNavItemActive(dashboard, '/protocols')).toBe(false)
  })

  it('marks a section active on its sub-routes but not on look-alike paths', () => {
    const protocols = NAV_ITEMS[1]!
    expect(isNavItemActive(protocols, '/protocols/abc')).toBe(true)
    expect(isNavItemActive(protocols, '/protocols-old')).toBe(false)
  })
})
