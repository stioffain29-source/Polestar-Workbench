const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.ts?(x)", "**/?(*.)+(spec|test).ts?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/mocks/"],
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
    // Heavy chart/map children (recharts, leaflet) that block rendering in jest.
    // The page-break marker test only asserts the parent preview's markers, so
    // stub these to an inert placeholder. Must come BEFORE the generic `@/` rule.
    "^@/components/JetFuelTrajectoryChart$":
      "<rootDir>/__tests__/mocks/component.tsx",
    "^@/components/CargoTrendChart$": "<rootDir>/__tests__/mocks/component.tsx",
    "^@/components/IncidentMap$": "<rootDir>/__tests__/mocks/component.tsx",
    "^@/components/SituationalContextSection$":
      "<rootDir>/__tests__/mocks/component.tsx",
    // Workbench `@/` path alias (mirrors vite.config.ts / tsconfig paths).
    "^@/(.*)$": "<rootDir>/artifacts/workbench/src/$1",
    // React + date-fns live in the workbench package, not the repo root, so map
    // the bare specifiers to the workbench copy for rendering tests.
    "^react$": "<rootDir>/artifacts/workbench/node_modules/react",
    "^react-dom/server$":
      "<rootDir>/artifacts/workbench/node_modules/react-dom/server.node.js",
    "^react-dom$": "<rootDir>/artifacts/workbench/node_modules/react-dom",
    "^react/jsx-runtime$":
      "<rootDir>/artifacts/workbench/node_modules/react/jsx-runtime",
    "^react/jsx-dev-runtime$":
      "<rootDir>/artifacts/workbench/node_modules/react/jsx-dev-runtime",
    "^date-fns$": "<rootDir>/artifacts/workbench/node_modules/date-fns",
    "^date-fns/(.*)$": "<rootDir>/artifacts/workbench/node_modules/date-fns/$1",
    "^@workspace/db$": "<rootDir>/__tests__/mocks/db.ts",
    "^@workspace/db/schema$": "<rootDir>/lib/db/src/schema/index.ts",
    "^@workspace/ingest$": "<rootDir>/lib/ingest/src/index.ts",
    "^@workspace/strike-targets$": "<rootDir>/lib/strike-targets/src/index.ts",
    "^@workspace/relevance$": "<rootDir>/lib/relevance/src/index.ts",
    "^@workspace/api-zod$": "<rootDir>/lib/api-zod/src/index.ts",
    "^@workspace/api-client-react$":
      "<rootDir>/lib/api-client-react/src/index.ts",
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
