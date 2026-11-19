import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/chars/lock': ['./firebase/firestore.production.rules', './firebase/firestore.rules'],
  },
};

export default nextConfig;
