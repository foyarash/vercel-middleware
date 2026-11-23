import path from "path";
import { fileURLToPath } from "url";

const moduleDirectory = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export const redirectionIoWebpackWasmRule = {
    test: /\.wasm$/,
    resourceQuery: /module/,
    type: "javascript/auto",
    use: [
        {
            loader: path.resolve(path.join(moduleDirectory, "wasm-module-loader.cjs")),
        },
    ],
};
