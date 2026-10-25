/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['postgres', 'razorpay'],
  async redirects() {
    // Links to the old single-page prototype
    return [{ source: '/index.html', destination: '/', permanent: true }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Camera is needed by the gate scanner only
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          // Anti-clickjacking without restricting scripts, so the Cashfree/Razorpay checkout keeps working
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        ],
      },
      {
        // Smart QR public ticket page: never cached, never indexed, never leaks its URL as a referrer
        source: '/t/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
