---
"@redirection.io/vercel-middleware": patch
---

Update dependencies (`@vercel/functions` v3, `@redirection.io/redirectionio`) and drop the deprecated `@vercel/edge` package: `next()` now comes from `@vercel/functions/middleware`, with the same implementation, and the `RequestContext` type of the middleware is declared by the library with the same shape.
