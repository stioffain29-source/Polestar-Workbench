# Threat Model

## Project Overview

Polestar Advisory Workbench is a public, browser-based intelligence workbench backed by an Express 5 API and PostgreSQL. The production-reachable surface is the React workbench in `artifacts/workbench/src` and the API mounted at `/api` from `artifacts/api-server/src`. The deployment is public, so every unauthenticated route is internet-reachable unless explicitly gated in server code.

## Assets

- **Operational intelligence data** — incidents, strikes, country baselines, and report content drive the product’s analysis. Unauthorized changes can poison analyst outputs and published reporting.
- **Draft and unpublished reports** — draft/review reports contain analyst-written narrative and business-sensitive work in progress that should not be exposed to the public internet by default.
- **Source operations metadata** — source health, failures, notes, and onboarding gaps reveal internal collection coverage and operational weaknesses.
- **Production data integrity** — the app’s value depends on the database reflecting trusted ingestion and analyst actions only.
- **Administrative secrets** — `INGEST_ADMIN_TOKEN` gates ingestion and source mutations. Leakage or bypass would allow privileged operational actions.

## Trust Boundaries

- **Browser to API** — all workbench interactions cross from an untrusted client into the API. The browser UI does not provide security; every privileged action must be enforced server-side.
- **API to PostgreSQL** — route handlers have direct read/write access to production data. Missing authorization at the route layer becomes full data tampering or disclosure.
- **API to external data sources** — ingest code fetches external feeds and FRED data. Upstream content must be treated as untrusted input.
- **Public internet to internal operations boundary** — the deployment is public, but much of the UI and API is operational in nature (report builder, source health, baselines). Internal-only data must not rely on obscurity.
- **Development-only artifacts to production** — `artifacts/mockup-sandbox` is assumed dev-only and out of scope unless future scans show production reachability.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*`, `artifacts/workbench/src/App.tsx`
- **Highest-risk code areas:** mutating API routes in `routes/incidents.ts`, `routes/reports.ts`, `routes/strikes.ts`, `routes/countries.ts`, `routes/baselines.ts`; operational aggregation in `routes/dashboard.ts`
- **Privileged boundary:** `requireAdminToken` (backed by `INGEST_ADMIN_TOKEN`) gates admin ingest, source mutations, backfill, and all workbench write routes; read routes remain public
- **Dev-only area to usually ignore:** `artifacts/mockup-sandbox`

## Threat Categories

### Spoofing / Broken Access Control

The application currently exposes a public workbench with no user authentication layer in the browser and only selective token checks in the API. Any route that changes operational data or exposes internal-only workbench data must enforce server-side authorization. Possession of the public URL must never be treated as proof of authorization.

### Tampering

Incidents, strikes, country baselines, and reports are stored directly from API requests. The system must guarantee that only trusted operators or ingestion jobs can create, update, or delete this data. Zod validation is useful for shape checking, but it does not provide authorization or protect business integrity.

### Information Disclosure

Draft reports, source failures, operational notes, and unpublished pipeline state are sensitive internal data. Public endpoints and UI routes must not expose these records unless the product explicitly intends them to be public. Error messages and operational metadata should be shared only with authenticated operators.

### Denial of Service

Operational routes that trigger ingestion or expensive broad queries must remain protected against internet-scale abuse. The admin ingest route already has a token gate and lock; future privileged or high-cost operations should follow the same pattern.

### Elevation of Privilege

The central privilege boundary is the difference between public read access, internal operational read access, and administrative write actions. The API must not allow anonymous users to cross from public viewer to operator or admin capabilities by calling endpoints directly.