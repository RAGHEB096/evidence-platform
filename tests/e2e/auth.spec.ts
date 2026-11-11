import { expect, test } from '@playwright/test'
import { adminCredentials, authEmailDomain, signIn } from './support'

test.use({ storageState: { cookies: [], origins: [] } })

test('invalid sign-in shows one generic message, whatever was wrong', async ({ page }) => {
  const admin = adminCredentials()
  const message = 'Incorrect username or password, or the account is not active.'

  await signIn(page, admin.username, 'Wrong-password-123')
  await expect(page.getByRole('alert')).toHaveText(message)

  await signIn(page, 'no.such.user', 'Wrong-password-123')
  await expect(page.getByRole('alert')).toHaveText(message)

  await signIn(page, 'Not A Valid Username!', 'x')
  await expect(page.getByRole('alert')).toHaveText(message)

  await expect(page.locator('body')).not.toContainText(authEmailDomain())
  await expect(page).toHaveURL(/\/login$/)
})

test('usernames are case-insensitive at sign-in', async ({ page }) => {
  const admin = adminCredentials()
  await signIn(page, `  ${admin.username.toUpperCase()} `, admin.password)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
})

test('signed-out visitors are sent to the sign-in page', async ({ page }) => {
  await page.goto('/protocols')
  await expect(page).toHaveURL(/\/login$/)
})
