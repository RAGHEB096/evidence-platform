import { expect, test } from '@playwright/test'
import {
  ADMIN_STATE,
  authEmailDomain,
  failOnPageErrors,
  newPassword,
  saveAdminCredentials,
  setupToken,
  signIn,
  signOut,
} from './support'

// Runs first (the other projects depend on it) against a freshly reset database.
test('first-time setup creates an administrator who can sign in, and then disappears', async ({ page }) => {
  const assertNoErrors = failOnPageErrors(page)
  const admin = { username: 'e2e.admin', password: newPassword(), displayName: 'E2E Administrator' }

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('link', { name: 'Run first-time setup' }).click()
  await expect(page.getByRole('heading', { name: 'First-time setup' })).toBeVisible()

  // A wrong token is refused with a plain message.
  await page.getByLabel('Setup token').fill('wrong-token')
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Display name').fill(admin.displayName)
  await page.getByLabel('Password', { exact: true }).fill(admin.password)
  await page.getByLabel('Confirm password').fill(admin.password)
  await page.getByRole('button', { name: 'Create administrator' }).click()
  await expect(page.getByRole('alert')).toHaveText('The setup token is not correct.')

  await page.getByLabel('Setup token').fill(setupToken())
  await page.getByRole('button', { name: 'Create administrator' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText(admin.displayName)
  await expect(page.getByRole('link', { name: 'User Management' })).toBeVisible()
  // The synthetic email never reaches the UI.
  await expect(page.locator('body')).not.toContainText(authEmailDomain())

  await signOut(page)
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('link', { name: 'Run first-time setup' })).toHaveCount(0)

  await signIn(page, admin.username, admin.password)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

  saveAdminCredentials(admin)
  await page.context().storageState({ path: ADMIN_STATE })
  assertNoErrors()
})
