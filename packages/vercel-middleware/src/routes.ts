type JsonObject = Record<string, unknown>;

type NextRoutes = {
    basePath: string;
    hasRewrites: boolean;
    prerenderedStatuses: Map<string, number>;
    notFoundPaths: Set<string>;
    staticHtmlPaths: Set<string>;
    functionRoutes: RegExp[];
    prerenderedDynamicRoutes: Array<{ regex: RegExp; isNotFoundFallback: boolean }>;
    notFoundStatus: number | undefined;
};

let nextRoutes: NextRoutes | null | undefined;

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectEntries(value: unknown): Array<[string, JsonObject]> {
    if (!isJsonObject(value)) {
        return [];
    }

    return Object.entries(value).filter((entry): entry is [string, JsonObject] => isJsonObject(entry[1]));
}

const PAGES_INTERNAL_ROUTES = ["/_app", "/_document", "/_error", "/404", "/500"];

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeToRegex(route: string) {
    const pattern = route
        .split("/")
        .filter(Boolean)
        .map((segment) => {
            if (segment.startsWith("[[...") && segment.endsWith("]]")) {
                return "(?:/.+)?";
            }

            if (segment.startsWith("[...") && segment.endsWith("]")) {
                return "/.+";
            }

            if (segment.startsWith("[") && segment.endsWith("]")) {
                return "/[^/]+";
            }

            return "/" + escapeRegex(segment);
        })
        .join("");

    return new RegExp("^" + (pattern || "/") + "$", "i");
}

function hasRewrites(rewrites: unknown) {
    if (Array.isArray(rewrites)) {
        return rewrites.length > 0;
    }

    return isJsonObject(rewrites) && Object.values(rewrites).some((list) => Array.isArray(list) && list.length > 0);
}

function readNextRoutes(): NextRoutes | null {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return null;
    }

    // A static `process.cwd` or `process.getBuiltinModule` fails the Edge build of Turbopack, even if never run there
    const nodeProcess = globalThis.process;
    const fs = nodeProcess.getBuiltinModule?.("fs");

    if (!fs) {
        return null;
    }

    const readJson = (path: string): JsonObject | null => {
        try {
            const json: unknown = JSON.parse(fs.readFileSync(nodeProcess.cwd() + "/.next/" + path, "utf8"));

            return isJsonObject(json) ? json : null;
        } catch {
            return null;
        }
    };

    const routesManifest = readJson("routes-manifest.json");
    const prerenderManifest = readJson("prerender-manifest.json");
    const pagesManifest = readJson("server/pages-manifest.json") ?? {};
    const appPathRoutesManifest = readJson("app-path-routes-manifest.json") ?? {};

    if (!routesManifest || !prerenderManifest || routesManifest.i18n) {
        return null;
    }

    const rewrites = routesManifest.rewrites;

    if (isJsonObject(rewrites) && Array.isArray(rewrites.beforeFiles) && rewrites.beforeFiles.length > 0) {
        return null;
    }

    const prerenderedStatuses = new Map(
        objectEntries(prerenderManifest.routes).map(([path, route]): [string, number] => [
            path,
            typeof route.initialStatus === "number" ? route.initialStatus : 200,
        ]),
    );
    const staticHtmlPaths = new Set(
        Object.entries(pagesManifest).flatMap(([path, file]) =>
            typeof file === "string" && file.endsWith(".html") ? [path] : [],
        ),
    );
    const notFoundStatus = prerenderedStatuses.get("/_not-found") ?? (staticHtmlPaths.has("/404") ? 404 : undefined);

    return {
        basePath: typeof routesManifest.basePath === "string" ? routesManifest.basePath : "",
        hasRewrites: hasRewrites(rewrites),
        prerenderedStatuses,
        notFoundPaths: new Set(
            Array.isArray(prerenderManifest.notFoundRoutes)
                ? prerenderManifest.notFoundRoutes.filter((path): path is string => typeof path === "string")
                : [],
        ),
        staticHtmlPaths,
        functionRoutes: [
            ...Object.values(appPathRoutesManifest).filter((route): route is string => typeof route === "string"),
            ...Object.keys(pagesManifest).filter(
                (route) => !PAGES_INTERNAL_ROUTES.includes(route) && !staticHtmlPaths.has(route),
            ),
        ].map(routeToRegex),
        prerenderedDynamicRoutes: objectEntries(prerenderManifest.dynamicRoutes).flatMap(([, route]) =>
            typeof route.routeRegex === "string"
                ? [{ regex: new RegExp(route.routeRegex), isNotFoundFallback: route.fallback === false }]
                : [],
        ),
        notFoundStatus,
    };
}

// Status of a Next.js page served without running a function (static, ISR or static 404), undefined when unknown
export function getStaticResponseStatus(method: string, url: string): number | undefined {
    if (method !== "GET" && method !== "HEAD") {
        return undefined;
    }

    if (nextRoutes === undefined) {
        try {
            nextRoutes = readNextRoutes();
        } catch (err) {
            console.error(err);
            nextRoutes = null;
        }
    }

    if (!nextRoutes) {
        return undefined;
    }

    let pathname = new URL(url).pathname;

    if (nextRoutes.basePath) {
        if (pathname !== nextRoutes.basePath && !pathname.startsWith(nextRoutes.basePath + "/")) {
            return undefined;
        }

        pathname = pathname.slice(nextRoutes.basePath.length) || "/";
    }

    if (pathname.length > 1 && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
    }

    const prerenderedStatus = nextRoutes.prerenderedStatuses.get(pathname);

    if (prerenderedStatus !== undefined) {
        return prerenderedStatus;
    }

    if (nextRoutes.notFoundPaths.has(pathname)) {
        return 404;
    }

    if (nextRoutes.staticHtmlPaths.has(pathname)) {
        return 200;
    }

    if (nextRoutes.hasRewrites) {
        return undefined;
    }

    const prerenderedDynamicRoute = nextRoutes.prerenderedDynamicRoutes.find(({ regex }) => regex.test(pathname));

    if (prerenderedDynamicRoute) {
        return prerenderedDynamicRoute.isNotFoundFallback ? nextRoutes.notFoundStatus : 200;
    }

    if (nextRoutes.functionRoutes.some((regex) => regex.test(pathname))) {
        return undefined;
    }

    return nextRoutes.notFoundStatus;
}
