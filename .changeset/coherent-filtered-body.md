---
"@redirection.io/vercel-middleware": patch
---

Fix empty or broken proxified responses on Vercel (rules adding response headers or filtering the body): drop the `content-encoding` and `content-length` headers once the body has been decoded by `fetch()` or rewritten by a body filter, and abort the response stream instead of leaving it pending when the backend body or the filter fails.
