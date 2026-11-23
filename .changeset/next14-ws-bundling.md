---
"@redirection.io/vercel-middleware": patch
---

Fix the Next.js 14 build (`Module not found: Can't resolve 'ws'`): the middleware and the instrumentation no longer import the `@vercel/functions` entry point, which pulls an optional `ws` dependency.
