import type { IncomingMessage } from "node:http";

export type NextRequestKind = "server-action" | "rsc" | "document";

export function getNextRequestKind(request: Request): NextRequestKind {
    const { headers } = request;

    if (headers.get("next-action")) {
        return "server-action";
    }

    if (
        headers.get("rsc") === "1" ||
        headers.has("next-router-prefetch") ||
        headers.has("next-router-segment-prefetch") ||
        headers.has("next-router-state-tree") ||
        headers.get("accept")?.includes("text/x-component") ||
        new URL(request.url).searchParams.has("_rsc")
    ) {
        return "rsc";
    }

    return "document";
}

export function isNextPrefetchRequest(request: IncomingMessage) {
    return Boolean(request.headers["next-router-prefetch"] || request.headers["next-router-segment-prefetch"]);
}

// Next strips `_rsc` (re-serializing the query) before the proxy runs, so both sides must normalize the same way.
export function stripNextRscSearchParam(url: URL): URL {
    const strippedUrl = new URL(url);

    strippedUrl.searchParams.delete("_rsc");

    return strippedUrl;
}
