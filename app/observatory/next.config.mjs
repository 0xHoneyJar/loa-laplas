/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/sim spawns the graduated producer; make sure serverless bundles
  // carry it (and the contract it imports) when deployed (S5/Vercel).
  outputFileTracingIncludes: {
    "/api/sim": ["./vendor/observatory/**"],
  },
};

export default nextConfig;
