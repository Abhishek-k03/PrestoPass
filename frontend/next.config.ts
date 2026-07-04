import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 1. Treat Prisma as an external server package so Turbopack doesn't bundle it
  serverExternalPackages: ["@prisma/client", "pg"], 
  
  // 2. (Optional) If you use a custom output path in schema.prisma, map the alias here
  turbopack: {
    resolveAlias: {
      "@prisma/client": "./src/generated/prisma", // Adjust path to match your 'output' in schema.prisma
    },
  },
};

export default nextConfig;
