import type { NextConfig } from "next";

const staticExport=process.env.STATIC_EXPORT==='1';
const basePath=staticExport?(process.env.NEXT_PUBLIC_BASE_PATH??''):'';
if(basePath&&!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(basePath))throw Error('Invalid static base path');
// Resolve build inputs within this application.
const nextConfig: NextConfig = {
  ...(staticExport?{output:'export' as const,trailingSlash:true,basePath}:{}),
  env:{NEXT_PUBLIC_BASE_PATH:basePath},
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
