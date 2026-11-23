---
"@redirection.io/vercel-middleware": minor
---

The default `matcherRegex` now handles URLs with a document extension at any level (`/old-page.html`, `/page.php`, `/robots.txt`…), which were ignored at the root, so that legacy URLs can be redirected; static assets (`.js`, `.css`, images, fonts, `.map`…) are now ignored at any level. The instrumentation ignores the same static assets.
