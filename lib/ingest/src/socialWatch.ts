import {
  db,
  socialWatchItemsTable,
  type InsertSocialWatchItem,
} from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { fetchBody } from "./feedFetch";
import { recordSourceHealth } from "./sourceHealth";

// KAMMI Pusat public social-media protest WATCH ingest (Instagram + Telegram).
//
// This is ADDITIVE CONTEXT, modelled on reliefwebReports / maritimeMovement: a
// social-watch item is NEVER an incident and lives in its own table precisely
// so a mobilisation / "planned protest" post can never inflate any incident
// count. The ONLY path into `incidents` is the explicit, gated promote action
// (routes/socialWatch.ts) and only for an item whose text/image confirms the
// protest is actually active.
//
// SCOPE: KAMMI Pusat's confirmed OFFICIAL PUBLIC channels only. Instagram is
// pulled through a paid third-party scraper (provider-agnostic, keyed on a
// secret requested via the environment-secrets flow). Telegram is read for free
// from the public web channel view (server-rendered, no login, no bot token).
//
// PRIVACY (enforced in code): only PUBLIC posts are ever requested. No private
// Telegram groups, WhatsApp content, phone numbers, personal-account
// identifiers or member-level data are fetched or stored. Captions are
// sanitised (sanitiseCaption) before persistence.
//
// Like every ingest module it NEVER throws (all failures captured in the
// returned summary) and NEVER closes the shared DB pool (only the CLI wrapper
// does).

// --- Config ------------------------------------------------------------------

// Confirmed official handles (June 2026): Instagram @kammi.pusat, Telegram
// public channel KAMMI_MuslimNegarawan (Humas PP KAMMI). Both overridable by
// env so the monitored channel can change without a code edit.
const DEFAULT_INSTAGRAM_HANDLE = "kammi.pusat";
const DEFAULT_TELEGRAM_CHANNEL = "KAMMI_MuslimNegarawan";
const DEFAULT_INSTAGRAM_PROVIDER = "apify";
const DEFAULT_INSTAGRAM_ACTOR = "apify~instagram-scraper";
const DEFAULT_INSTAGRAM_BASE = "https://api.apify.com";

const SOURCE_NAME = "social_watch";
const ACTOR_NAME = "KAMMI Pusat";

// Source Health rows live under the flashpoint topic (the Protests & Civil
// Unrest monitor reads flashpoint), so the two new entries sit with the other
// Indonesia protest collection.
const HEALTH_TOPIC = "flashpoint";
export const SOCIAL_WATCH_IG_HEALTH_NAME = "KAMMI Instagram (Social Watch)";
export const SOCIAL_WATCH_TG_HEALTH_NAME = "KAMMI Telegram (Social Watch)";

const MAX_ITEMS_DEFAULT = 40;
const FETCH_TIMEOUT_MS = 20000;
const FETCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2500;

export interface SocialWatchConfig {
  enabled: boolean;
  instagram: {
    handle: string;
    provider: string;
    apiKey: string;
    apiBase: string;
    actor: string;
    enabled: boolean;
    /** True when a key is present and the source is not switched off. */
    configured: boolean;
  };
  telegram: {
    channel: string;
    enabled: boolean;
    /** Telegram needs no key — "configured" means a channel is set + enabled. */
    configured: boolean;
  };
  maxItems: number;
}

