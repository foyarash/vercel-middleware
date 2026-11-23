---
"@redirection.io/vercel-middleware": patch
---

Log a request rewritten by a chained middleware with its public URL and the action computed by the middleware: on Vercel, the query of the rewrite added to the URL of the function made the instrumentation reject the signed data, fetch the action again and log the rewritten query. With `next start`, these requests are now logged instead of being mistaken for a middleware invocation.
