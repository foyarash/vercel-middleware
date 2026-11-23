---
"@redirection.io/vercel-middleware": minor
---

Outside Vercel (`next start`, self-hosting), the instrumentation now logs every request, with the real status code and the socket address as client IP, and the middleware no longer reads the Next.js build manifests nor logs. The instrumentation is therefore required to log requests outside Vercel. On Vercel, the logging is unchanged; the README documents the limits of the static pages detection (Edge runtime, Next.js 15) and the size of the Edge middleware.