function envFlag(name: string, dflt: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return dflt;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

export function readSocialWatchConfig(): SocialWatchConfig {
  const enabled = envFlag("SOCIAL_WATCH_ENABLED", true);

  const igKey = process.env.INSTAGRAM_API_KEY?.trim() || "";
  const igEnabled = envFlag("INSTAGRAM_ENABLED", true);
  const igConfigured = enabled && igEnabled && igKey.length > 0;

  const tgChannel =
    process.env.KAMMI_TELEGRAM_CHANNEL?.trim() || DEFAULT_TELEGRAM_CHANNEL;
  const tgEnabled = envFlag("TELEGRAM_ENABLED", true);
  const tgConfigured = enabled && tgEnabled && tgChannel.length > 0;

  const maxRaw = Number(process.env.SOCIAL_WATCH_MAX_ITEMS);
  const maxItems = Number.isFinite(maxRaw)
    ? Math.min(120, Math.max(5, Math.trunc(maxRaw)))
    : MAX_ITEMS_DEFAULT;

  return {
    enabled,
    instagram: {
      handle:
        process.env.KAMMI_INSTAGRAM_HANDLE?.trim() || DEFAULT_INSTAGRAM_HANDLE,
      provider:
        process.env.INSTAGRAM_PROVIDER?.trim() || DEFAULT_INSTAGRAM_PROVIDER,
      apiKey: igKey,
      apiBase: process.env.INSTAGRAM_API_BASE?.trim() || DEFAULT_INSTAGRAM_BASE,
      actor: process.env.INSTAGRAM_ACTOR?.trim() || DEFAULT_INSTAGRAM_ACTOR,
      enabled: igEnabled,
      configured: igConfigured,
    },
    telegram: {
      channel: tgChannel,
      enabled: tgEnabled,
      configured: tgConfigured,
    },
    maxItems,
  };
}

export function isSocialWatchActive(cfg = readSocialWatchConfig()): boolean {
  return cfg.enabled && (cfg.instagram.configured || cfg.telegram.configured);
}

// --- Keyword / classification vocabulary ------------------------------------

// Protest-relevance cues within the KAMMI channels. The channel scope is fixed
// to KAMMI official accounts; these tune which posts are protest-relevant (the
// list does NOT open up arbitrary account search).
const RELEVANCE_CUES: readonly RegExp[] = [
  /\bkammi\b/i,
  /indonesia\s+darurat/i,
  /\bdpr\b|\bmpr\b/i,
  /gedung\s+dpr/i,
  /\bsenayan\b/i,
  /\bmonas\b/i,
  /\baksi\b/i,
  /aksi\s+mahasiswa/i,
  /22\s+juni/i,
  /reformati\s+indonesia/i, // literal, as written in the brief
  /reformasi\s+indonesia/i, // likely-intended spelling
  /\bmbg\b/i,
  /\bdemonstrasi\b|\bdemo\b/i,
  /\bunjuk\s+rasa\b/i,
  /\blong\s+march\b/i,
  /turun\s+ke\s+jalan/i,
];

// Bahasa-ASCII status word-lists (the project's curated-marker approach: Bahasa
// is Latin/ASCII so a word-list is the gate, not script detection).
const ACTIVE_CUES: readonly RegExp[] = [
  /\bsedang\b/i,
  /berlangsung/i,
  /turun\s+ke\s+jalan/i,
  /\blong\s+march\b/i,
  /bergerak/i,
  /merangsek/i,
  /memadati/i,
  /berkumpul/i,
  /\bmassa\b.*\b(memadati|berkumpul|bergerak|tiba)\b/i,
  /\bmulai\b.*\baksi\b/i,
  /aksi\s+(dimulai|berlangsung|tengah)/i,
  /\bduduki\b|menduduki/i,
  /\bblokade\b|memblokir|tutup\s+jalan/i,
];
const DISPERSED_CUES: readonly RegExp[] = [
  /dibubarkan/i,
  /\bbubar\b/i,
  /gas\s+air\s+mata/i,
  /\btear\s*gas\b/i,
  /water\s*cannon/i,
  /\bricuh\b/i,
  /\bbentrok\b/i,
  /\bbentrokan\b/i,
  /represif/i,
  /pukul\s+mundur/i,
  /dipukul\s+mundur/i,
];
const ARREST_CUES: readonly RegExp[] = [
  /ditangkap/i,
  /penangkapan/i,
  /diamankan/i,
];
const CANCELLED_CUES: readonly RegExp[] = [
  /\bbatal\b/i,
  /dibatalkan/i,
  /ditunda/i,
  /penundaan/i,
];
const PLANNED_CUES: readonly RegExp[] = [
  /\bakan\b/i,
  /\bajakan\b/i,
  /\bseruan\b/i,
  /\bmari\b/i,
  /\bgabung\b|bergabung/i,
  /rencana/i,
  /\bbesok\b|\bnanti\b/i,
  /jadwal/i,
  /catat\s+tanggal/i,
  /save\s+the\s+date/i,
  /serentak/i,
];

export type SocialWatchStatus =
  | "planned"
  | "active"
  | "dispersed"
  | "cancelled"
  | "unclear";

export const SOCIAL_WATCH_STATUSES: readonly SocialWatchStatus[] = [
  "planned",
  "active",
  "dispersed",
  "cancelled",
  "unclear",
];

function anyMatch(text: string, res: readonly RegExp[]): boolean {
  return res.some((re) => re.test(text));
}

export function isProtestRelevant(text: string): boolean {
  return anyMatch(text, RELEVANCE_CUES);
}

/** Derive the protest status from Bahasa text/image cues. */
export function classifyStatus(text: string, hasImages: boolean): SocialWatchStatus {
  if (anyMatch(text, CANCELLED_CUES)) return "cancelled";
  if (anyMatch(text, DISPERSED_CUES)) return "dispersed";
  if (anyMatch(text, ARREST_CUES)) return "active"; // an arrest confirms an active protest
  if (anyMatch(text, ACTIVE_CUES)) return "active";
  // A crowd image plus a present-tense gathering word reads as active.
  if (hasImages && /\bmassa\b|\bkerumunan\b|\bbarisan\b/i.test(text)) return "active";
  if (anyMatch(text, PLANNED_CUES)) return "planned";
  return "unclear";
}

/**
 * Promotion eligibility: only items whose text/image confirms the protest is
 * active/gathering/marching/blocked/dispersed/arrested/clashing are eligible.
 * Planned/mobilisation, cancelled and unclear items are NEVER promotable.
 */
export function isPromotable(status: SocialWatchStatus, text: string): boolean {
  if (status === "active" || status === "dispersed") return true;
  if (anyMatch(text, ARREST_CUES)) return true;
  return false;
}

// --- Venues / location -------------------------------------------------------

interface VenueRule {
  re: RegExp;
  location: string;
  city: string;
  province: string | null;
  /** Key staging venue the watch-alert "movement from" condition keys on. */
  keyVenue?: boolean;
}

const VENUE_RULES: readonly VenueRule[] = [
  { re: /gedung\s+dpr|dpr\s*\/?\s*mpr|\bmpr\s*ri\b|\bdpr\s*ri\b|\bsenayan\b/i, location: "Gedung DPR/MPR RI", city: "Jakarta", province: "DKI Jakarta", keyVenue: true },
  { re: /\bmonas\b|monumen\s+nasional|medan\s+merdeka/i, location: "Monas / Medan Merdeka", city: "Jakarta", province: "DKI Jakarta", keyVenue: true },
  { re: /bsi\s+tower/i, location: "BSI Tower", city: "Jakarta", province: "DKI Jakarta", keyVenue: true },
  { re: /istana\s+(negara|merdeka|presiden)|\bistana\b/i, location: "Istana Negara", city: "Jakarta", province: "DKI Jakarta" },
  { re: /patung\s+kuda/i, location: "Patung Kuda", city: "Jakarta", province: "DKI Jakarta" },
  { re: /\bgrahadi\b|surabaya/i, location: "Surabaya", city: "Surabaya", province: "Jawa Timur", keyVenue: true },
];

// Other Indonesian cities so an out-of-Jakarta post overrides the Jakarta
// default. Order matters only for display, not correctness.
const CITY_RULES: readonly { re: RegExp; city: string; province: string }[] = [
  { re: /\bsurabaya\b/i, city: "Surabaya", province: "Jawa Timur" },
  { re: /\bbandung\b/i, city: "Bandung", province: "Jawa Barat" },
  { re: /\byogyakarta\b|\bjogja\b|\bjogjakarta\b/i, city: "Yogyakarta", province: "DI Yogyakarta" },
  { re: /\bsemarang\b/i, city: "Semarang", province: "Jawa Tengah" },
  { re: /\bmakassar\b/i, city: "Makassar", province: "Sulawesi Selatan" },
  { re: /\bmedan\b/i, city: "Medan", province: "Sumatera Utara" },
  { re: /\bsolo\b|\bsurakarta\b/i, city: "Surakarta", province: "Jawa Tengah" },
  { re: /\bmalang\b/i, city: "Malang", province: "Jawa Timur" },
  { re: /\bdenpasar\b|\bbali\b/i, city: "Denpasar", province: "Bali" },
  { re: /\bpalembang\b/i, city: "Palembang", province: "Sumatera Selatan" },
];

interface LocationResult {
  location: string | null;
  city: string;
  province: string | null;
}

export function extractLocation(text: string): LocationResult {
  for (const v of VENUE_RULES) {
    if (v.re.test(text)) {
      return { location: v.location, city: v.city, province: v.province };
    }
  }
  for (const c of CITY_RULES) {
    if (c.re.test(text)) return { location: null, city: c.city, province: c.province };
  }
  // Default to Jakarta (KAMMI Pusat's base) when no other city is stated.
  return { location: null, city: "Jakarta", province: "DKI Jakarta" };
}

// --- Issue / campaign --------------------------------------------------------

const ISSUE_RULES: readonly { re: RegExp; label: string }[] = [
  { re: /indonesia\s+darurat/i, label: "Indonesia Darurat" },
  { re: /reform(at|as)i\s+indonesia/i, label: "Reformasi Indonesia" },
  { re: /\bmbg\b/i, label: "MBG" },
  { re: /22\s+juni/i, label: "Aksi 22 Juni" },
  { re: /aksi\s+mahasiswa/i, label: "Aksi Mahasiswa" },
];

export function extractIssue(text: string): string | null {
  for (const r of ISSUE_RULES) if (r.re.test(text)) return r.label;
  const tag = text.match(/#([A-Za-z0-9_]{3,40})/);
  if (tag) return `#${tag[1]}`;
  return null;
}

// --- Event date/time ---------------------------------------------------------

const INDO_MONTHS: Record<string, number> = {
  januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
  juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
};

interface EventDateTime {
  eventDate: Date | null;
  eventTimeText: string | null;
}

/** Best-effort extraction of an Indonesian event date + time from the text. */
export function extractEventDateTime(text: string, now = new Date()): EventDateTime {
  let eventDate: Date | null = null;
  const dm = text.match(
    /\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+(\d{4}))?/i,
  );
  if (dm) {
    const day = Number(dm[1]);
    const month = INDO_MONTHS[dm[2]!.toLowerCase()];
    let year = dm[3] ? Number(dm[3]) : now.getUTCFullYear();
    if (day >= 1 && day <= 31 && month !== undefined) {
      let d = new Date(Date.UTC(year, month, day, 5, 0, 0)); // ~12:00 WIB default
      // Without an explicit year, roll forward if the date is well in the past.
      if (!dm[3] && d.getTime() < now.getTime() - 45 * 86400000) {
        year += 1;
        d = new Date(Date.UTC(year, month, day, 5, 0, 0));
      }
      eventDate = d;
    }
  }

  let eventTimeText: string | null = null;
  const tm = text.match(/\b(\d{1,2})[.:](\d{2})\s*(wib|wita|wit)?\b/i);
  if (tm) {
    const hh = Number(tm[1]);
    const mm = Number(tm[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      const zone = tm[3] ? tm[3].toUpperCase() : "WIB";
      eventTimeText = `${String(hh).padStart(2, "0")}.${String(mm).padStart(2, "0")} ${zone}`;
      if (eventDate) {
        // WIB=+7, WITA=+8, WIT=+9 → convert local wall time to UTC.
        const offset = zone === "WIT" ? 9 : zone === "WITA" ? 8 : 7;
        eventDate = new Date(
          Date.UTC(
            eventDate.getUTCFullYear(),
            eventDate.getUTCMonth(),
            eventDate.getUTCDate(),
            hh - offset,
            mm,
            0,
          ),
        );
      }
    }
  }
  return { eventDate, eventTimeText };
}

// --- Watch-alert detection ---------------------------------------------------

const MARCH_ROUTE_CUES: readonly RegExp[] = [
  /\blong\s+march\b/i,
  /\brute\b/i,
  /bergerak\s+menuju/i,
  /\bkonvoi\b/i,
  /\bpawai\b/i,
  /menuju\s+(gedung|istana|monas|dpr)/i,
];
const MOBILISATION_CUES: readonly RegExp[] = [
  /\bajakan\b/i,
  /seruan\s+aksi/i,
  /\bmobilisasi\b/i,
  /konsolidasi\s+nasional/i,
  /seluruh\s+indonesia/i,
  /\bserentak\b/i,
  /mari\s+(turun|bergabung|gabung)/i,
];
const CORDON_CUES: readonly RegExp[] = [
  /\bbarikade\b/i,
  /\bblokade\b/i,
  /tutup\s+jalan|penutupan\s+jalan|jalan\s+ditutup/i,
  /\bcordon\b/i,
  /kawat\s+berduri/i,
];
const MOVEMENT_VERB_CUES: readonly RegExp[] = [
  /bergerak/i,
  /menuju/i,
  /\blong\s+march\b/i,
  /\bkonvoi\b/i,
  /merangsek/i,
  /mundur/i,
  /\bpawai\b/i,
];

/**
 * Detect the watch-alert reasons present on a single post. `prior` is the most
 * recent prior item for the SAME issue/campaign, used to diff location and
 * start-time changes.
 */
export function detectAlertReasons(
  text: string,
  hasImages: boolean,
  loc: LocationResult,
  eventTimeText: string | null,
  status: SocialWatchStatus,
  prior?: { location: string | null; eventTimeText: string | null } | null,
): string[] {
  const reasons: string[] = [];
  if (anyMatch(text, MARCH_ROUTE_CUES)) reasons.push("March route announced");
  if (anyMatch(text, MOBILISATION_CUES)) reasons.push("Call for wider mobilisation");
  if (anyMatch(text, CORDON_CUES)) reasons.push("Police cordon / road closure");
  if (anyMatch(text, ARREST_CUES)) reasons.push("Arrest reported");
  if (anyMatch(text, DISPERSED_CUES)) reasons.push("Dispersal / clash reported");
  if (hasImages && status === "active") reasons.push("Crowd images: active gathering");

  // Movement from a key staging venue (DPR/MPR, Monas, BSI Tower, central
  // Surabaya) — flagged when a movement verb co-occurs with a key venue.
  const keyVenue = VENUE_RULES.find((v) => v.keyVenue && v.re.test(text));
  if (keyVenue && anyMatch(text, MOVEMENT_VERB_CUES)) {
    reasons.push(`Movement from ${keyVenue.location}`);
  }

  // Diffs against the prior post for the same event.
  if (prior) {
    if (
      loc.location &&
      prior.location &&
      loc.location.toLowerCase() !== prior.location.toLowerCase()
    ) {
      reasons.push("Location changed");
    }
    if (
      eventTimeText &&
      prior.eventTimeText &&
      eventTimeText.toLowerCase() !== prior.eventTimeText.toLowerCase()
    ) {
      reasons.push("Start time changed");
    }
  }
  return Array.from(new Set(reasons));
}

// --- Privacy sanitisation ----------------------------------------------------

/**
 * Strip private/personal data from a caption before it is stored: phone
 * numbers (Indonesian +62 / 08… and generic international forms), WhatsApp
 * links/numbers, and email addresses. Public hashtags and @org mentions are
 * preserved. This is a hard guardrail — member-level/personal data must never
 * be persisted.
 */
export function sanitiseCaption(raw: string): string {
  let t = raw;
  // wa.me / api.whatsapp.com links with numbers.
  t = t.replace(/https?:\/\/(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/\S+/gi, "[removed]");
  t = t.replace(/\bwhats?app\b\s*[:#]?\s*\+?\d[\d\s().-]{6,}\d/gi, "[removed]");
  // Email addresses.
  t = t.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[removed]");
  // Indonesian + generic phone numbers (+62…, 08…, or 9+ digit runs).
  t = t.replace(/\+62[\d\s().-]{7,}\d/g, "[removed]");
  t = t.replace(/\b08\d[\d\s().-]{6,}\d/g, "[removed]");
  t = t.replace(/\+?\d[\d\s().-]{9,}\d/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 10 ? "[removed]" : m;
  });
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

// --- Dedup fingerprint -------------------------------------------------------

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function imageFingerprint(urls: string[]): string {
  if (urls.length === 0) return "";
  // Use the path basename (without query) of the first image so a CDN re-host
  // with different query params still collapses.
  const first = urls[0]!;
  const noQuery = first.split("?")[0]!;
  const base = noQuery.split("/").filter(Boolean).pop() ?? noQuery;
  return base.toLowerCase();
}

/** Content/image fingerprint so reposts (incl. cross-platform) collapse to one. */
export function makeDedupKey(caption: string, imageUrls: string[]): string {
  const normCaption = caption
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 160);
  const img = imageFingerprint(imageUrls);
  return `sw_${djb2(`${normCaption}|${img}`)}`;
}

// --- Raw post shape ----------------------------------------------------------

export interface RawSocialPost {
  platform: "instagram" | "telegram";
  channel: string;
  externalId: string;
  url: string;
  caption: string;
  imageUrls: string[];
  postedAt: Date | null;
  /** True when the post is a forward/repost (lowers confidence to medium). */
  isRepost: boolean;
}

// --- Resilient JSON/HTML fetch ----------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        const err = new Error(`status ${res.status}`);
        if (transient && attempt < FETCH_ATTEMPTS - 1) {
          lastErr = err;
          await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
          continue;
        }
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      const aborted = ctrl.signal.aborted;
      if (attempt < FETCH_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      } else {
        throw aborted ? new Error(`timed out after ${FETCH_TIMEOUT_MS}ms`) : err;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchHtmlWithRetry(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchBody(url, FETCH_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// --- Instagram (paid provider, public posts only) ---------------------------

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normaliseInstagramPost(raw: unknown, handle: string): RawSocialPost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id) || asString(r.shortCode) || asString(r.shortcode);
  const shortCode = asString(r.shortCode) || asString(r.shortcode);
  if (!id && !shortCode) return null;
  const externalId = id || shortCode;

  let url = asString(r.url);
  if (!url && shortCode) url = `https://www.instagram.com/p/${shortCode}/`;
  if (!url) return null;

  const caption = asString(r.caption) || asString(r.text);

  const imageUrls: string[] = [];
  const display = asString(r.displayUrl) || asString(r.imageUrl) || asString(r.thumbnailUrl);
  if (display) imageUrls.push(display);
  if (Array.isArray(r.images)) {
    for (const im of r.images) {
      const s = typeof im === "string" ? im : asString((im as Record<string, unknown>)?.url);
      if (s) imageUrls.push(s);
    }
  }

  let postedAt: Date | null = null;
  const ts = r.timestamp ?? r.taken_at ?? r.takenAt;
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) postedAt = d;
  } else if (typeof ts === "number") {
    const d = new Date(ts > 1e12 ? ts : ts * 1000);
    if (!Number.isNaN(d.getTime())) postedAt = d;
  }

  // Public-data guard: only retain caption/image/time/url + channel. Owner is
  // the monitored official handle; we never store other personal account data.
  return {
    platform: "instagram",
    channel: handle,
    externalId: `ig_${externalId}`,
    url,
    caption,
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 6),
    postedAt,
    isRepost: false,
  };
}

async function fetchInstagramPosts(cfg: SocialWatchConfig): Promise<RawSocialPost[]> {
  const ig = cfg.instagram;
  if (ig.provider !== "apify") {
    throw new Error(
      `Instagram provider "${ig.provider}" not implemented (only "apify" is supported)`,
    );
  }
  // Apify run-sync-get-dataset-items endpoint for the Instagram scraper actor.
  // The key is the Apify token; it is sent as a query param per Apify's API and
  // NEVER stored or surfaced. Only PUBLIC profile posts are requested.
  const url = `${ig.apiBase}/v2/acts/${encodeURIComponent(ig.actor)}/run-sync-get-dataset-items?token=${encodeURIComponent(ig.apiKey)}`;
  const input = {
    directUrls: [`https://www.instagram.com/${ig.handle}/`],
    resultsType: "posts",
    resultsLimit: cfg.maxItems,
    addParentData: false,
  };
  const json = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  const arr = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).items)
      ? ((json as Record<string, unknown>).items as unknown[])
      : [];
  const out: RawSocialPost[] = [];
  for (const item of arr) {
    const norm = normaliseInstagramPost(item, ig.handle);
    if (norm) out.push(norm);
  }
  return out;
}

