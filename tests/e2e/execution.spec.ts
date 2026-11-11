import { expect, test } from '@playwright/test'
import { adminApi, arrangeProtocol, failOnPageErrors, fixture } from './support'

const suffix = Date.now().toString(36)

test('record results, upload several screenshots with one bad file, preview them, and find them in the library', async ({ page }) => {
  const assertNoErrors = failOnPageErrors(page)
  const reference = `EX-${suffix}`.toUpperCase()
  const api = await adminApi()
  const arranged = await arrangeProtocol(api, reference, [
    { description: 'Open the application.', expected: 'The application opens successfully.' },
    { description: 'Scan a barcode.', expected: 'The barcode is accepted.' },
  ])

  // From the protocol's structure to the execution view.
  await page.goto(`/protocols/${arranged.protocolId}`)
  await page.getByRole('link', { name: 'Open test run 1.1.1 Test Run 001 for execution' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '1.1.1 Test Run 001' })).toBeVisible()
  await expect(page.getByText('0 of 2 steps executed')).toBeVisible()

  // Record a result.
  const step1 = page.getByRole('region', { name: 'Step 1' })
  await step1.getByLabel('Actual result').fill('The application opened successfully.')
  await step1.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Passed' }).click()
  await step1.getByLabel('Comments').fill('Build 4.2.1')
  await step1.getByRole('button', { name: 'Save result' }).click()
  await expect(page.getByText('Result for step 1 saved')).toBeVisible()
  await expect(page.getByText('1 of 2 steps executed · 1 passed')).toBeVisible()
  await expect(step1.getByText(/Last recorded .* by E2E Administrator/)).toBeVisible()

  // Upload three files at once; the renamed text file is rejected by name and reason, the others go through.
  await step1.getByRole('button', { name: 'Add evidence' }).click()
  await step1.getByLabel('Add evidence to step 1').setInputFiles([
    { name: 'login-page.png', mimeType: 'image/png', buffer: fixture('screenshot.png') },
    { name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('These are meeting notes, not a screenshot.') },
    { name: 'result.jpg', mimeType: 'image/jpeg', buffer: fixture('screenshot.jpg') },
  ])
  const uploads = step1.getByRole('list', { name: 'Uploads' })
  await expect(uploads.getByRole('alert')).toHaveText('notes.png is not a PNG, JPEG, WEBP, GIF or BMP image.')
  await expect(uploads.locator('[data-upload-phase="done"]')).toHaveCount(2, { timeout: 20_000 })
  await expect(step1.getByRole('heading', { name: 'Evidence (2)' })).toBeVisible()

  // Preview with next/previous, and edit the caption.
  await step1.getByRole('button', { name: /^Open login-page\.png/ }).click()
  const preview = page.getByRole('dialog')
  await expect(preview.getByRole('heading', { name: 'login-page.png' })).toBeVisible()
  await expect(preview.getByText(/^[12] of 2$/)).toBeVisible()
  await expect(preview.getByText('64×48 px', { exact: false })).toBeVisible()
  await expect(preview.getByRole('img')).toBeVisible()
  // Uploads run in parallel, so either file may be first; step to the other and back.
  const first = (await preview.getByText(/^[12] of 2$/).textContent()) === '1 of 2'
  await preview.getByRole('button', { name: first ? 'Next evidence' : 'Previous evidence' }).click()
  await expect(preview.getByRole('heading', { name: 'result.jpg' })).toBeVisible()
  await page.keyboard.press(first ? 'ArrowLeft' : 'ArrowRight')
  await expect(preview.getByRole('heading', { name: 'login-page.png' })).toBeVisible()
  await preview.getByLabel('Caption').fill('Screenshot showing the login page.')
  await preview.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Evidence details saved')).toBeVisible()
  await page.keyboard.press('Escape')

  // Results and evidence persist across a reload.
  await page.reload()
  const reloaded = page.getByRole('region', { name: 'Step 1' })
  await expect(reloaded.getByLabel('Actual result')).toHaveValue('The application opened successfully.')
  await expect(reloaded.getByText('Passed', { exact: true }).first()).toBeVisible()
  await expect(reloaded.getByRole('button', { name: 'Open login-page.png — Screenshot showing the login page.' })).toBeVisible()

  // The Evidence Library finds them by caption and by protocol.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Evidence Library' }).click()
  await page.getByRole('searchbox', { name: /Search file names/ }).fill('login page')
  await expect(page.getByRole('button', { name: 'Open login-page.png' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open result.jpg' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: /Search file names/ }).fill('')
  await page.getByRole('combobox', { name: 'Protocol' }).click()
  await page.getByRole('option', { name: reference }).click()
  await expect(page.getByText('Showing 1–2 of 2')).toBeVisible()

  assertNoErrors()
})
