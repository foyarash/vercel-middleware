---
"@redirection.io/vercel-middleware": patch
---

Subscribe the instrumentation only once per process, so that a hot reload in development or a second `registerRedirectionIoInstrumentation()` call no longer logs every request several times (the latest config is used).
