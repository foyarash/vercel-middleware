import type { NextConfig } from "next";
import { redirectionIoWebpackWasmRule } from "@redirection.io/vercel-middleware/webpack";

const nextConfig: NextConfig = {
    webpack: (config, { nextRuntime }) => {
        if (nextRuntime === "nodejs") {
            config.module.rules.push(redirectionIoWebpackWasmRule);
        }

        return config;
    },
};

export default nextConfig;
