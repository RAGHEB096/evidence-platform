import { expect, test, type Page } from '@playwright/test'
import { adminApi, arrangeProtocol, failOnPageErrors } from './support'

const suffix = Date.now().toString(36)

async function setStatus(page: Page, label: string) {
  await page.getByRole('button', { name: /Protocol status: .* Change status/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: `Set to ${label}` }).click()
  await expect(page.getByRole('button', { name: `Protocol status: ${label}. Change status` })).toBeVisible()
}

async function record(page: Page, stepLabel: string, status: string) {
  const card = page.getByRole('region', { name: stepLabel, exact: true })
  await card.getByLabel('Status').click()
  await page.getByRole('option', { name: status }).click()
  await card.getByRole('button', { name: 'Save result' }).click()
  await expect(page.getByText(`Result for ${stepLabel.toLowerCase()} saved`)).toBeVisible()
}

test('releasing locks the structure; statuses roll up from sub-steps to the chapter', async ({ page }) => {
  const assertNoErrors = failOnPageErrors(page)
  const reference = `LC-${suffix}`.toUpperCase()
  const api = await adminApi()
  const a = await arrangeProtocol(api, reference, [{ description: 'Log in.', expected: 'The dashboard opens.' }])
  for (const description of ['Enter the username.', 'Enter the password.']) {
    await api.from('test_steps').insert({ protocol_id: a.protocolId, test_run_id: a.testRunId, parent_step_id: a.stepIds[0], description })
  }

  await page.goto(`/protocols/${a.protocolId}`)
  const chapterRow = page.getByRole('group', { name: 'chapter 1 SMT Line 1' })
  await expect(chapterRow).toContainText('Not Started')
  await expect(page.getByRole('button', { name: 'Add chapter' })).toBeVisible()

  // Release: the structure locks.
  await setStatus(page, 'Released')
  await expect(page.getByText(/This protocol is released: its structure and details are locked/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add chapter' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Details' }).click()
  await expect(page.getByLabel('Name')).toHaveAttribute('readonly', '')
  await page.getByRole('tab', { name: 'Structure' }).click()

  // Execution stays open; the parent step follows its sub-steps.
  await page.getByRole('link', { name: 'Record results for test run 1.1.1 Test Run 001' }).click()
  const parent = page.getByRole('region', { name: 'Step 1', exact: true })
  await expect(parent.getByText('Follows its sub-steps')).toBeVisible()
  await record(page, 'Step 1.1', 'Passed')
  await expect(parent.getByText('In Progress').first()).toBeVisible()
  await expect(page.getByText('1 of 2 steps executed · 1 passed')).toBeVisible()
  await record(page, 'Step 1.2', 'Passed')
  await expect(parent.getByText('Passed').first()).toBeVisible()
  await expect(page.getByText('2 of 2 steps executed · 2 passed')).toBeVisible()

  // Every level above shows the rolled-up status.
  await page.getByRole('link', { name: new RegExp(`${reference} —`) }).click()
  for (const label of ['chapter 1 SMT Line 1', 'function 1.1 Barcode Verification', 'test run 1.1.1 Test Run 001', 'step 1']) {
    await expect(page.getByRole('group', { name: label, exact: true }), label).toContainText('Passed')
  }

  // Back to draft unlocks editing.
  await setStatus(page, 'Draft')
  await expect(page.getByRole('button', { name: 'Add chapter' })).toBeVisible()
  assertNoErrors()
})
