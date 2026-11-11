import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { adminApi, arrangeProtocol, failOnPageErrors, fixture, uploadEvidenceApi } from './support'

const suffix = Date.now().toString(36)

test('select evidence from two chapters, generate the Word report, and find it in the history', async ({ page }) => {
  test.setTimeout(120_000)
  const assertNoErrors = failOnPageErrors(page)
  const reference = `RP-${suffix}`.toUpperCase()
  const api = await adminApi()

  // Arrange: chapter 1 with one step and two images; chapter 2 with one step and two images.
  const a = await arrangeProtocol(api, reference, [{ description: 'Open the application.', expected: 'The application opens successfully.' }])
  await api.rpc('record_step_result', { p_step_id: a.stepIds[0], p_actual_result: 'The application opened successfully.', p_status: 'passed', p_comments: '' })
  const insert = async (table: string, row: Record<string, unknown>) => (await api.from(table).insert(row).select('id').single()).data!.id as string
  const chapter2 = await insert('chapters', { protocol_id: a.protocolId, title: 'Packaging' })
  const fn2 = await insert('functions', { protocol_id: a.protocolId, chapter_id: chapter2, title: 'Label Printing' })
  const run2 = await insert('test_runs', { protocol_id: a.protocolId, function_id: fn2, reference: 'TR-002', title: 'Test Run 002' })
  const step2 = await insert('test_steps', { protocol_id: a.protocolId, test_run_id: run2, description: 'Print a label.', expected_result: 'The label prints.' })

  const target1 = { protocolId: a.protocolId, testRunId: a.testRunId, testStepId: a.stepIds[0]! }
  const target2 = { protocolId: a.protocolId, testRunId: run2, testStepId: step2 }
  await uploadEvidenceApi(api, target1, 'login.png', fixture('screenshot.png'), 'image/png', 'Login page')
  await uploadEvidenceApi(api, target1, 'unused.jpg', fixture('screenshot.jpg'), 'image/jpeg', 'UNSELECTED IMAGE CAPTION')
  await uploadEvidenceApi(api, target2, 'label-a.webp', fixture('screenshot.webp'), 'image/webp', 'Label A')
  await uploadEvidenceApi(api, target2, 'label-b.gif', fixture('pixel.gif'), 'image/gif', 'Label B')

  // Build the selection.
  await page.goto(`/protocols/${a.protocolId}`)
  await page.getByRole('link', { name: 'Build report' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Report builder' })).toBeVisible()
  const summary = page.getByRole('complementary', { name: 'Report summary' })

  const login = page.getByRole('checkbox', { name: /login\.png/ })
  await login.click()
  await expect(login).toBeChecked()
  const chapter2All = page.getByRole('region', { name: 'Chapter 2 Packaging' }).getByRole('checkbox', { name: /All in chapter/ })
  await chapter2All.click()
  await expect(chapter2All).toBeChecked()
  await expect(summary.getByText('Images selected')).toBeVisible()
  await expect(summary.locator('dd').nth(3)).toHaveText('3')
  await expect(summary.locator('dd').nth(0)).toHaveText('2')

  // Report-only caption, and order within a step.
  const override = page.getByRole('textbox', { name: 'Caption in this report for login.png' })
  await override.fill('Screenshot showing the login page.')
  await override.press('Enter')
  await page.getByRole('button', { name: 'Move label-b.gif earlier' }).click()
  await expect(page.locator('[data-selected="true"]', { hasText: 'label-b.gif' }).getByText('#1')).toBeVisible()

  // The draft survives a reload.
  await page.reload()
  await expect(summary.locator('dd').nth(3)).toHaveText('3')
  await expect(page.getByRole('textbox', { name: 'Caption in this report for login.png' })).toHaveValue('Screenshot showing the login page.')

  // Generate and download.
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await summary.getByRole('button', { name: 'Generate Word report' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(new RegExp(`^${reference} Test Evidence Report \\d{4}-\\d{2}-\\d{2} \\d{4}\\.docx$`))
  const savedPath = test.info().outputPath('report.docx')
  await download.saveAs(savedPath)
  await expect(page.getByText('Report generated')).toBeVisible()
  // Work continues in a fresh draft with the same selection.
  await expect(summary.locator('dd').nth(3)).toHaveText('3')

  const zip = await JSZip.loadAsync(readFileSync(savedPath))
  const xml = await zip.file('word/document.xml')!.async('string')
  expect(Object.keys(zip.files).filter((name) => name.startsWith('word/media/'))).toHaveLength(3)
  for (const text of ['1. SMT Line 1', '1.1 Barcode Verification', '1.1.1 Test Run 001 (TR-001)', '2. Packaging', '2.1.1 Test Run 002 (TR-002)', 'Evidence 003', 'Screenshot showing the login page.', 'PASSED']) {
    expect(xml, text).toContain(text)
  }
  expect(xml).not.toContain('UNSELECTED IMAGE CAPTION')
  expect(xml.indexOf('Label B')).toBeLessThan(xml.indexOf('Label A'))

  // History lists it; the saved copy downloads again; the record lists its evidence.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Generated Documents' }).click()
  const row = page.getByRole('row', { name: new RegExp(reference) })
  await expect(row).toContainText('Generated')
  await expect(row).toContainText('E2E Administrator')
  await expect(row.getByRole('cell').nth(5)).toHaveText('3')
  const again = page.waitForEvent('download')
  await row.getByRole('button', { name: /Download/ }).click()
  expect((await again).suggestedFilename()).toMatch(/\.docx$/)

  await row.getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Evidence selected (3)' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Screenshot showing the login page.' })).toBeVisible()

  assertNoErrors()
})
