import * as path from 'node:path';

import { SITE_DATA_FILE_NAMES } from './contracts.ts';

export function resolveSiteRequestPath(siteRoot: string, urlPath: string): string {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const initialResolvedPath = path.resolve(siteRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(siteRoot, initialResolvedPath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Invalid path.');
  }

  const servedRelativePath = relativeToRoot.replace(/\\/g, '/');
  const lowerRelativePath = servedRelativePath.toLowerCase();
  if (lowerRelativePath.startsWith('data/')) {
    const dataRelativePath = lowerRelativePath.slice('data/'.length);
    if (dataRelativePath.includes('/')) {
      throw new Error('Not found');
    }
    const canonicalDataFile = SITE_DATA_FILE_NAMES.find((fileName) => fileName.toLowerCase() === dataRelativePath);
    if (!canonicalDataFile) {
      throw new Error('Not found');
    }
    return path.resolve(siteRoot, 'data', canonicalDataFile);
  }

  return initialResolvedPath;
}
