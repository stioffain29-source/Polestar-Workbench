---
name: Market price staleness is usually publisher lag
description: How to test a "prices are stale" report before touching the price ingest.
---

An "as of" date weeks behind today on a commodity card is normally the publisher's release cadence, not a broken feed.

**Why:** the monthly IMF and BLS series behind European gas, thermal coal and US retail electricity publish their workbooks well after the month they cover, and even the daily EIA spot gas series lands several days late. A snapshot refreshed this morning can legitimately show a value from two months ago, so "fixing" the ingest would only churn code.

**How to apply:** fetch the upstream series directly (public CSV, no key) and compare its newest observation with the stored row and the row's refresh timestamp. If they match, the pipeline is current — say so and make the surface state when it was last checked rather than silently showing only an old observation date. Switching a card to a fresher instrument changes what the number means (spot vs front-month futures, different units/currency), so never swap the basis to make a date look newer.
