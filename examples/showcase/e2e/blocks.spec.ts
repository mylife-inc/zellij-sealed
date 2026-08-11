import { test, expect } from '@playwright/test';

/**
 * Covers the media panel, the card carousel, and the gradient treatments —
 * plus the rule that no section may widen the page.
 */

test.describe('media panel', () => {
  /*
   * These assertions measure boxes, and a reveal animates `transform` — so a
   * measurement taken while one is in flight is off by however far through the
   * translate it happens to be. The engine renders everything in place under
   * reduced motion, which is the layout these tests are actually about.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('fills the panel with the image and lays the copy over it', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    const panel = page.locator('#design');
    await expect(panel).toBeVisible();

    const image = panel.locator('.zellij-panel-image');
    await expect(image).toBeVisible();

    const copy = panel.locator('.zellij-panel-copy');
    await expect(copy).toContainText('Grade 5 titanium');
    await expect(copy).toHaveAttribute('data-align', 'left');

    // The copy sits over the media, not beside it.
    await page.evaluate(() => document.fonts.ready);
    const { media, text } = await page.evaluate(() => {
      const rect = (selector: string) => {
        const { left, width } = document.querySelector(selector)!.getBoundingClientRect();
        return { left, width };
      };
      return {
        media: rect('#design .zellij-panel-media'),
        text: rect('#design .zellij-panel-copy'),
      };
    });

    expect(text.left).toBeGreaterThanOrEqual(media.left);
    expect(text.left + text.width).toBeLessThanOrEqual(media.left + media.width + 1);
  });

  /**
   * A fixed aspect-ratio would clip long copy instead of growing, which is how
   * the panel first shipped: the title overflowed the top and the CTA the foot.
   */
  test('grows to fit copy taller than its ratio', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    // Both boxes in one evaluation: two sequential boundingBox() calls can
    // straddle the webfont relayout, and then the panel and its copy are
    // measured against different layouts.
    await page.evaluate(() => document.fonts.ready);
    const { outer, inner } = await page.evaluate(() => {
      const rect = (selector: string) => {
        const { top, height } = document.querySelector(selector)!.getBoundingClientRect();
        return { top, height };
      };
      return {
        outer: rect('#design .zellij-panel-surface'),
        inner: rect('#design .zellij-panel-copy'),
      };
    });

    expect(inner.top).toBeGreaterThanOrEqual(outer.top - 1);
    expect(inner.top + inner.height).toBeLessThanOrEqual(outer.top + outer.height + 1);
  });

  test('keeps the CTA clickable over the media', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    const cta = page.locator('#design').getByRole('link', { name: 'See the design' });
    await cta.scrollIntoViewIfNeeded();

    /*
     * Wait for the panel to finish revealing before clicking it.
     *
     * The section fades and translates in, and a click dispatched while it is
     * still moving can land on the media behind the CTA rather than on the CTA
     * — which is indistinguishable, from the URL, from the overlap this test
     * exists to catch. Waiting for the reveal to settle means a failure here
     * means what it says.
     */
    await expect(page.locator('#design [data-zellij-reveal]').first()).toHaveAttribute(
      'data-zellij-reveal',
      'in',
    );

    await cta.click();
    await expect(page).toHaveURL(/\/lumen-3-pro#specs$/);
  });
});

