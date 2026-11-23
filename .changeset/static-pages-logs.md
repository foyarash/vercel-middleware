---
"@redirection.io/vercel-middleware": patch
---

Log static pages, ISR pages and the static 404 page on Vercel: a Node.js middleware reads the Next.js build manifests to log, with their status, the requests it lets through to pages served from the CDN cache, while dynamic routes are still logged by the instrumentation with their real status. The instrumentation also ignores ISR renders requested by the Vercel cache, and strips the route params Vercel adds to the query of dynamic routes (`nxtP*`) so that it recognizes the data signed by the middleware.
