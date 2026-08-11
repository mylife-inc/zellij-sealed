import { expect, type Page } from '@playwright/test';

/**
 * Hovers a nav trigger and waits for its panel.
 *
 * Retries the hover rather than assuming one is enough: a hover dispatched
 * before React has hydrated lands on markup with no handlers attached, and the
 * panel never opens. Under parallel load that is easy to hit.
 */
export async function openPanel(page: Page, name: string, panel: string): Promise<void> {
  /*
   * Each attempt moves the pointer away first. `toPass` retries the block, but
   * hovering an element the pointer already sits on fires no new pointerenter —
   * so without this every retry is a silent no-op and the helper just waits out
   * its timeout.
   */
  await expect(async () => {
    await page.mouse.move(10, 400);
    await page.getByRole('button', { name }).hover();
    await expect(page.locator(panel)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}
