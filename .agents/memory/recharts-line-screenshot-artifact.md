---
name: recharts line-chart screenshot artifact
description: Why recharts LineCharts look "broken/empty on the right" in screenshots but render fine live.
---

# Recharts line-chart draw-animation looks broken in screenshots

A recharts `<Line>` animates by REVEALING left-to-right on mount (`isAnimationActive`
defaults true). A fresh page load + immediate screenshot catches it mid-draw, so the
line appears as a small cluster/checkmark at the FAR LEFT with blank space to the right
— easily mistaken for a data/width bug. Bar charts animate by growing vertically, so
mid-animation they still look full-width — which is why a bar chart in the SAME
ResponsiveContainer renders "correctly" while the line next to it looks empty.

**Why:** Burned real time chasing a "30-day trend only shows early-May" phantom on the
Protests monitor. The timeline data was verified correct (26 days, peaks ~11); only the
screenshot was catching the draw animation early.

**How to apply:** Before concluding a recharts line/area chart is broken, set
`isAnimationActive={false}` and re-screenshot. If the full series appears, it was the
animation. Keeping animation off on dashboard trend lines also makes screenshots/visual
checks reliable with no UX cost. Confirm suspected data bugs with a temporary
`console.log` read back via the screenshot tool's browser-logs output, not by eyeballing
the chart.
