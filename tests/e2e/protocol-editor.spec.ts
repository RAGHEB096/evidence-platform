import { expect, test, type Page } from '@playwright/test'
import { adminCredentials, failOnPageErrors, newPassword, signIn, signOut } from './support'

const suffix = Date.now().toString(36)

/** Labels of every visible node row, top to bottom. */
async function outline(page: Page) {
  return page.locator('[data-node-type]').evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))
}

async function addNode(page: Page, button: { name: string } | string, fields: Record<string, string>, submit: string) {
  await page.getByRole('button', { name: typeof button === 'string' ? button : button.name, exact: true }).click()
  const dialog = page.getByRole('dialog')
  for (const [label, value] of Object.entries(fields)) await dialog.getByLabel(label, { exact: true }).fill(value)
  await dialog.getByRole('button', { name: submit }).click()
  await expect(dialog).toBeHidden()
}

test('build, edit, reorder, duplicate, archive and restore the hierarchy; it persists across sign-in', async ({ page }) => {
  const assertNoErrors = failOnPageErrors(page)
  const reference = `ED-${suffix}`.toUpperCase()

  await page.goto('/protocols')
  await page.getByRole('button', { name: 'Create protocol' }).click()
  const create = page.getByRole('dialog', { name: 'Create protocol' })
  await create.getByLabel('Reference').fill(reference)
  await create.getByLabel('Name').fill('Editor protocol')
  await create.getByRole('button', { name: 'Create protocol' }).click()
  await page.getByRole('link', { name: 'Editor protocol' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Editor protocol' })).toBeVisible()
  await expect(page.getByText('No chapters yet')).toBeVisible()

  // Build: two chapters, a function, a test run, two steps and a sub-step.
  await addNode(page, 'Add chapter', { Title: 'SMT Line 1' }, 'Add chapter')
  await addNode(page, 'Add chapter', { Title: 'SMT Line 2' }, 'Add chapter')
  await addNode(page, { name: 'Add function to chapter 1 SMT Line 1' }, { Title: 'Barcode Verification' }, 'Add function')
  await addNode(page, { name: 'Add test run to function 1.1 Barcode Verification' }, { Reference: 'TR-001', Title: 'Test Run 001' }, 'Add test run')
  await addNode(
    page,
    { name: 'Add step to test run 1.1.1 Test Run 001' },
    { Instruction: 'Open the application.', 'Expected result': 'The application opens successfully.' },
    'Add step',
  )
  await addNode(page, { name: 'Add step to test run 1.1.1 Test Run 001' }, { Instruction: 'Scan a barcode.' }, 'Add step')
  await addNode(page, { name: 'Add sub-step to step 1' }, { Instruction: 'Enter the username.' }, 'Add step')

  expect(await outline(page)).toEqual([
    'chapter 1 SMT Line 1',
    'function 1.1 Barcode Verification',
    'test run 1.1.1 Test Run 001',
    'step 1',
    'step 1.1',
    'step 2',
    'chapter 2 SMT Line 2',
  ])
  await expect(page.getByText('Expected: The application opens successfully.')).toBeVisible()

  // Edit.
  await page.getByRole('button', { name: 'Actions for chapter 2 SMT Line 2' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Title').fill('Packaging')
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('group', { name: 'chapter 2 Packaging' })).toBeVisible()

  // Reorder with the keyboard-accessible buttons…
  await page.getByRole('button', { name: 'Move chapter 2 Packaging up' }).click()
  await expect(page.getByRole('group', { name: 'chapter 1 Packaging' })).toBeVisible()
  // …and by dragging with the keyboard (Space to lift, arrow to move, Space to drop).
  const handle = page.getByRole('button', { name: 'Drag to reorder chapter 1 Packaging' })
  await handle.focus()
  // dnd-kit's keyboard sensor reacts across animation frames; give it a moment between keys.
  for (const key of ['Space', 'ArrowDown', 'Space']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(200)
  }
  await expect(page.getByRole('group', { name: 'chapter 2 Packaging' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'chapter 1 SMT Line 1' })).toBeVisible()

  // Sub-steps reorder among themselves only.
  await addNode(page, { name: 'Add sub-step to step 1' }, { Instruction: 'Enter the password.' }, 'Add step')
  await expect(page.getByRole('button', { name: 'Move step 1.2 down' })).toBeDisabled()
  await page.getByRole('button', { name: 'Move step 1.2 up' }).click()
  await expect(page.getByRole('group', { name: 'step 1.1' })).toContainText('Enter the password.')

  // Duplicate a function with everything beneath it.
  await page.getByRole('button', { name: 'Actions for function 1.1 Barcode Verification' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByRole('group', { name: 'function 1.2 Barcode Verification (copy)' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'test run 1.2.1 Test Run 001' })).toBeVisible()

  // Archive the copy: the dialog names what sits beneath it.
  await page.getByRole('button', { name: 'Actions for function 1.2 Barcode Verification (copy)' }).click()
  await page.getByRole('menuitem', { name: 'Archive…' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('1 test run and 4 steps')
  await confirm.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('group', { name: /Barcode Verification \(copy\)/ })).toHaveCount(0)

  // Administrators can see and restore archived items.
  await page.getByLabel('Show archived items').check()
  const archivedRow = page.getByRole('group', { name: 'function Barcode Verification (copy)' })
  await expect(archivedRow).toContainText('Archived')
  await page.getByRole('button', { name: 'Actions for function Barcode Verification (copy)' }).click()
  await page.getByRole('menuitem', { name: 'Restore' }).click()
  await expect(page.getByRole('group', { name: 'function 1.2 Barcode Verification (copy)' })).toBeVisible()
  await page.getByLabel('Show archived items').uncheck()

  const before = await outline(page)
  const url = page.url()

  // Persistence: sign out and back in; the structure is exactly as it was left.
  await signOut(page)
  const admin = adminCredentials()
  await signIn(page, admin.username, admin.password)
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await page.goto(url)
  await expect(page.getByRole('group', { name: 'chapter 1 SMT Line 1' })).toBeVisible()
  expect(await outline(page)).toEqual(before)

  await page.context().storageState({ path: 'playwright/.auth/admin.json' })
  assertNoErrors()
})

test('a user who is not assigned to a protocol is refused it, even by direct address', async ({ page, browser }) => {
  const reference = `PRIV-${suffix}`.toUpperCase()
  await page.goto('/protocols')
  await page.getByRole('button', { name: 'Create protocol' }).click()
  const create = page.getByRole('dialog', { name: 'Create protocol' })
  await create.getByLabel('Reference').fill(reference)
  await create.getByLabel('Name').fill('Private protocol')
  await create.getByRole('button', { name: 'Create protocol' }).click()
  await page.getByRole('link', { name: 'Private protocol' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Private protocol' })).toBeVisible()
  const protocolUrl = new URL(page.url()).pathname

  await page.goto('/users')
  await page.getByRole('button', { name: 'Create user' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create user' })
  const username = `outsider.${suffix}`
  await dialog.getByLabel('Username').fill(username)
  await dialog.getByLabel('Display name').fill('Olive Outsider')
  const initial = await dialog.getByLabel('Initial password').inputValue()
  await dialog.getByRole('button', { name: 'Create user' }).click()
  await expect(dialog).toBeHidden()

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const outsider = await context.newPage()
  await signIn(outsider, username, initial)
  const chosen = newPassword()
  await outsider.getByLabel('New password', { exact: true }).fill(chosen)
  await outsider.getByLabel('Confirm new password').fill(chosen)
  await outsider.getByRole('button', { name: 'Save password' }).click()
  await expect(outsider.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

  await outsider.goto('/protocols')
  await expect(outsider.getByText(reference)).toHaveCount(0)
  await outsider.goto(protocolUrl)
  await expect(outsider.getByText('Protocol not available')).toBeVisible()
  await expect(outsider.getByText('Private protocol')).toHaveCount(0)
  await context.close()
})
