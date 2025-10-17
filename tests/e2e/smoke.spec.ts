import { test, expect } from '@playwright/test'

test('home renders with heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Honkadori' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('heading', { name: 'Honkadori' })).toBeVisible()
})
