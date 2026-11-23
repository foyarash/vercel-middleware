---
"@redirection.io/vercel-middleware": patch
---

Keep the rewrite, overridden request headers, cookies and response headers set by `previousMiddleware` / `nextMiddleware` in the final response, and match redirection.io rules against the public URL instead of the rewritten one.
