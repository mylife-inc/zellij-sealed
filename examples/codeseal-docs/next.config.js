import { withZellij } from '@shebka/zellij/next-config';

/**
 * Everything Zellij needs is in `withZellij`. Add your own Next options here
 * and they win — the helper only fills in what it must.
 *
 * @type {import('next').NextConfig}
 */
export default withZellij({
  typedRoutes: false,
});
