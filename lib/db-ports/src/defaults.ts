import type { DbPortsSettings, DbPortsSource, DbPortsWatchTarget } from "@workspace/api-client-react";

function source(
  id: string, name: string, country: string, url: string,
  themes: DbPortsSource["themes"], language = "English",
): DbPortsSource {
  return {
    id, name, country, url, themes, language, sourceType: "official", accessMode: "manual",
    status: "pending",
    expectedCadence: "",
    reliability: "unassessed",
    manualReviewRequired: true,
    lastSuccessfulCheckAt: null,
    lastRelevantItemDate: null,
    lastRelevantItemUrl: null,
    notes: "Manual source review only. Check the original notice, issue date and access/retention terms. No automated collection or coverage claim.",
  };
}

function target(id: string, name: string, country: string, aliases: string[] = []): DbPortsWatchTarget {
  return { id, name, country, kind: "port", aliases, confirmedClientAsset: false, active: true };
}

/** These are research coverage targets, not the client's operating footprint.
 * A source appearing here is not proof it was checked or licensed for scraping. */
export const DEFAULT_DB_PORTS_SETTINGS: DbPortsSettings = {
  revision: 0,
  updatedAt: null,
  notes: "Internal pilot only. Every initial asset is a provisional coverage target, not a confirmed DB Ports asset. Manual primary-source checks complement existing discovery feeds; no continuous dedicated collector is enabled.",
  sources: [
    source("recaap", "ReCAAP Information Sharing Centre", "Regional", "https://www.recaap.org/", ["security", "cargo"]),
    source("mpa", "Maritime and Port Authority of Singapore", "Singapore", "https://www.mpa.gov.sg/home", ["operations", "security", "regulatory"]),
    source("sg-customs", "Singapore Customs", "Singapore", "https://www.customs.gov.sg/", ["regulatory", "cargo"]),
    source("my-marine", "Malaysia Marine Department", "Malaysia", "https://www.marine.gov.my/", ["operations", "security"], "Malay / English"),
    source("port-klang", "Port Klang Authority", "Malaysia", "https://www.pka.gov.my/", ["operations", "cargo"], "Malay / English"),
    source("pelindo", "Pelindo", "Indonesia", "https://pelindo.co.id/", ["operations", "cargo"], "Indonesian"),
    source("bmkg", "BMKG maritime weather", "Indonesia", "https://maritim.bmkg.go.id/", ["hazards"], "Indonesian"),
    source("ppa", "Philippine Ports Authority", "Philippines", "https://www.ppa.com.ph/", ["operations", "regulatory"]),
    source("pagasa", "PAGASA", "Philippines", "https://www.pagasa.dost.gov.ph/", ["hazards"]),
    source("hk-marine", "Hong Kong Marine Department", "Hong Kong", "https://www.mardep.gov.hk/", ["operations", "security", "regulatory"], "Chinese / English"),
    source("hk-ebs", "Hong Kong electronic port formalities", "Hong Kong", "https://ebs.mardep.gov.hk/", ["operations", "regulatory"], "Chinese / English"),
    source("china-msa", "China Maritime Safety Administration", "China", "https://www.msa.gov.cn/", ["operations", "security", "regulatory"], "Chinese"),
    source("taiwan-mpb", "Taiwan Maritime and Port Bureau", "Taiwan", "https://www.motcmpb.gov.tw/", ["operations", "regulatory"], "Chinese"),
    source("japan-mlit", "Japan Ministry of Land, Infrastructure, Transport and Tourism", "Japan", "https://www.mlit.go.jp/", ["operations", "regulatory"], "Japanese"),
    source("osaka-customs", "Osaka Customs", "Japan", "https://www.customs.go.jp/osaka/index.htm", ["regulatory", "cargo"], "Japanese"),
    source("jma", "Japan Meteorological Agency", "Japan", "https://www.jma.go.jp/", ["hazards"], "Japanese / English"),
    source("busan", "Busan Port Authority", "South Korea", "https://www.busanpa.com/", ["operations", "cargo"], "Korean / English"),
    source("amsa", "Australian Maritime Safety Authority", "Australia", "https://www.amsa.gov.au/", ["security", "operations", "regulatory"]),
    source("nsw-ports", "Port Authority of New South Wales", "Australia", "https://www.portauthoritynsw.com.au/", ["operations", "hazards"]),
    source("bom", "Australian Bureau of Meteorology", "Australia", "https://www.bom.gov.au/", ["hazards"]),
    source("maritime-nz", "Maritime New Zealand", "New Zealand", "https://www.maritimenz.govt.nz/", ["operations", "regulatory"]),
    source("auckland", "Port of Auckland", "New Zealand", "https://www.poal.co.nz/", ["operations", "cargo"]),
    source("fiji-ports", "Fiji Ports", "Fiji", "https://fijiports.com.fj/", ["operations", "cargo"]),
    source("fiji-customs", "Fiji Revenue and Customs Service", "Fiji", "https://frcs.org.fj/", ["regulatory", "cargo"]),
    source("png-ports", "PNG Ports", "Papua New Guinea", "https://pngports.com.pg/", ["operations", "cargo"]),
  ],
  watchlist: [
    target("singapore", "Port of Singapore", "Singapore", ["Singapore Strait", "Tuas", "Pasir Panjang"]),
    target("klang", "Port Klang", "Malaysia", ["Northport", "Westports"]),
    target("priok", "Tanjung Priok", "Indonesia", ["Jakarta port"]),
    target("manila", "Port of Manila", "Philippines", ["Manila International Container Terminal", "MICT"]),
    target("laem-chabang", "Laem Chabang", "Thailand"),
    target("cai-mep", "Cai Mep–Thi Vai", "Vietnam", ["Cai Mep", "Thi Vai"]),
    target("hong-kong", "Port of Hong Kong", "Hong Kong", ["Kwai Tsing"]),
    target("shanghai", "Port of Shanghai", "China", ["Yangshan"]),
    target("kaohsiung", "Port of Kaohsiung", "Taiwan", ["Kaohsiung"]),
    target("busan", "Port of Busan", "South Korea", ["Busan"]),
    target("yokohama", "Port of Yokohama", "Japan", ["Yokohama"]),
    target("melbourne", "Port of Melbourne", "Australia", ["Melbourne port"]),
    target("auckland", "Port of Auckland", "New Zealand", ["Auckland port"]),
    target("suva", "Port of Suva", "Fiji", ["Suva port"]),
    target("lae", "Port of Lae", "Papua New Guinea", ["Lae port"]),
  ],
};