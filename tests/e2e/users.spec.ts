import { expect, test, type Page } from '@playwright/test'
import { failOnPageErrors, newPassword, signIn } from './support'

const suffix = Date.now().toString(36)

async function createProtocol(page: Page, reference: string, name: string) {
  await page.goto('/protocols')
  await page.getByRole('button', { name: 'Create protocol' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create protocol' })
  await dialog.getByLabel('Reference').fill(reference)
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Create protocol' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('cell', { name: reference })).toBeVisible()
}

async function createUser(page: Page, username: string, displayName: string): Promise<string> {
  await page.goto('/users')
  await page.getByRole('button', { name: 'Create user' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create user' })
  await dialog.getByLabel('Username').fill(username)
  await dialog.getByLabel('Display name').fill(displayName)
  const password = await dialog.getByLabel('Initial password').inputValue()
  expect(password.length).toBeGreaterThanOrEqual(10)
  await dialog.getByRole('button', { name: 'Create user' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('cell', { name: new RegExp(displayName) })).toBeVisible()
  return password
}

test('an administrator creates a user, assigns a role, and the user signs in with it', async ({ page, browser }) => {
  const assertNoErrors = failOnPageErrors(page)
  const reference = `OQ-${suffix}`.toUpperCase()
  const username = `tester.${suffix}`
  await createProtocol(page, reference, 'MES functional qualification')
  const initialPassword = await createUser(page, username, 'Terry Tester')

  // Grant access, then change the role.
  await page.getByRole('link', { name: `Manage ${username}` }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Terry Tester' })).toBeVisible()
  await expect(page.getByText('Must change password')).toBeVisible()
  await page.getByRole('button', { name: 'Add access' }).click()
  const addDialog = page.getByRole('dialog', { name: 'Add protocol access' })
  await addDialog.getByRole('combobox', { name: 'Protocol' }).click()
  await page.getByRole('option', { name: new RegExp(reference) }).click()
  await addDialog.getByRole('combobox', { name: 'Role' }).click()
  await page.getByRole('option', { name: 'Tester' }).click()
  await addDialog.getByRole('button', { name: 'Grant access' }).click()
  await expect(addDialog).toBeHidden()
  const accessRow = page.getByRole('row', { name: new RegExp(reference) })
  await expect(accessRow.getByRole('combobox', { name: 'Role' })).toHaveText('Tester')

  await accessRow.getByRole('combobox', { name: 'Role' }).click()
  await page.getByRole('option', { name: 'Viewer' }).click()
  await expect(accessRow.getByRole('combobox', { name: 'Role' })).toHaveText('Viewer')

  // The new user signs in, is made to choose a password, then sees only what they were given.
  const userContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const userPage = await userContext.newPage()
  const assertNoUserErrors = failOnPageErrors(userPage)
  await signIn(userPage, username, initialPassword)
  await expect(userPage.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  const chosen = newPassword()
  await userPage.getByLabel('New password', { exact: true }).fill(chosen)
  await userPage.getByLabel('Confirm new password').fill(chosen)
  await userPage.getByRole('button', { name: 'Save password' }).click()
  await expect(userPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

  await expect(userPage.getByRole('link', { name: 'User Management' })).toHaveCount(0)
  await userPage.goto('/users')
  await expect(userPage).toHaveURL(/\/$/)
  await userPage.goto('/protocols')
  await expect(userPage.getByRole('cell', { name: reference })).toBeVisible()
  await expect(userPage.getByRole('button', { name: 'Create protocol' })).toHaveCount(0)
  assertNoUserErrors()

  // Deactivation ends their access and blocks sign-in.
  await page.getByRole('button', { name: 'Deactivate' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click()
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible()

  await userPage.reload()
  await expect(userPage.getByRole('cell', { name: reference })).toHaveCount(0)
  await userContext.clearCookies()
  await userPage.evaluate(() => window.localStorage.clear())
  await signIn(userPage, username, chosen)
  await expect(userPage.getByRole('alert')).toHaveText('Incorrect username or password, or the account is not active.')

  await userContext.close()
  assertNoErrors()
})

test('a user without protocol access sees an explanation, not an error', async ({ page, browser }) => {
  const username = `nobody.${suffix}`
  const initialPassword = await createUser(page, username, 'Nora Nobody')

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const userPage = await context.newPage()
  await signIn(userPage, username, initialPassword)
  const chosen = newPassword()
  await userPage.getByLabel('New password', { exact: true }).fill(chosen)
  await userPage.getByLabel('Confirm new password').fill(chosen)
  await userPage.getByRole('button', { name: 'Save password' }).click()
  await expect(userPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await userPage.goto('/protocols')
  await expect(userPage.getByText('You are not assigned to any protocol yet.', { exact: false })).toBeVisible()
  await context.close()
})
