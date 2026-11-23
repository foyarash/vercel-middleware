---
"@redirection.io/vercel-middleware": patch
---

Keep the request headers and method given to `previousMiddleware` and `nextMiddleware` on Next.js 14 and 15 Edge middlewares, which dropped them (for example the request headers overridden by `previousMiddleware` never reached the page).
