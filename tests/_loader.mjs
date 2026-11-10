import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
  }
  try { return await next(specifier, context); }
  catch (e) {
    // Bare package subpaths without an extension (e.g. next/headers), as Next's bundler resolves them.
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && !specifier.startsWith('.') && !specifier.startsWith('/') && !/\.[a-z]+$/i.test(specifier)) return next(specifier + '.js', context);
    throw e;
  }
}
