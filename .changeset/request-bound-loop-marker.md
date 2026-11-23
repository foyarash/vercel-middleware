---
"@redirection.io/vercel-middleware": patch
---

Bind the anti-loop marker of proxified requests to the method and path of the request, with a 60 seconds lifetime, and remove it from the request headers given to the application. It was a fixed value derived from the token: once leaked (for example by an error tracker capturing the request headers), it allowed to bypass the middleware until the token was rotated. A request with an invalid marker is handled normally but never proxified again.
