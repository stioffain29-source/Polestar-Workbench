import type {
  DbPortsParameters,
  DbPortsSettings,
  DbPortsSource,
  DbPortsWatchTarget,
} from "@workspace/api-client-react";
import { DB_PORTS_COUNTRIES, DB_PORTS_REPORT_NAME, DB_PORTS_THEMES } from "./rules.js";

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

/** The saved default preset. Geography, themes and exclusions follow the
 * report specification; nothing here asserts a confirmed customer footprint. */
export const DEFAULT_DB_PORTS_PARAMETERS: DbPortsParameters = {
  reportTitle: DB_PORTS_REPORT_NAME,
  customerName: "",
  publicationDate: null,
  targetItems: 12,
  includedCountries: [...DB_PORTS_COUNTRIES],
  includedThemes: [...DB_PORTS_THEMES],
  excludedRegions: [
    "India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Bhutan", "Maldives",
    "Afghanistan", "Middle East", "Red Sea", "Houthi", "Bab el-Mandeb", "Gulf of Aden", "Suez",
  ],
  excludedSubjects: [
    "football", "cricket", "rugby", "basketball", "celebrity", "award ceremony",
    "port anniversary", "quarterly results", "annual results", "memorandum of understanding",
    "groundbreaking ceremony", "cruise ship launch",
  ],
  minimumSeverity: "Low",
  priorityAssets: [
    "Port of Singapore", "Port Klang", "Tanjung Priok", "Port of Manila", "Laem Chabang",
    "Cai Mep–Thi Vai", "Port of Hong Kong", "Port of Shanghai", "Port of Kaohsiung",
    "Port of Busan", "Port of Yokohama", "Port of Melbourne", "Port of Auckland",
    "Port of Suva", "Port of Lae",
  ],
  itemWordTarget: 225,
  overviewWordTarget: 200,
  includeWatchlist: true,
  includeSourceLinks: true,
};

/** These are research coverage targets, not the client's operating footprint.
 * A source appearing here is not proof it was checked or licensed for scraping. */
export const DEFAULT_DB_PORTS_SETTINGS: DbPortsSettings = {
  revision: 0,
  updatedAt: null,
  defaults: DEFAULT_DB_PORTS_PARAMETERS,
  notes: "Every asset listed here is a provisional coverage target, not a confirmed customer asset. Manual primary-source checks complement existing discovery feeds; no continuous dedicated collector is enabled.",
  sources: [
    source("recaap", "ReCAAP Information Sharing Centre", "Regional", "https://www.recaap.org/", ["security_public_order", "cargo_asset_security"]),
    source("mpa", "Maritime and Port Authority of Singapore", "Singapore", "https://www.mpa.gov.sg/home", ["port_terminal_operations", "security_public_order", "regulatory_compliance"]),
    source("sg-customs", "Singapore Customs", "Singapore", "https://www.customs.gov.sg/", ["regulatory_compliance", "cargo_asset_security"]),
    source("my-marine", "Malaysia Marine Department", "Malaysia", "https://www.marine.gov.my/", ["port_terminal_operations", "security_public_order"], "Malay / English"),
    source("port-klang", "Port Klang Authority", "Malaysia", "https://www.pka.gov.my/", ["port_terminal_operations", "cargo_asset_security"], "Malay / English"),
    source("pelindo", "Pelindo", "Indonesia", "https://pelindo.co.id/", ["port_terminal_operations", "cargo_asset_security"], "Indonesian"),
    source("bmkg", "BMKG maritime weather", "Indonesia", "https://maritim.bmkg.go.id/", ["natural_hazards"], "Indonesian"),
    source("ppa", "Philippine Ports Authority", "Philippines", "https://www.ppa.com.ph/", ["port_terminal_operations", "regulatory_compliance"]),
    source("pagasa", "PAGASA", "Philippines", "https://www.pagasa.dost.gov.ph/", ["natural_hazards"]),
    source("hk-marine", "Hong Kong Marine Department", "Hong Kong", "https://www.mardep.gov.hk/", ["port_terminal_operations", "security_public_order", "regulatory_compliance"], "Chinese / English"),
    source("hk-ebs", "Hong Kong electronic port formalities", "Hong Kong", "https://ebs.mardep.gov.hk/", ["port_terminal_operations", "regulatory_compliance"], "Chinese / English"),
    source("china-msa", "China Maritime Safety Administration", "China", "https://www.msa.gov.cn/", ["port_terminal_operations", "security_public_order", "regulatory_compliance"], "Chinese"),
    source("taiwan-mpb", "Taiwan Maritime and Port Bureau", "Taiwan", "https://www.motcmpb.gov.tw/", ["port_terminal_operations", "regulatory_compliance"], "Chinese"),
    source("japan-mlit", "Japan Ministry of Land, Infrastructure, Transport and Tourism", "Japan", "https://www.mlit.go.jp/", ["port_terminal_operations", "regulatory_compliance"], "Japanese"),
    source("osaka-customs", "Osaka Customs", "Japan", "https://www.customs.go.jp/osaka/index.htm", ["regulatory_compliance", "cargo_asset_security"], "Japanese"),
    source("jma", "Japan Meteorological Agency", "Japan", "https://www.jma.go.jp/", ["natural_hazards"], "Japanese / English"),
    source("busan", "Busan Port Authority", "South Korea", "https://www.busanpa.com/", ["port_terminal_operations", "cargo_asset_security"], "Korean / English"),
    source("amsa", "Australian Maritime Safety Authority", "Australia", "https://www.amsa.gov.au/", ["security_public_order", "port_terminal_operations", "regulatory_compliance"]),
    source("nsw-ports", "Port Authority of New South Wales", "Australia", "https://www.portauthoritynsw.com.au/", ["port_terminal_operations", "natural_hazards"]),
    source("bom", "Australian Bureau of Meteorology", "Australia", "https://www.bom.gov.au/", ["natural_hazards"]),
    source("maritime-nz", "Maritime New Zealand", "New Zealand", "https://www.maritimenz.govt.nz/", ["port_terminal_operations", "regulatory_compliance"]),
    source("auckland", "Port of Auckland", "New Zealand", "https://www.poal.co.nz/", ["port_terminal_operations", "cargo_asset_security"]),
    source("fiji-ports", "Fiji Ports", "Fiji", "https://fijiports.com.fj/", ["port_terminal_operations", "cargo_asset_security"]),
    source("fiji-customs", "Fiji Revenue and Customs Service", "Fiji", "https://frcs.org.fj/", ["regulatory_compliance", "cargo_asset_security"]),
    source("png-ports", "PNG Ports", "Papua New Guinea", "https://pngports.com.pg/", ["port_terminal_operations", "cargo_asset_security"]),
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