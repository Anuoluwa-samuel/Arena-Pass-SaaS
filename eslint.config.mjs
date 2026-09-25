import nextConfig from "eslint-config-next"

const config = [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "server/db/migrations/**", "storage/**", ".data/**", "test-results/**", "playwright-report/**"],
  },
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Generated shadcn/ui primitives: keep upstream code as-is, surface (not fail on) the new hook rules.
    files: ["components/ui/**"],
    rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/purity": "warn" },
  },
  {
    files: ["server/observability/logger.ts", "scripts/**", "tests/**"],
    rules: { "no-console": "off" },
  },
  {
    /**
     * Routes and pages go through a service, which is where the arena filter
     * lives. A handler that opens the database itself is a query nobody
     * reviewed for tenant scope, so the import is refused here — the three
     * files that legitimately need it opt out below.
     */
    files: ["app/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/server/db",
              message:
                "Routes and pages must not query the database directly — call a service in server/services, which scopes the query to an arena.",
            },
            {
              name: "@/server/db/client",
              message: "Routes and pages must not query the database directly — call a service in server/services.",
            },
          ],
        },
      ],
    },
  },
  {
    // The health check has no tenant, and the mock-payment page is a
    // development-only stand-in for the provider's hosted page.
    files: ["app/api/health/route.ts", "app/(public)/checkout/mock-pay/page.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
]

export default config
