---
name: Nested route scroll restoration
description: Why Workbench route changes must reset the Layout main scroll container.
---

Workbench page content scrolls inside the `Layout` main container rather than the browser window. Reset both axes on every route change; resetting `window` does not affect the visible page.

**Why:** Navigating from a long report can preserve a scroll position beyond the next report's rendered content. The new route and its API calls succeed, but the user sees an entirely white page because the editor is above the viewport.

**How to apply:** Any routing or layout change must preserve route-change scroll restoration on the actual scrolling element. When a page is blank but its authenticated API calls return 200 and no browser exception appears, inspect the nested container's scroll offsets before changing report data or renderers.