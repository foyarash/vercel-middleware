import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { createRedirectionIoMiddleware as createEdgeMiddleware } from "./middleware";
import { NextMiddleware } from "./types";

type CreateMiddlewareConfig = {
    previousMiddleware?: NextMiddleware;
    nextMiddleware?: NextMiddleware;
    matcherRegex?: string | null;
    logged?: boolean;
    includedRequestHeadersInResponse?: string[];
};

type NextConfig = NonNullable<ConstructorParameters<typeof NextRequest>[1]>["nextConfig"];

// NextRequest does not expose its config, Next.js 14 to 16 keep it in the private NextURLInternal symbol.
const getNextConfig = (request: NextRequest): NextConfig => {
    const internalSymbol = Object.getOwnPropertySymbols(request.nextUrl).find(
        (symbol) => symbol.description === "NextURLInternal",
    );
    const internal: unknown = internalSymbol
        ? Object.getOwnPropertyDescriptor(request.nextUrl, internalSymbol)?.value
        : undefined;

    if (
        internal &&
        typeof internal === "object" &&
        "options" in internal &&
        internal.options &&
        typeof internal.options === "object" &&
        "nextConfig" in internal.options &&
        internal.options.nextConfig &&
        typeof internal.options.nextConfig === "object"
    ) {
        return internal.options.nextConfig as NextConfig;
    }

    return { basePath: request.nextUrl.basePath };
};

export const createRedirectionIoMiddleware = (config: CreateMiddlewareConfig): NextMiddleware => {
    // The Next.js config is the same for every request, it is read from the first one
    let nextConfig: NextConfig | undefined;

    const withNextConfig = (middleware: NextMiddleware | undefined) => {
        if (!middleware) {
            return undefined;
        }

        // Next.js 14 and 15 Edge sandboxes do not see `req` as a `Request` instance and would drop its headers and method.
        return (req: Request, evt?: NextFetchEvent) =>
            middleware(
                new NextRequest(req, { nextConfig, method: req.method, headers: req.headers, body: req.body }),
                evt,
            );
    };

    const edgeMiddleware = createEdgeMiddleware<NextRequest, NextFetchEvent>({
        previousMiddleware: withNextConfig(config.previousMiddleware),
        nextMiddleware: withNextConfig(config.nextMiddleware),
        matcherRegex: config.matcherRegex,
        logged: config.logged ?? true,
        // By default, handle next intl headers
        includedRequestHeadersInResponse: ["x-next-intl-locale", ...(config.includedRequestHeadersInResponse ?? [])],
    });

    return async (req: NextRequest, evt?: NextFetchEvent) => {
        nextConfig ??= getNextConfig(req);

        const response = await edgeMiddleware(req, evt);

        return new NextResponse(response.body, response);
    };
};
