import { redirectionIoWebpackWasmRule } from "@redirection.io/vercel-middleware/webpack";

/** @type {import("next").NextConfig} */
const nextConfig = {
    experimental: {
        instrumentationHook: true,
    },
    webpack: (config, { nextRuntime }) => {
        if (nextRuntime === "nodejs") {
            config.module.rules.push(redirectionIoWebpackWasmRule);
        }

        return config;
    },
};

export default nextConfig;
