import { needsTitleTranslation } from "../../lib/ingest/src/titleTranslate";

describe("incident title translation detection", () => {
  it.each([
    "Polres Nabire Serahkan Tersangka Pembunuhan Siswi SMP ke Kejaksaan",
    "Polres Nabire serahkan pelaku pembunuhan siswi SMP kepada JPU",
    "Polres Nabire Limpahkan Tersangka Pembunuhan Siswi SMP ke Kejari, Dijerat Pasal Pembunuhan Berencana",
    "Pasca Penembakan, Seluruh Guru dan Nakes Jila Dievakuasi ke Timika",
    "Umat Muslim Jayawijaya Galang Dana Bantu Korban Gempa NTT di Momen Maulid Nabi Muhammad",
    "Umat Muslim Jayawijaya bantu korban gempa NTT",
    "Kebakaran lahan sekitar Bandara Frans Kaisepo Biak telah padam",
  ])("selects the live West Papua Bahasa headline: %s", (title) => {
    expect(needsTitleTranslation(title)).toBe(true);
  });

  it.each([
    "Police probe alleged abduction of nine women in Central Papua",
    "Nine civilians, including children, abducted in Papua",
  ])("does not select an English headline: %s", (title) => {
    expect(needsTitleTranslation(title)).toBe(false);
  });
});