test.describe('card carousel', () => {
  test('renders every card in the declared order', async ({ page }) => {
    await page.goto('/');

    const titles = page.locator('#buying .zellij-card-title');
    await expect(titles).toHaveCount(5);
    await expect(titles.first()).toHaveText('Turn the one in your pocket into credit.');
  });

  test('aligns the first card with the container, not the viewport edge', async ({ page }) => {
    await page.goto('/');

    const heading = await page.locator('#buying .zellij-section-heading').boundingBox();
    const first = await page.locator('#buying [data-zellij-card]').first().boundingBox();

    // Mandatory snapping used to scroll the leading padding away, putting the
    // first card flush against the viewport.
    expect(Math.abs(first!.x - heading!.x)).toBeLessThan(4);
  });

  test('scrolls right and back, with the controls disabled at each end', async ({ page }) => {
    test.skip(page.viewportSize()!.width < 700, 'the arrows are a desktop affordance');
    await page.goto('/');

    const section = page.locator('#buying');
    const previous = section.getByRole('button', { name: 'Scroll left' });
    const next = section.getByRole('button', { name: 'Scroll right' });
    const track = section.locator('.zellij-carousel-track');

    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(previous).toBeEnabled();

    await previous.click();
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeLessThan(4);
    await expect(previous).toBeDisabled();
  });

  test('is scrollable by keyboard', async ({ page }) => {
    await page.goto('/');
    const track = page.locator('#buying .zellij-carousel-track');

    // A scrollable region must be reachable without a pointer (WCAG 2.1.1).
    await expect(track).toHaveAttribute('tabindex', '0');
    await track.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });

  test('routes from a card to its destination', async ({ page }) => {
    await page.goto('/');
    await page.locator('#buying [data-zellij-card]').first().click();
    await expect(page).toHaveURL(/\/lumen-3-pro#trade$/);
  });
});

test.describe('gradients', () => {
  test('clips a gradient to the heading glyphs', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    const heading = page.locator('.zellij-hero-headline');

    await expect(heading).toHaveClass(/zellij-gradient-text/);

    const style = await heading.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { image: cs.backgroundImage, clip: cs.webkitBackgroundClip, fill: cs.webkitTextFillColor };
    });

    expect(style.image).toContain('linear-gradient');
    expect(style.clip).toBe('text');
    // Transparent fill is what lets the gradient show through.
    expect(style.fill).toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('page width', () => {
  /**
   * Sideways reveals translate content before animating it in. Left
   * unclipped, that widened the document and gave every page a horizontal
   * scrollbar on a narrow viewport.
   */
  for (const path of ['/', '/lumen-3-pro', '/guide', '/guide/quickstart']) {
    test(`nothing on ${path} widens the page`, async ({ page }) => {
      await page.goto(path);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }
});

test.describe('bento grid', () => {
  test('gives tiles the spans they declare', async ({ page }) => {
    test.skip(page.viewportSize()!.width < 900, 'spans collapse below the tablet breakpoint');
    await page.goto('/lumen-3-pro');

    const cells = page.locator('#highlights .zellij-bento-cell');
    await expect(cells).toHaveCount(6);
    await expect(cells.first()).toHaveAttribute('data-span', 'large');

    // A `large` tile really claims two columns, not just a label.
    const large = (await cells.first().boundingBox())!;
    const normal = (await cells.nth(1).boundingBox())!;
    expect(large.width).toBeGreaterThan(normal.width * 1.5);
    expect(large.height).toBeGreaterThan(normal.height * 1.5);
  });

  test('collapses to one column on a phone', async ({ page }) => {
    test.skip(page.viewportSize()!.width >= 600, 'narrow viewports only');
    await page.goto('/lumen-3-pro');

    const boxes = await page
      .locator('#highlights .zellij-bento-cell')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x));
    expect(new Set(boxes).size).toBe(1);
  });
});

test.describe('timeline', () => {
  test('is an ordered list with a date and title per entry', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    const list = page.locator('#generations ol.zellij-timeline-list');
    await expect(list).toBeVisible();

    const items = list.locator('li');
    await expect(items).toHaveCount(3);
    // A bare year in YAML arrives as a number; it must still render.
    await expect(items.first().locator('.zellij-timeline-date')).toHaveText('2024');
    await expect(items.first().locator('.zellij-timeline-title')).toHaveText('Lumen 1');
  });
});

test.describe('team grid', () => {
  test('renders each person with name, role and photo', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    const cards = page.locator('#makers .zellij-team-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first().locator('.zellij-team-name')).toHaveText('Rowan Ellis');
    await expect(cards.first().locator('.zellij-team-role')).toHaveText('Industrial design');
    // A portrait's alt is the person.
    await expect(cards.first().locator('img')).toHaveAttribute('alt', 'Rowan Ellis');
  });

  test('names the person in each link, for links read out of context', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    await expect(
      page.locator('#makers').getByRole('link', { name: 'Rowan Ellis — Design notes' }),
    ).toBeVisible();
  });
});

test.describe('gallery lightbox', () => {
  test('opens, pages and closes', async ({ page }) => {
    await page.goto('/lumen-3-pro');

    const dialog = page.locator('.zellij-lightbox');
    await expect(dialog).toBeHidden();

    await page.locator('#finishes .zellij-gallery-opener').first().click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('.zellij-lightbox-count')).toHaveText('1 of 6');
    await expect(page.locator('.zellij-lightbox-caption')).toHaveText('Graphite');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.zellij-lightbox-count')).toHaveText('2 of 6');

    await page.getByRole('button', { name: 'Previous image' }).click();
    await expect(page.locator('.zellij-lightbox-count')).toHaveText('1 of 6');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  /**
   * A modal dialog is `position: fixed` per the UA stylesheet. Overriding that
   * put it in document flow, so it opened far above the viewport.
   */
  test('sits centred in the viewport', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    await page.locator('#finishes .zellij-gallery-opener').first().click();

    const box = (await page.locator('.zellij-lightbox').boundingBox())!;
    const viewport = page.viewportSize()!;

    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    // Equal gutters either side.
    expect(Math.abs(box.x - (viewport.width - box.x - box.width))).toBeLessThan(2);
  });

  test('opens the image the tile names, not always the first', async ({ page }) => {
    await page.goto('/lumen-3-pro');
    await page.locator('#finishes .zellij-gallery-opener').nth(2).click();
    await expect(page.locator('.zellij-lightbox-count')).toHaveText('3 of 6');
  });
});
