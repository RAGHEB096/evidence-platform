import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, type Page } from '@playwright/test'

export const ADMIN_STATE = 'playwright/.auth/admin.json'
const ADMIN_CREDENTIALS = 'playwright/.auth/admin-credentials.json'

export interface Credentials {
  username: string
  password: string
  displayName: string
}

export function newPassword(): string {
  return `E2e-${randomBytes(9).toString('base64url')}7x`
}

export function saveAdminCredentials(credentials: Credentials) {
  mkdirSync(dirname(ADMIN_CREDENTIALS), { recursive: true })
  writeFileSync(ADMIN_CREDENTIALS, JSON.stringify(credentials))
}

export function adminCredentials(): Credentials {
  return JSON.parse(readFileSync(ADMIN_CREDENTIALS, 'utf8')) as Credentials
}

export function setupToken(): string {
  const match = /^SETUP_TOKEN=(.+)$/m.exec(readFileSync('supabase/functions/.env', 'utf8'))
  if (!match) throw new Error('SETUP_TOKEN is missing from supabase/functions/.env')
  return match[1]!.trim()
}

export function authEmailDomain(): string {
  const match = /^AUTH_EMAIL_DOMAIN=(.+)$/m.exec(readFileSync('supabase/functions/.env', 'utf8'))
  return match![1]!.trim()
}

/** Fails the test if the page throws an uncaught error. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return () => expect(errors, 'uncaught page errors').toEqual([])
}

export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}
