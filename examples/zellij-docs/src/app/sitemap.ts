import { createZellijSitemap } from '@shebka/zellij';

// A metadata route is dynamic by default, and `output: export` has nowhere to
// run it — without this, asking for a static export fails on this file.
export const dynamic = 'force-static';

export default createZellijSitemap();
