---
"@redirection.io/vercel-middleware": patch
---

Build the `NextRequest` passed to chained middlewares with the Next.js config of the original request, so `nextUrl.basePath`, `nextUrl.locale` and `trailingSlash` are correct.
