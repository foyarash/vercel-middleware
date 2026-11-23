---
"@redirection.io/vercel-middleware": patch
---

Fix empty bodies on proxified responses on Vercel (rules adding response headers or filtering the body): the `content-encoding` and `content-length` headers of the internal fetch, whose body is already decoded, are no longer forwarded.
