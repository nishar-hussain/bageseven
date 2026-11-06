import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: root,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
