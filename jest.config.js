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
