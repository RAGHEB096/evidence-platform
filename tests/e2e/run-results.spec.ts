import { expect, test } from '@playwright/test'
import { adminApi, arrangeProtocol, failOnPageErrors } from './support'

const suffix = Date.now().toString(36)

test('chapters number from the protocol setting; a test run without steps records its own result', async ({ page }) => {
  const assertNoErrors = failOnPageErrors(page)
  const reference = `RR-${suffix}`.toUpperCase()
  const api = await adminApi()
  const a = await arrangeProtocol(api, reference, [])
  await api.from('test_runs').update({ expected_result: 'The label is legible.' }).eq('id', a.testRunId)

  // First chapter number.
  await page.goto(`/protocols/${a.protocolId}`)
  await page.getByRole('tab', { name: 'Details' }).click()
  await page.getByLabel('First chapter number').fill('11')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Protocol details saved')).toBeVisible()
  await page.getByRole('tab', { name: 'Structure' }).click()
  await expect(page.getByRole('group', { name: 'chapter 11 SMT Line 1' })).toBeVisible()
  const runRow = page.getByRole('group', { name: 'test run 11.1.1 Test Run 001', exact: true })
  await expect(runRow).toContainText('Expected: The label is legible.')
  await expect(runRow).toContainText('Not Started')

  // Record the run's own result.
  await page.getByRole('link', { name: 'Record results for test run 11.1.1 Test Run 001' }).click()
  const card = page.getByRole('region', { name: 'Test run result' })
  await expect(card).toContainText('The label is legible.')
  await card.getByLabel('Actual result').fill('Legible on all labels.')
  await card.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Passed' }).click()
  await card.getByRole('button', { name: 'Save result' }).click()
  await expect(page.getByText('Test run result saved')).toBeVisible()
  await expect(card.getByText(/Last recorded .* by E2E Administrator/)).toBeVisible()

  // It rolls up like any other result.
  await page.getByRole('link', { name: new RegExp(`${reference} —`) }).click()
  await expect(page.getByRole('group', { name: 'chapter 11 SMT Line 1' })).toContainText('Passed')
  assertNoErrors()
})