// --- Telegram (free public web channel view, no login) ----------------------

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseTelegramHtml(html: string, channel: string): RawSocialPost[] {
  const out: RawSocialPost[] = [];
  // Each public message carries data-post="channel/<id>". Slice the document at
  // those anchors so we process one message block at a time.
  const anchorRe = /data-post="([^"]+\/(\d+))"/g;
  const anchors: { idx: number; postPath: string; id: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    anchors.push({ idx: m.index, postPath: m[1]!, id: m[2]! });
  }
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i]!.idx;
    const end = i + 1 < anchors.length ? anchors[i + 1]!.idx : html.length;
    const block = html.slice(start, end);

    const textMatch = block.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    const caption = textMatch ? stripTags(textMatch[1]!) : "";

    const imageUrls: string[] = [];
    const photoRe = /background-image:\s*url\(['"]?([^'")]+)['"]?\)/g;
    let p: RegExpExecArray | null;
    while ((p = photoRe.exec(block)) !== null) {
      if (/cdn|telesco|telegram/i.test(p[1]!)) imageUrls.push(p[1]!);
    }

    let postedAt: Date | null = null;
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    if (timeMatch) {
      const d = new Date(timeMatch[1]!);
      if (!Number.isNaN(d.getTime())) postedAt = d;
    }

    const isRepost = /tgme_widget_message_forwarded_from/.test(block);

    if (!caption && imageUrls.length === 0) continue;

    out.push({
      platform: "telegram",
      channel,
      externalId: `tg_${anchors[i]!.id}`,
      url: `https://t.me/${anchors[i]!.postPath}`,
      caption,
      imageUrls: Array.from(new Set(imageUrls)).slice(0, 6),
      postedAt,
      isRepost,
    });
  }
  return out;
}

