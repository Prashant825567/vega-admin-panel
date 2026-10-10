/**
 * ESLint, in the shape ESLint 9 wants (flat config).
 *
 * `eslint-config-next` still ships the older eslintrc files, so FlatCompat is
 * what bridges them. Both presets are on: core-web-vitals for the React rules
 * that catch real bugs (misused hooks, an unkeyed list, an `<img>` where
 * `next/image` was meant) and the TypeScript set for the floating-promise and
 * unused-var checks that `tsc` alone does not report.
 */

import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FlatCompat} from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Build output and the generated Next types are not ours to lint.
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
];

export default config;
