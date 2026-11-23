---
"@redirection.io/vercel-middleware": patch
---

Prevent clients from bypassing the middleware with the `x-redirectionio-middleware` header or the `Vercel Edge Functions` user agent: the anti-loop marker is now an HMAC derived from the redirection.io token, and requests carrying an invalid marker are handled normally.
