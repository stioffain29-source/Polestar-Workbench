const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Clears every known integration secret from process.env before each test so
  // no suite can silently depend on (or be masked by) ambient workspace secrets.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["**/__tests__/**/*.ts?(x)", "**/?(*.)+(spec|test).ts?(x)"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/__tests__/mocks/",
    // Shared non-test helpers live next to the suites that import them; the
    // broad `testMatch` glob would otherwise run them as (empty) suites.
    "/__tests__/.*TestHelpers\\.ts$",
    "/__tests__/ingest/spotReportGuardLib\\.ts$",
  ],
  collectCoverage: process.env.CI === "true",
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  moduleNameMapper: {
    // Asset imports (`@assets/*.png|jpg`, font `.ttf?url`) pulled in transitively
    // by the report preview chrome must not be parsed as JS modules — redirect
    // them to a string stub.
    "^@assets/.*$": "<rootDir>/__tests__/mocks/asset.ts",
    "\\.(ttf|woff2?|png|jpe?g|svg|gif|webp)(\\?url)?$":
      "<rootDir>/__tests__/mocks/asset.ts",
    // CSS imports (e.g. `leaflet/dist/leaflet.css`, pulled in by the Protests
    // page) carry no behaviour for these render tests — stub to a string.
    "\\.css$": "<rootDir>/__tests__/mocks/asset.ts",
    // The api-server source uses NodeNext `.js`-suffixed relative imports (e.g.
    // `../lib/adminAuth.js`). ts-jest does not rewrite those, so strip the
    // extension off relative specifiers and let jest resolve the `.ts` source.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Heavy chart/map children (recharts, leaflet) that block rendering in jest.
    // The page-break marker test only asserts the parent preview's markers, so
    // stub these to an inert placeholder. Must come BEFORE the generic `@/` rule.
    "^@/components/JetFuelTrajectoryChart$":
      "<rootDir>/__tests__/mocks/component.tsx",
    "^@/components/CargoTrendChart$": "<rootDir>/__tests__/mocks/component.tsx",
    "^@/components/IncidentMap$": "<rootDir>/__tests__/mocks/component.tsx",
    "^@/components/CountryReportMap$": "<rootDir>/__tests__/mocks/component.tsx",
    "^@/components/SituationalContextSection$":
      "<rootDir>/__tests__/mocks/component.tsx",
    // Workbench `@/` path alias (mirrors vite.config.ts / tsconfig paths).
    "^@/(.*)$": "<rootDir>/artifacts/workbench/src/$1",
    // React + date-fns live in the workbench package, not the repo root, so map
    // the bare specifiers to the workbench copy for rendering tests.
    "^react$": "<rootDir>/artifacts/workbench/node_modules/react",
    "^react-dom/server$":
      "<rootDir>/artifacts/workbench/node_modules/react-dom/server.node.js",
    "^react-dom/client$":
      "<rootDir>/artifacts/workbench/node_modules/react-dom/client.js",
    "^react-dom/test-utils$":
      "<rootDir>/artifacts/workbench/node_modules/react-dom/test-utils.js",
    "^react-dom$": "<rootDir>/artifacts/workbench/node_modules/react-dom",
    "^react/jsx-runtime$":
      "<rootDir>/artifacts/workbench/node_modules/react/jsx-runtime",
    "^react/jsx-dev-runtime$":
      "<rootDir>/artifacts/workbench/node_modules/react/jsx-dev-runtime",
    "^date-fns$": "<rootDir>/artifacts/workbench/node_modules/date-fns",
    "^date-fns/(.*)$": "<rootDir>/artifacts/workbench/node_modules/date-fns/$1",
    "^@workspace/db$": "<rootDir>/__tests__/mocks/db.ts",
    "^@workspace/db/schema$": "<rootDir>/lib/db/src/schema/index.ts",
    "^@workspace/db/spot-report-limits$":
      "<rootDir>/lib/db/src/spotReportLimits.ts",
    "^@workspace/ingest$": "<rootDir>/lib/ingest/src/index.ts",
    "^@workspace/strike-targets$": "<rootDir>/lib/strike-targets/src/index.ts",
    "^@workspace/relevance$": "<rootDir>/lib/relevance/src/index.ts",
    "^@workspace/country-engine$": "<rootDir>/lib/country-engine/src/index.ts",
    "^@workspace/country-engine/(.*)$":
      "<rootDir>/lib/country-engine/src/$1.ts",
    "^@workspace/api-zod$": "<rootDir>/lib/api-zod/src/index.ts",
    "^@workspace/api-client-react$":
      "<rootDir>/lib/api-client-react/src/index.ts",
    // `@tanstack/react-query` is only installed in the workbench package, not at
    // the repo root, so component tests that need the REAL client (not a
    // `jest.mock`) must be pointed at the workbench copy. Tests that
    // `jest.mock("@tanstack/react-query", ...)` still override this mapping.
    "^@tanstack/react-query$":
      "<rootDir>/artifacts/workbench/node_modules/@tanstack/react-query",
  },
  transform: {
    ...tsJestTransformCfg,
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
};
