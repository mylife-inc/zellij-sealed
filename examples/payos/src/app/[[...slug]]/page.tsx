import { createZellijPages } from '@shebka/zellij';

const zellij = createZellijPages();

export const generateStaticParams = zellij.generateStaticParams;
export const generateMetadata = zellij.generateMetadata;
export default zellij.Page;
