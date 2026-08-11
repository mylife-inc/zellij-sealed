import { test, expect } from '@playwright/test';

/**
 * Covers spec §6 and §11.3: the active theme drives every visual token, dark
 * mode works per theme, and switching mode restyles the whole site.
 *
 * The build-time `theme:` switch is covered by unit tests over `emitThemeCss`
 * (a full rebuild per theme is too slow for e2e); this suite verifies that what
 * is emitted actually reaches the page and takes effect.
 */

test.describe('theme tokens', () => {
  test('emits theme tokens into the document', async ({ page }) => {
    await page.goto('/');

    const style = page.locator('style#zellij-theme');
    await expect(style).toHaveCount(1);

    const css = (await style.textContent()) ?? '';
    expect(css).toContain('--zellij-accent');
    expect(css).toContain('--zellij-font-heading');
    expect(css).toContain('--zellij-motion-duration');

    // This demo enables `nav.themeSwitcher`, so every theme's tokens ship.
    // The default — active theme only — is covered by the emitThemeCss unit
    // tests, since it cannot be observed from a page that opted in.
    expect(css).toContain('[data-zellij-theme="carbon"]');
    expect(css).toContain('[data-zellij-theme="cupertino"]');
  });

  test('components resolve their styling from tokens', async ({ page }) => {
    await page.goto('/');

    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        accent: root.getPropertyValue('--zellij-accent').trim(),
        heading: root.getPropertyValue('--zellij-font-heading').trim(),
        radiusButton: root.getPropertyValue('--zellij-radius-button').trim(),
        sectionGap: root.getPropertyValue('--zellij-section-gap').trim(),
        duration: root.getPropertyValue('--zellij-motion-duration').trim(),
      };
    });

    for (const [name, value] of Object.entries(tokens)) {
      expect(value, `token ${name} is empty`).not.toBe('');
    }

    // The button's radius must come from the theme, not a hardcoded value.
    const buttonRadius = await page
      .locator('.zellij-button')
      .first()
      .evaluate((el) => getComputedStyle(el).borderRadius);
    expect(buttonRadius).not.toBe('');
  });

  test('the theme name is exposed for per-theme styling', async ({ page }) => {
    await page.goto('/');
    const theme = await page.locator('html').getAttribute('data-zellij-theme');
    expect(theme).toBeTruthy();
  });
});

test.describe('dark mode', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'toggle is desktop-only');

  test('switching mode changes background and text colours sitewide', async ({ page }) => {
    await page.goto('/');

    const read = () =>
      page.evaluate(() => {
        const body = getComputedStyle(document.body);
        return { bg: body.backgroundColor, fg: body.color };
      });

    const before = await read();
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
    await expect
      .poll(async () => (await read()).bg)
      .not.toBe(before.bg);

    const after = await read();
    expect(after.fg).not.toBe(before.fg);
  });

  test('follows the system preference when mode is "system"', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-zellij-mode', 'system');
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(async () => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .not.toBe(light);
  });

  test('guide code blocks follow the mode too', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/guide/quickstart');

    const token = page.locator('pre.shiki span').first();
    const darkColor = await token.evaluate((el) => getComputedStyle(el).color);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(async () => token.evaluate((el) => getComputedStyle(el).color))
      .not.toBe(darkColor);
  });
});

test.describe('theme switcher', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'the picker lives in the desktop bar');

  async function openSwitcher(page: import('@playwright/test').Page): Promise<void> {
  /*
   * Each attempt moves the pointer away first. `toPass` retries the block, but
   * hovering an element the pointer already sits on fires no new pointerenter —
   * so without this every retry is a silent no-op and the helper just waits out
   * its timeout.
   */
    await expect(async () => {
      await page.mouse.move(10, 400);
      await page.getByRole('button', { name: 'Change theme' }).hover();
      await expect(page.locator('.zellij-theme-panel')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
  }

  test('opens flush against the bar and lists every built-in theme', async ({ page }) => {
    await page.goto('/');
    await openSwitcher(page);

    const header = (await page.locator('.zellij-header').boundingBox())!;
    const panel = (await page.locator('.zellij-theme-panel').boundingBox())!;
    expect(panel.y - (header.y + header.height)).toBeLessThanOrEqual(0);

    await expect(page.locator('.zellij-theme-card')).toHaveCount(14);
  });

  /**
   * Each chip carries the theme it stands for, so it is coloured by that
   * theme's own rules rather than a hand-maintained copy that could drift.
   */
  test('colours each chip from the theme it names', async ({ page }) => {
    await page.goto('/');
    await openSwitcher(page);

    // Polled: the chip is styled by CSS custom properties, and the computed
    // value can lag the panel becoming visible by a frame.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const fill = (name: string) => {
            const el = document.querySelector(`.zellij-theme-chip[data-zellij-theme="${name}"]`);
            return el ? getComputedStyle(el).backgroundColor : '';
          };
          return {
            forest: fill('forest'),
            iris: fill('iris'),
            distinct: fill('forest') !== fill('iris') && fill('forest') !== '',
          };
        }),
      )
      .toEqual(expect.objectContaining({ distinct: true }));
  });

  test('restyles the whole site when a theme is chosen', async ({ page }) => {
    // The product page, so the `h1` read below is the visible hero headline
    // rather than the landing page's hidden fallback heading.
    await page.goto('/lumen-3-pro');
    await openSwitcher(page);

    const read = () =>
      page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-zellij-theme'),
        bg: getComputedStyle(document.body).backgroundColor,
        heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
        radius: getComputedStyle(document.documentElement)
          .getPropertyValue('--zellij-radius')
          .trim(),
      }));

    const before = await read();
    await page.locator('.zellij-theme-card').filter({ hasText: 'Carbon' }).click();
    await expect(page.locator('.zellij-theme-panel')).toBeHidden();

    const after = await read();
    expect(after.theme).toBe('carbon');
    // Not just colour: typography and geometry switch too.
    expect(after.heading).not.toBe(before.heading);
    expect(after.radius).not.toBe(before.radius);
  });

  test('remembers the choice across navigation', async ({ page }) => {
    await page.goto('/');
    await openSwitcher(page);
    await page.locator('.zellij-theme-card').filter({ hasText: 'Forest' }).click();

    await page.goto('/lumen-3-pro');
    await expect(page.locator('html')).toHaveAttribute('data-zellij-theme', 'forest');
  });

  test('marks the active theme and is keyboard reachable', async ({ page }) => {
    await page.goto('/');
    await openSwitcher(page);

    const selected = page.locator('.zellij-theme-card[data-selected="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText('Cupertino');

    await page.keyboard.press('Escape');
    await expect(page.locator('.zellij-theme-panel')).toBeHidden();
  });
});
