---
"@redirection.io/vercel-middleware": patch
---

Never let an error of the instrumentation reach the Node.js process (uncaught exception), and log requests without `Host` or `x-forwarded-proto` header with `localhost` and the protocol of the connection instead of an `undefined://undefined` URL.