async function fetchTelegramPosts(cfg: SocialWatchConfig): Promise<RawSocialPost[]> {
  // Public, server-rendered channel view — no login, no bot token, no private
  // groups. The /s/ path is the public preview page.
  const url = `https://t.me/s/${encodeURIComponent(cfg.telegram.channel)}`;
  const html = await fetchHtmlWithRetry(url);
  const posts = parseTelegramHtml(html, cfg.telegram.channel);
  // Newest last in the page; cap to the configured window.
  return posts.slice(-cfg.maxItems);
}

// --- Summary types -----------------------------------------------------------

export interface PlatformResult {
  configured: boolean;
  fetchOk: boolean;
  fetched: number;
  relevant: number;
  error: string | null;
}

export interface SocialWatchSummary {
  source: "social_watch";
  mode: "commit" | "dry-run";
  active: boolean;
  instagram: PlatformResult;
  telegram: PlatformResult;
  fetched: number;
  relevant: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  alertsRaised: number;
  totalAfter: number;
  latestPostedAt: string | null;
  errors: string[];
  logLines: string[];
}

export function emptySocialWatchSummary(): SocialWatchSummary {
  const cfg = readSocialWatchConfig();
  const pr = (configured: boolean): PlatformResult => ({
    configured,
    fetchOk: true,
    fetched: 0,
    relevant: 0,
    error: null,
  });
  return {
    source: "social_watch",
    mode: "dry-run",
    active: isSocialWatchActive(cfg),
    instagram: pr(cfg.instagram.configured),
    telegram: pr(cfg.telegram.configured),
    fetched: 0,
    relevant: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    alertsRaised: 0,
    totalAfter: 0,
    latestPostedAt: null,
    errors: [],
    logLines: [],
  };
}

