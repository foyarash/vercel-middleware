import { glob } from "glob";
import { defineConfig } from "tsup";
import fs from "fs";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
    entry: glob.sync("src/**/*.{ts,tsx}", {
        ignore: ["**/tests/*", "**/*.test.{ts,tsx}"],
    }),
    dts: {
        compilerOptions: {
            // https://github.com/egoist/tsup/issues/1388
            ignoreDeprecations: "6.0",
        },
    },
    clean: true,
    format: ["esm", "cjs"],
    outExtension: ({ format }) => {
        return {
            js: format === "esm" ? ".js" : ".cjs",
        };
    },
    bundle: false,
    define: {
        __REDIRECTIONIO_VERSION__: JSON.stringify(packageJson.version),
    },
    onSuccess: async () => {
        fs.copyFileSync("src/wasm-module-loader.cjs", "dist/wasm-module-loader.cjs");
    },
});
