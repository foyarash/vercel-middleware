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

const withNextConfig = (middleware: NextMiddleware | undefined, nextConfig: NextConfig) => {
    if (!middleware) {
        return undefined;
    }

    return (req: Request, evt?: NextFetchEvent) => middleware(new NextRequest(req, { nextConfig }), evt);
};

export const createRedirectionIoMiddleware = (config: CreateMiddlewareConfig): NextMiddleware => {
    const configMatcherRegex = config.matcherRegex;

    return async (req: NextRequest, evt?: NextFetchEvent) => {
        const nextConfig = getNextConfig(req);
        const edgeMiddleware = createEdgeMiddleware<NextRequest, NextFetchEvent>({
            previousMiddleware: withNextConfig(config.previousMiddleware, nextConfig),
            nextMiddleware: withNextConfig(config.nextMiddleware, nextConfig),
            ...(configMatcherRegex ? { matcherRegex: configMatcherRegex } : {}),
            logged: config.logged ?? true,
            // By default, handle next intl headers
            includedRequestHeadersInResponse: [
                "x-next-intl-locale",
                ...(config.includedRequestHeadersInResponse ?? []),
            ],
        });
        const response = await edgeMiddleware(req, evt);

        return new NextResponse(response.body, response);
    };
};
