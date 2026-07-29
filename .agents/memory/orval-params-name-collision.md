---
name: Orval path/query params name collision
description: api-zod star-export ambiguity when an endpoint has both path and query params
---

When an OpenAPI operation has BOTH path params and query params, orval emits:
- a zod const `<OperationId>Params` (path params) in `lib/api-zod/src/generated/api.ts`
- a TS type `<OperationId>Params` (query params) in `lib/api-zod/src/generated/types/`

The hand-written `lib/api-zod/src/index.ts` star-exports both → `tsc` TS2308
("already exported a member") and codegen's typecheck step fails.

**Why:** hit adding query params to a `/countries/{slug}/engine` GET.

**How to apply:** resolve in the HAND-WRITTEN index (survives regeneration) with an
explicit re-export after the two star exports, e.g.
`export { GetCountryEngineParams } from "./generated/api";`
(the zod const wins; the query-params type stays importable from api-client-react).
