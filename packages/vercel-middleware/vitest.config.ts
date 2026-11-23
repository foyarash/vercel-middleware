import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import packageJson from "./package.json" with { type: "json" };

// The redirection.io library imports its WebAssembly module with the `?module` suffix of Edge bundlers
const WASM_MODULE_PREFIX = "\0wasm-module:";

const wasmModulePlugin: Plugin = {
    name: "wasm-module",
    enforce: "pre",
    resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith(".wasm?module") || !importer) {
            return null;
        }

        return WASM_MODULE_PREFIX + path.resolve(path.dirname(importer), source.slice(0, -"?module".length));
    },
    load(id: string) {
        if (!id.startsWith(WASM_MODULE_PREFIX)) {
            return null;
        }

        const wasmPath = JSON.stringify(id.slice(WASM_MODULE_PREFIX.length));

        return `import { readFileSync } from "node:fs";\nexport default new WebAssembly.Module(readFileSync(${wasmPath}));`;
    },
};

const redirectionioDirectory = path.dirname(
    createRequire(import.meta.url).resolve("@redirection.io/redirectionio/package.json"),
);

export default defineConfig({
    plugins: [wasmModulePlugin],
    resolve: {
        // The library only declares a `module` entry, which Vitest does not resolve on Node.js
        alias: { "@redirection.io/redirectionio": path.join(redirectionioDirectory, "redirectionio.js") },
    },
    define: {
        __REDIRECTIONIO_VERSION__: JSON.stringify(packageJson.version),
    },
    test: {
        environment: "node",
        server: { deps: { inline: ["@redirection.io/redirectionio"] } },
        unstubEnvs: true,
        restoreMocks: true,
    },
});
