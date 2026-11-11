import { expect, test } from '@playwright/test'
import { failOnPageErrors } from './support'

test('the shell renders and every navigation item opens its page', async ({ page }) => {
  const assertNoErrors = failOnPageErrors(page)
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

  for (const label of ['Protocols', 'Evidence Library', 'Generated Documents', 'User Management', 'Settings']) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  }
  assertNoErrors()
})

test('an unknown address shows a not-found page inside the shell', async ({ page }) => {
  await page.goto('/no-such-page')
  await expect(page.getByText('Page not found')).toBeVisible()
  await page.getByRole('link', { name: 'Go to the dashboard' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
})