async function tableStats(): Promise<{ total: number; latest: Date | null }> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      // drizzle's max() comes back as an ISO STRING at runtime (not a Date)
      // despite the type, so coerce it before any Date method is called.
      latest: sql<Date | string | null>`max(${socialWatchItemsTable.postedAt})`,
    })
    .from(socialWatchItemsTable)
    .where(eq(socialWatchItemsTable.sourceName, SOURCE_NAME));
  const latest = row?.latest ?? null;
  return { total: row?.n ?? 0, latest: latest ? new Date(latest) : null };
}

// --- Item assembly -----------------------------------------------------------

interface AssembledItem extends InsertSocialWatchItem {
  dedupKey: string;
}

function assembleItem(post: RawSocialPost): AssembledItem | null {
  const caption = sanitiseCaption(post.caption);
  const haystack = caption; // already sanitised; classification reads text only
  if (!isProtestRelevant(haystack)) return null;

  const hasImages = post.imageUrls.length > 0;
  const status = classifyStatus(haystack, hasImages);
  const loc = extractLocation(haystack);
  const issue = extractIssue(haystack);
  const { eventDate, eventTimeText } = extractEventDateTime(haystack, post.postedAt ?? new Date());
  const promotable = isPromotable(status, haystack);
  // Confidence: official channel post = high; a forward/repost = medium.
  const confidence = post.isRepost ? "medium" : "high";
  const dedupKey = makeDedupKey(caption, post.imageUrls);

  return {
    sourceName: SOURCE_NAME,
    platform: post.platform,
    channel: post.channel,
    actor: ACTOR_NAME,
    externalId: post.externalId,
    postedAt: post.postedAt,
    eventDate,
    eventTimeText,
    caption,
    imageUrls: post.imageUrls,
    location: loc.location,
    city: loc.city,
    province: loc.province,
    issue,
    status,
    confidence,
    url: post.url,
    country: "Indonesia",
    topic: "flashpoint",
    classification: "context",
    dedupKey,
    alertReasons: [],
    promotable,
  };
}

