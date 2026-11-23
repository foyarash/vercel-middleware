---
"@redirection.io/vercel-middleware": patch
---

Log each request exactly once on Vercel: the middleware logs the responses it produces itself (redirections, custom statuses, proxified responses) with `waitUntil`, the instrumentation logs the other requests with `waitUntil` and now ignores Vercel internal requests (`/_vercel/*`) and Node.js middleware invocations, and the `logged` option is honored again. Logs sent by the middleware now include the request headers (user agent, referrer…). Static and ISR pages served from the Vercel CDN are not logged.
