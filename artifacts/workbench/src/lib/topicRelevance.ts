// Per-topic relevance filter — moved to the shared @workspace/relevance lib
// so ingestion, the API server, and this frontend all evaluate relevance
// with one source of truth (no drift, no per-surface whack-a-mole). This
// file is a thin re-export to keep existing in-app imports stable.
export * from "@workspace/relevance";
