---
"@redirection.io/vercel-middleware": patch
---

Send the incoming request headers to the redirection.io agent from the middleware. They were previously always empty, so rules triggered on a request header (User-Agent, Accept-Language, Referer…) never matched. Sensitive headers are still filtered as before.
