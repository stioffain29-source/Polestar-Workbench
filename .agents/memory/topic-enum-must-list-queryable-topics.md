---
name: OpenAPI Topic enum gates topic-filtered incident fetches
description: A topic missing from the OpenAPI Topic enum makes any topic-filtered /incidents fetch 400 → monitor silently renders zeros.
---

# OpenAPI `Topic` enum must list every topic a page filters by

The `/incidents` route validates its query with the generated
`ListIncidentsQueryParams.safeParse` (which references the OpenAPI `Topic`
enum). If a page calls `useListIncidents({ topic: "<x>" })` for a topic that is
NOT in the enum, the authenticated request fails validation → **400** → the
hook returns `[]` → the whole monitor renders zeros, even though the DB and the
ingest feed are full.

**Why:** the client and server share the SAME generated schema, so an
incomplete enum breaks both sides at once. Country/spot reports dodge this
because they fetch by `countryLike`/`country`, never by `topic`, so a
missing-from-enum topic only bites pages that filter by topic.

**The smell:** a `topic: "<x>" as never` cast on the `useListIncidents` topic
param. The cast silences the compile-time enum error but the runtime `safeParse`
still rejects it. If you see the cast, the topic is missing from the enum.

**How to apply:** when adding (or debugging) a topic-filtered monitor, confirm
the topic is in `lib/api-spec/openapi.yaml` `components.schemas.Topic`, then
`pnpm --filter @workspace/api-spec run codegen`, then restart the api-server +
workbench workflows (codegen corrupts vite HMR). Guard with a source-read jest
test asserting the generated enum has the topic and the page has no `as never`
cast.

**Still-latent gap:** `indonesia_local` and `apac_local` are real ingested
topics also absent from the enum. They are harmless today only because nothing
queries them by `topic` — a future `topic=indonesia_local` monitor would hit the
same 400. The ingest-side `IngestTopic` union (lib/ingest/src/types.ts) is a
separate, more-complete list; do not confuse the two.
