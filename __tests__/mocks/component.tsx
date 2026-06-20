// Generic stub for chart/map child components that block rendering in jest
// (recharts, leaflet). The page-break marker test only asserts the PARENT
// preview's markers (`.pdf-cover-page`, `data-pdf-flow`), so these heavy
// children can render as an inert placeholder.
export default function ComponentStub() {
  return null;
}
