import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { incidentValidityAuditTable } from "@workspace/db";

describe("incident validity audit history index", () => {
  it("declares a non-unique chronological lookup index in Drizzle schema", () => {
    const [lookup] = getTableConfig(incidentValidityAuditTable).indexes
      .filter((candidate) => candidate.config.name === "incident_validity_audit_lookup_idx");
    expect(lookup).toBeDefined();
    expect(lookup.config.unique).toBe(false);
    expect(lookup.config.columns).toHaveLength(4);
  });

  it("boot migration replaces the legacy unique index idempotently", () => {
    const migration = readFileSync(join(
      __dirname, "..", "..", "artifacts", "api-server", "src", "lib", "migrations.ts",
    ), "utf8");
    expect(migration).toContain(
      "DROP INDEX IF EXISTS incident_validity_audit_url_version_fingerprint_idx",
    );
    expect(migration).toContain(
      "CREATE INDEX IF NOT EXISTS incident_validity_audit_lookup_idx",
    );
    expect(migration).not.toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS incident_validity_audit_url_version_fingerprint_idx",
    );
  });
});