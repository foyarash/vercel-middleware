import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

type Manifests = {
    routes?: Record<string, unknown>;
    prerender?: Record<string, unknown>;
    appPathRoutes?: Record<string, string>;
    pages?: Record<string, string>;
};

const directories: string[] = [];

const DEFAULT_MANIFESTS = {
    routes: { basePath: "", rewrites: { beforeFiles: [], afterFiles: [], fallback: [] } },
    prerender: {
        routes: {
            "/": {},
            "/static": { initialStatus: 200 },
            "/_not-found": { initialStatus: 404 },
            "/gone-isr": { initialStatus: 410 },
        },
        notFoundRoutes: ["/gone"],
        dynamicRoutes: {
            "/blog/[slug]": { routeRegex: "^/blog/([^/]+?)(?:/)?$", fallback: false },
            "/isr/[id]": { routeRegex: "^/isr/([^/]+?)(?:/)?$", fallback: null },
        },
    },
    appPathRoutes: {
        "/dynamic/page": "/dynamic",
        "/products/[id]/page": "/products/[id]",
        "/docs/[[...path]]/page": "/docs/[[...path]]",
        "/api/hello/route": "/api/hello",
    },
    pages: {
        "/_app": "pages/_app.js",
        "/404": "pages/404.html",
        "/legacy": "pages/legacy.html",
        "/ssr": "pages/ssr.js",
    },
} satisfies Manifests;

function writeManifests(manifests: Manifests) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "redirectionio-routes-"));
    const write = (file: string, content: unknown) => {
        if (content === undefined) {
            return;
        }

        fs.mkdirSync(path.dirname(path.join(directory, ".next", file)), { recursive: true });
        fs.writeFileSync(path.join(directory, ".next", file), JSON.stringify(content));
    };

    write("routes-manifest.json", manifests.routes);
    write("prerender-manifest.json", manifests.prerender);
    write("app-path-routes-manifest.json", manifests.appPathRoutes);
    write("server/pages-manifest.json", manifests.pages);
    directories.push(directory);

    return directory;
}

async function getStatus(manifests: Manifests, runtime = "nodejs") {
    vi.resetModules();
    vi.stubEnv("NEXT_RUNTIME", runtime);
    vi.spyOn(process, "cwd").mockReturnValue(writeManifests(manifests));

    const { getStaticResponseStatus } = await import("./routes");

    return (url: string, method = "GET") => getStaticResponseStatus(method, "https://example.com" + url);
}

afterAll(() => {
    directories.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

describe("getStaticResponseStatus", () => {
    it.each([
        ["/", 200],
        ["/static", 200],
        ["/static/", 200],
        ["/gone-isr", 410],
        ["/gone", 404],
        ["/legacy", 200],
        ["/blog/unknown", 404],
        ["/isr/1", 200],
        ["/unknown", 404],
        ["/dynamic", undefined],
        ["/products/42", undefined],
        ["/docs", undefined],
        ["/docs/a/b", undefined],
        ["/api/hello", undefined],
        ["/ssr", undefined],
    ])("returns the status of %s", async (url, status) => {
        const getStaticStatus = await getStatus(DEFAULT_MANIFESTS);

        expect(getStaticStatus(url)).toBe(status);
    });

    it("ignores other methods than GET and HEAD", async () => {
        const getStaticStatus = await getStatus(DEFAULT_MANIFESTS);

        expect(getStaticStatus("/", "HEAD")).toBe(200);
        expect(getStaticStatus("/", "POST")).toBeUndefined();
    });

    it("handles the base path", async () => {
        const getStaticStatus = await getStatus({
            ...DEFAULT_MANIFESTS,
            routes: { ...DEFAULT_MANIFESTS.routes, basePath: "/base" },
        });

        expect(getStaticStatus("/base")).toBe(200);
        expect(getStaticStatus("/base/static")).toBe(200);
        expect(getStaticStatus("/static")).toBeUndefined();
        expect(getStaticStatus("/basement")).toBeUndefined();
    });

    it("uses the static 404 page of the pages router", async () => {
        const getStaticStatus = await getStatus({
            ...DEFAULT_MANIFESTS,
            prerender: { ...DEFAULT_MANIFESTS.prerender, routes: { "/": {} } },
        });

        expect(getStaticStatus("/unknown")).toBe(404);
    });

    it("only trusts prerendered pages with rewrites", async () => {
        const getStaticStatus = await getStatus({
            ...DEFAULT_MANIFESTS,
            routes: { basePath: "", rewrites: { beforeFiles: [], afterFiles: [{ source: "/a" }], fallback: [] } },
        });

        expect(getStaticStatus("/")).toBe(200);
        expect(getStaticStatus("/gone")).toBe(404);
        expect(getStaticStatus("/unknown")).toBeUndefined();
        expect(getStaticStatus("/isr/1")).toBeUndefined();
    });

    it.each([
        ["beforeFiles rewrites", { routes: { rewrites: { beforeFiles: [{ source: "/a" }] } } }],
        ["i18n", { routes: { i18n: { locales: ["en"] } } }],
        ["missing manifests", { routes: undefined }],
    ])("is unknown with %s", async (_name, manifests) => {
        const getStaticStatus = await getStatus({ ...DEFAULT_MANIFESTS, ...manifests });

        expect(getStaticStatus("/")).toBeUndefined();
        expect(getStaticStatus("/unknown")).toBeUndefined();
    });

    it("is unknown outside the Node.js runtime", async () => {
        const getStaticStatus = await getStatus(DEFAULT_MANIFESTS, "edge");

        expect(getStaticStatus("/")).toBeUndefined();
    });
});
