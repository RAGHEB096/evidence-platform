import { expect, test } from '@playwright/test'
import { adminApi, arrangeProtocol, failOnPageErrors, newPassword, signIn, signOut } from './support'

const suffix = Date.now().toString(36)

test('dashboard shows figures and execution progress; the audit trail shows what changed', async ({ page }) => {
  const assertNoErrors = failOnPageErrors(page)
  const reference = `DB-${suffix}`.toUpperCase()
  const api = await adminApi()
  const a = await arrangeProtocol(api, reference, [
    { description: 'Open the application.', expected: 'It opens.' },
    { description: 'Close the application.', expected: 'It closes.' },
  ])
  await api.rpc('record_step_result', { p_step_id: a.stepIds[0], p_actual_result: 'Opened.', p_status: 'passed', p_comments: '' })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Figures across every protocol.')).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(reference) })
  await expect(row).toContainText('1 of 2 executed · 1 passed')
  await expect(row).toContainText('Draft')
  await expect(page.getByRole('heading', { name: 'File storage' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
  await expect(page.getByText('recorded a step result').first()).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit Trail' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Audit Trail' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Event type' }).click()
  await page.getByRole('option', { name: 'Recorded a step result' }).click()
  const first = page.getByRole('row', { name: /recorded a step result/ }).first()
  await expect(first).toContainText(reference)
  await first.getByRole('button', { name: /Show details/ }).click()
  const details = page.getByRole('row', { name: /status/ }).first()
  await expect(details).toContainText('not_started')
  await expect(details).toContainText('passed')
  assertNoErrors()
})

test('administrators change application limits; they persist', async ({ page }) => {
  await page.goto('/settings')
  const longEdge = page.getByLabel('Maximum embedded image size (px)')
  await longEdge.fill('2400')
  await page.getByRole('button', { name: 'Save application settings' }).click()
  await expect(page.getByText('Application settings saved')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Maximum embedded image size (px)')).toHaveValue('2400')

  await page.getByLabel('Upload size limit (MB)').fill('80')
  await page.getByRole('button', { name: 'Save application settings' }).click()
  await expect(page.getByText(/At most 50 MB/)).toBeVisible()

  await page.getByLabel('Upload size limit (MB)').fill('20')
  await page.getByLabel('Maximum embedded image size (px)').fill('2000')
  await page.getByRole('button', { name: 'Save application settings' }).click()
  await expect(page.getByText('Application settings saved')).toBeVisible()
})

test('a user changes their display name and password in Settings', async ({ browser }) => {
  const api = await adminApi()
  const username = `settings.${suffix}`
  const initial = newPassword()
  const { error } = await api.functions.invoke('admin-users', { body: { action: 'create', username, displayName: 'Sam Settings', password: initial } })
  expect(error).toBeNull()

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await signIn(page, username, initial)
  const chosen = newPassword()
  await page.getByLabel('New password', { exact: true }).fill(chosen)
  await page.getByLabel('Confirm new password').fill(chosen)
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Audit Trail' })).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Application settings' })).toHaveCount(0)
  await page.getByLabel('Display name').fill('Samantha Settings')
  await page.getByRole('button', { name: 'Save display name' }).click()
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText('Samantha Settings')

  const next = newPassword()
  await page.getByLabel('Current password').fill('not-my-password-1')
  await page.getByLabel('New password', { exact: true }).fill(next)
  await page.getByLabel('Confirm new password').fill(next)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toHaveText('Your current password is not correct.')

  await page.getByLabel('Current password').fill(chosen)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed')).toBeVisible()

  await signOut(page)
  await signIn(page, username, next)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await context.close()
})