/**
 * Run the KAMMI social-watch ingest. Pulls recent PUBLIC posts from the
 * configured Instagram + Telegram channels, classifies them, de-duplicates
 * reposts, flags watch alerts, and stores NEW items as supporting context.
 * Never throws; never closes the shared pool.
 */
export async function runSocialWatchIngest(
  opts: { commit?: boolean } = {},
): Promise<SocialWatchSummary> {
  const commit = opts.commit ?? false;
  const cfg = readSocialWatchConfig();
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);

  const summary = emptySocialWatchSummary();
  summary.mode = commit ? "commit" : "dry-run";
  summary.active = isSocialWatchActive(cfg);
  summary.logLines = logLines;
  summary.errors = errors;
  log(`social-watch — mode=${commit ? "COMMIT" : "DRY-RUN"} active=${summary.active}`);

  const collected: RawSocialPost[] = [];

  // --- Instagram pass (each platform isolated so one cannot abort the other).
  summary.instagram = {
    configured: cfg.instagram.configured,
    fetchOk: true,
    fetched: 0,
    relevant: 0,
    error: null,
  };
  if (cfg.instagram.configured) {
    try {
      const posts = await fetchInstagramPosts(cfg);
      summary.instagram.fetched = posts.length;
      collected.push(...posts);
      log(`  instagram(@${cfg.instagram.handle}): ${posts.length} public post(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.instagram.fetchOk = false;
      summary.instagram.error = msg;
      errors.push(`instagram: ${msg}`);
      log(`  instagram FETCH ERROR: ${msg}`);
    }
  } else {
    log("  instagram: not configured (INSTAGRAM_API_KEY unset or disabled)");
  }

  // --- Telegram pass.
  summary.telegram = {
    configured: cfg.telegram.configured,
    fetchOk: true,
    fetched: 0,
    relevant: 0,
    error: null,
  };
  if (cfg.telegram.configured) {
    try {
      const posts = await fetchTelegramPosts(cfg);
      summary.telegram.fetched = posts.length;
      collected.push(...posts);
      log(`  telegram(${cfg.telegram.channel}): ${posts.length} public post(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.telegram.fetchOk = false;
      summary.telegram.error = msg;
      errors.push(`telegram: ${msg}`);
      log(`  telegram FETCH ERROR: ${msg}`);
    }
  } else {
    log("  telegram: not configured (no channel or disabled)");
  }

  // --- Classify + relevance-filter.
  const assembled: AssembledItem[] = [];
  for (const post of collected) {
    const item = assembleItem(post);
    if (!item) continue;
    if (post.platform === "instagram") summary.instagram.relevant++;
    else summary.telegram.relevant++;
    assembled.push(item);
  }
  summary.fetched = collected.length;
  summary.relevant = assembled.length;

  // --- In-run dedup by dedupKey (collapses reposts incl. cross-platform).
  const byKey = new Map<string, AssembledItem>();
  for (const item of assembled) {
    const existing = byKey.get(item.dedupKey);
    if (!existing) {
      byKey.set(item.dedupKey, item);
      continue;
    }
    // Prefer the higher-signal copy: a promotable/active item over a planned one.
    if (item.promotable && !existing.promotable) byKey.set(item.dedupKey, item);
  }
  let unique = Array.from(byKey.values());

  // --- Dedup against DB (dedup_key primary; external_id fallback).
  if (unique.length > 0) {
    const keys = unique.map((u) => u.dedupKey);
    const extIds = unique.map((u) => u.externalId);
    const existing = await db
      .select({
        dedupKey: socialWatchItemsTable.dedupKey,
        externalId: socialWatchItemsTable.externalId,
      })
      .from(socialWatchItemsTable)
      .where(
        or(
          inArray(socialWatchItemsTable.dedupKey, keys),
          inArray(socialWatchItemsTable.externalId, extIds),
        ),
      );
    const haveKey = new Set(existing.map((e) => e.dedupKey));
    const haveExt = new Set(existing.map((e) => e.externalId));
    const before = unique.length;
    unique = unique.filter((u) => !haveKey.has(u.dedupKey) && !haveExt.has(u.externalId));
    summary.duplicateInDb = before - unique.length;
  }
  summary.newToInsert = unique.length;

  // --- Watch-alert detection (diffs against the most recent prior item for
  //     the same issue, so location/start-time changes are caught).
  for (const item of unique) {
    let prior: { location: string | null; eventTimeText: string | null } | null = null;
    if (item.issue) {
      const [row] = await db
        .select({
          location: socialWatchItemsTable.location,
          eventTimeText: socialWatchItemsTable.eventTimeText,
        })
        .from(socialWatchItemsTable)
        .where(
          and(
            eq(socialWatchItemsTable.sourceName, SOURCE_NAME),
            eq(socialWatchItemsTable.issue, item.issue),
          ),
        )
        .orderBy(desc(socialWatchItemsTable.postedAt))
        .limit(1);
      prior = row ?? null;
    }
    const reasons = detectAlertReasons(
      item.caption ?? "",
      (item.imageUrls ?? []).length > 0,
      { location: item.location ?? null, city: item.city ?? "Jakarta", province: item.province ?? null },
      item.eventTimeText ?? null,
      (item.status ?? "unclear") as SocialWatchStatus,
      prior,
    );
    item.alertReasons = reasons;
    if (reasons.length > 0) summary.alertsRaised++;
  }

  // --- Persist.
  if (commit && unique.length > 0) {
    const values: InsertSocialWatchItem[] = unique.map(({ dedupKey, ...rest }) => ({
      ...rest,
      dedupKey,
      lastCheckedAt: new Date(),
    }));
    const inserted = await db
      .insert(socialWatchItemsTable)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: socialWatchItemsTable.id });
    summary.inserted = inserted.length;
    log(`  committed: ${summary.inserted} new item(s)`);
  } else if (!commit) {
    log("  DRY-RUN — no rows written.");
  }

  // --- Stamp last-checked on the channels that responded (commit only).
  if (commit) {
    const touched: string[] = [];
    if (summary.instagram.fetchOk && cfg.instagram.configured) touched.push("instagram");
    if (summary.telegram.fetchOk && cfg.telegram.configured) touched.push("telegram");
    if (touched.length > 0) {
      await db
        .update(socialWatchItemsTable)
        .set({ lastCheckedAt: new Date() })
        .where(
          and(
            eq(socialWatchItemsTable.sourceName, SOURCE_NAME),
            inArray(socialWatchItemsTable.platform, touched),
          ),
        );
    }
  }

  // --- Source Health: one entry per platform.
  if (commit) {
    await recordSourceHealthForPlatform(
      SOCIAL_WATCH_IG_HEALTH_NAME,
      `https://www.instagram.com/${cfg.instagram.handle}/`,
      cfg.instagram.configured,
      summary.instagram,
      "KAMMI Pusat Instagram — public protest/mobilisation posts pulled via a paid third-party scraper as supporting CONTEXT (never incidents). Promotion to an incident is explicit and gated.",
    );
    await recordSourceHealthForPlatform(
      SOCIAL_WATCH_TG_HEALTH_NAME,
      `https://t.me/s/${cfg.telegram.channel}`,
      cfg.telegram.configured,
      summary.telegram,
      "KAMMI public Telegram channel — read free from the public web channel view (no login) as supporting CONTEXT (never incidents).",
    );
  }

  const stats = await tableStats();
  summary.totalAfter = stats.total;
  summary.latestPostedAt = stats.latest ? stats.latest.toISOString() : null;
  return summary;
}

async function recordSourceHealthForPlatform(
  name: string,
  url: string,
  configured: boolean,
  result: PlatformResult,
  notes: string,
): Promise<void> {
  if (!configured) {
    await recordSourceHealth(
      HEALTH_TOPIC,
      [{ name, url, ok: false, error: "Integration not configured" }],
      { sourceType: "social", reliability: 3, notes, notConfigured: true },
    );
    return;
  }
  if (result.fetchOk) {
    await recordSourceHealth(
      HEALTH_TOPIC,
      [{ name, url, ok: true }],
      { sourceType: "social", reliability: 3, notes },
    );
    return;
  }
  // Configured but this run failed — treat as pending (awaiting validation /
  // provider-network access), not a hard outage, until it succeeds once.
  await recordSourceHealth(
    HEALTH_TOPIC,
    [{ name, url, ok: false, error: result.error ?? "fetch failed" }],
    { sourceType: "social", reliability: 3, notes, pending: true },
  );
}
