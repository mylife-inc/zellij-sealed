import { test, expect, type Page } from '@playwright/test';

/**
 * Covers the `expressive` preset and the reduced-motion override (spec §6.5,
 * §11.3). The demo runs `motion: expressive`, so these exercise the real
 * configuration rather than a fixture.
 */

async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(250);
}

async function progressOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-zellij-stage="pinned"]');
    if (!stage) return -1;
    return Number.parseFloat(getComputedStyle(stage).getPropertyValue('--zellij-progress') || '-1');
  });
}

test.describe('sticky-scroll showcase', () => {
  // Pinning is deliberately skipped on short and touch-sized viewports.
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop viewports only');

  test('pins the panel and reserves scroll distance for it', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const stage = page.locator('[data-zellij-stage="pinned"]');
    await expect(stage).toHaveCount(1);

    const box = (await stage.boundingBox())!;
    const viewport = page.viewportSize()!;
    // The extra height belongs to the outer element, not the sticky child.
    expect(box.height).toBeGreaterThan(viewport.height);

    await expect(page.locator('.zellij-stage-sticky')).toHaveCSS('position', 'sticky');
  });

  test('advances scroll progress from 0 to 1 through the pinned region', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const box = (await page.locator('[data-zellij-stage="pinned"]').boundingBox())!;

    await scrollTo(page, Math.max(0, box.y - 200));
    const start = await progressOf(page);

    await scrollTo(page, box.y + box.height * 0.4);
    const middle = await progressOf(page);

    await scrollTo(page, box.y + box.height);
    const end = await progressOf(page);

    expect(start).toBeLessThan(0.2);
    expect(middle).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(middle);
    expect(end).toBeCloseTo(1, 1);
  });

  test('holds the visual in place while progress advances', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const box = (await page.locator('[data-zellij-stage="pinned"]').boundingBox())!;
    const sticky = page.locator('.zellij-stage-sticky');

    // The pin holds only while the stage still has travel left underneath its
    // sticky child, so the hold window is `stage - sticky` tall. Deriving the
    // sample points from the measured heights keeps this test honest when the
    // section's content — and so the stage's height — changes.
    const stickyHeight = (await sticky.boundingBox())!.height;
    const hold = box.height - stickyHeight;
    expect(hold).toBeGreaterThan(0);

    await scrollTo(page, box.y + hold * 0.2);
    const first = (await sticky.boundingBox())!.y;

    await scrollTo(page, box.y + hold * 0.7);
    const second = (await sticky.boundingBox())!.y;

    // Pinned: the element stays put in the viewport as the page scrolls under it.
    expect(Math.abs(second - first)).toBeLessThan(4);
  });

  test('ramps the visual with transform and opacity only', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const box = (await page.locator('[data-zellij-stage="pinned"]').boundingBox())!;
    const media = page.locator('[data-zellij-stage="pinned"] .zellij-showcase-media');

    await scrollTo(page, Math.max(0, box.y - 200));
    const before = await media.evaluate((el) => {
      const s = getComputedStyle(el);
      return { transform: s.transform, opacity: Number.parseFloat(s.opacity) };
    });

    await scrollTo(page, box.y + box.height);

    // Poll rather than sample once: progress is written on an animation frame,
    // so the settled value can land after an instant scroll returns.
    await expect
      .poll(() => media.evaluate((el) => getComputedStyle(el).transform), { timeout: 5000 })
      // Scale settles at 1 — a matrix with no skew or translation.
      .toBe('matrix(1, 0, 0, 1, 0, 0)');

    const after = await media.evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity));
    expect(after).toBeGreaterThan(before.opacity);
    expect(after).toBeCloseTo(1, 1);
  });
});

test.describe('hero parallax', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop viewports only');

  test('translates the hero visual as the page scrolls', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const parallax = page.locator('[data-zellij-parallax="on"]');
    await expect(parallax).toHaveCount(1);

    const read = () => parallax.evaluate((el) => getComputedStyle(el).transform);

    await scrollTo(page, 0);
    const top = await read();
    await scrollTo(page, 600);
    const scrolled = await read();

    expect(scrolled).not.toBe(top);
    // Translation only: no scale or skew components.
    expect(scrolled).toMatch(/^matrix\(1, 0, 0, 1, /);
  });
});

test.describe('count-up stats', () => {
  test('animates numbers into place and settles on the authored value', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const stats = page.locator('[data-zellij-section="stats-band"]');
    await stats.scrollIntoViewIfNeeded();

    const value = stats.locator('.zellij-stat-value').first();
    // Whatever it does mid-flight, it must end on exactly what the content says.
    //
    // This once looked like load-related flake and was papered over with a long
    // timeout. The real cause was CountUp re-running its own effect and
    // cancelling its animation frame, so it froze on a partial number. With that
    // fixed, the ordinary bound holds.
    await expect(value).toHaveText('6.3″', { timeout: 5000 });
  });
});

test.describe('per-section motion override', () => {
  test('a section may opt out of the page preset', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    const pricing = page.locator('[data-zellij-section="pricing-table"]');
    await expect(pricing).toHaveAttribute('data-zellij-motion', 'none');

    // Other sections on the same page keep the page-level preset.
    await expect(page.locator('[data-zellij-section="hero"]')).toHaveAttribute(
      'data-zellij-motion',
      'expressive',
    );

    // An opted-out section renders visible immediately, with no reveal state.
    await expect(pricing.locator('[data-zellij-reveal="out"]')).toHaveCount(0);
  });
});

test.describe('reduced motion overrides everything', () => {
  /**
   * Spec §6.5 makes this mandatory regardless of configuration — the demo is
   * configured `expressive`, and none of it may run.
   */
  test('disables pinning, parallax and reveals', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lumen-3-pro');

    // The stage renders as an ordinary block: no reserved scroll distance.
    await expect(page.locator('.zellij-stage-sticky')).toHaveCount(0);
    await expect(page.locator('[data-zellij-stage="pinned"]')).toHaveCount(0);
    await expect(page.locator('[data-zellij-parallax="on"]')).toHaveCount(0);

    // Nothing is hidden awaiting a reveal.
    await expect(page.locator('[data-zellij-reveal="out"]')).toHaveCount(0);

    const media = page.locator('[data-zellij-section="showcase"] .zellij-media').first();
    await expect(media).toHaveCSS('opacity', '1');
  });

  test('stats show their final value without counting', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lumen-3-pro');
    await expect(page.locator('.zellij-stat-value').first()).toHaveText('6.3″');
  });

  test('the page is not made taller by motion that cannot run', async ({ page, isMobile }) => {
    // Scoped to this test rather than the describe: the other reduced-motion
    // checks must still run on mobile. Pinning is disabled on touch-sized
    // viewports anyway, so there is no reserved distance to reclaim.
    test.skip(Boolean(isMobile), 'pinning is desktop-only');

    await page.goto('/lumen-3-pro');
    // The pin is installed on hydration, so measuring earlier would compare the
    // un-pinned server markup against itself.
    await expect(page.locator('[data-zellij-stage="pinned"]')).toBeAttached();
    const expressiveHeight = await page.evaluate(() => document.body.scrollHeight);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const reducedHeight = await page.evaluate(() => document.body.scrollHeight);

    // Pinning adds real scroll distance; without it the page must be shorter.
    expect(reducedHeight).toBeLessThan(expressiveHeight);
  });
});
