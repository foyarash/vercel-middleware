import { createRedirectionIoMiddleware } from "@redirection.io/vercel-middleware/next";
import { chainedNextMiddleware, chainedPreviousMiddleware } from "./chained-middlewares";

export default createRedirectionIoMiddleware({
    previousMiddleware: chainedPreviousMiddleware,
    nextMiddleware: chainedNextMiddleware,
});

export const config = {
    unstable_allowDynamic: ["/node_modules/@redirection.io/**"],
    matcher: [
        // Legacy URLs with an extension (`/old-page.html`) must reach the middleware to be redirected
        "/((?!api|_next/static|_next/image|.*\\.png$).*)?",
    ],
};
