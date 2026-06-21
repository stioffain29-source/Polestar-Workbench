---
name: social-watch promote UI refresh
description: Orval mutations don't auto-invalidate their list query — promoted row stays stale unless the component invalidates.
---

The social-watch Promote action (POST /api/social-watch/{id}/promote) creates
the incident server-side correctly, but the board row would keep showing a live
"Promote" button after a successful click.

**Why:** Orval-generated React Query *mutations* never invalidate related
*queries*. The Protests board reads the list via `useListSocialWatchItems`; the
promote mutation has no knowledge of that cache entry.

**How to apply:** After any Orval mutation that changes data another query
renders, the component must call
`queryClient.invalidateQueries({ queryKey: get<Thing>QueryKey() })` on success
(prefix-match: the no-arg key `["/api/social-watch"]` matches the params'd key).
This applies to every promote/create/update button across the workbench, not
just social-watch.
