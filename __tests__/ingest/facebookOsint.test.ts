// Facebook OSINT (Papua / PNG) — pure-unit coverage for the collection-time
// helpers. These lock the SECURITY + NO-FABRICATION invariants that the engine
// and the promote route both depend on:
//   - captions are PII-scrubbed (phone / email / messaging handles removed);
//   - only PNG + Indonesian-Papua posts are in scope;
//   - "credible" is NEVER inferred from prose — only a config-declared tier, a
//     linked allow-listed domain, or a cross-feed corroboration upgrades it;
//   - "promotable" = security-relevant AND credible;
//   - the corroboration scorer (soft) and the duplicate-block (hard) behave at
//     their separate thresholds;
//   - an unkeyed install is inactive (→ not_configured), never half-running.

import {
  sanitiseCaption,
  sanitiseUrl,
  resolveScope,
  normaliseFacebookPost,
  classifyPost,
  classifyPostBroad,
  persistFacebookPosts,
  makeFacebookDedupKey,
  isFacebookOsintActive,
  readFacebookOsintConfig,
  detectCredibleDomains,
  extractHosts,
  deriveEligibility,
  deriveReview,
  computeConfidence,
  detectKeywords,
  categoryToTopic,
  pickCorroboration,
  pickDuplicate,
  normaliseSourceTier,
  type RawFacebookPost,
  type IncidentCandidate,
} from "@workspace/ingest";
import { db } from "@workspace/db";

// ---------------------------------------------------------------------------
// PII redaction (shared with the KAMMI watch sanitiser).
// ---------------------------------------------------------------------------
describe("sanitiseCaption strips contact PII", () => {
  it("removes phone numbers, emails and messaging handles", () => {
    const raw =
      "Hubungi panitia di +62 812 3456 7890 atau email aksi@example.com. " +
      "WhatsApp https://wa.me/6281234567890 untuk info. Telpon 08123456789.";
    const out = sanitiseCaption(raw);
    expect(out).not.toMatch(/\+62\s*812/);
    expect(out).not.toMatch(/aksi@example\.com/);
    expect(out).not.toMatch(/wa\.me/);
    expect(out).not.toMatch(/08123456789/);
    expect(out).toContain("[removed]");
  });

  it("leaves an ordinary caption untouched apart from whitespace", () => {
    expect(sanitiseCaption("  Demonstrasi  di   Jayapura  ")).toBe(
      "Demonstrasi di Jayapura",
    );
  });
});

// ---------------------------------------------------------------------------
// Scope resolution (PNG + Indonesian Papua only).
// ---------------------------------------------------------------------------
describe("resolveScope keeps only PNG + Indonesian Papua", () => {
  it("maps Papua New Guinea cues to PNG", () => {
    const s = resolveScope("Armed robbery reported in Port Moresby, Papua New Guinea");
    expect(s.inScope).toBe(true);
    expect(s.country).toBe("Papua New Guinea");
  });

  it("maps West Papua cues to Indonesia", () => {
    const s = resolveScope("Protest in Jayapura, West Papua over land rights");
    expect(s.inScope).toBe(true);
    expect(s.country).toBe("Indonesia");
  });

  it("defaults bare 'papua' to Indonesian Papua", () => {
    const s = resolveScope("Unrest reported across Papua this week");
    expect(s.inScope).toBe(true);
    expect(s.country).toBe("Indonesia");
  });

  it("rejects out-of-theatre posts", () => {
    const s = resolveScope("Heavy rain disrupts traffic in Sydney, Australia");
    expect(s.inScope).toBe(false);
    expect(s.country).toBe("Unknown");
  });

  it("does not treat a .png image extension as the PNG abbreviation", () => {
    expect(resolveScope("See the attached banner.png for details").inScope).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Raw-post normalisation + outbound-link minimisation.
// ---------------------------------------------------------------------------
describe("normaliseFacebookPost", () => {
  it("returns null when there is neither an id nor a url", () => {
    expect(normaliseFacebookPost({})).toBeNull();
    expect(normaliseFacebookPost(null)).toBeNull();
    expect(normaliseFacebookPost("not an object")).toBeNull();
  });

  it("extracts caption + dedups images and drops Facebook-internal links", () => {
    const norm = normaliseFacebookPost({
      postId: "123",
      text: "Roadblock near the highway https://www.postcourier.com.pg/story",
      images: [{ url: "https://cdn/a.jpg" }, { url: "https://cdn/a.jpg" }],
      links: ["https://www.facebook.com/share/x", "https://looppng.com/article"],
    });
    expect(norm).not.toBeNull();
    expect(norm!.externalId).toBe("fb_123");
    expect(norm!.imageUrls).toEqual(["https://cdn/a.jpg"]);
    // The caption URL + the explicit non-facebook link are kept; the
    // facebook.com share link is dropped.
    expect(norm!.outboundLinks).toContain("https://looppng.com/article");
    expect(norm!.outboundLinks.some((l) => /facebook\.com/.test(l))).toBe(false);
  });

  it("strips token-bearing query strings from every persisted URL", () => {
    const norm = normaliseFacebookPost({
      postId: "777",
      url: "https://www.facebook.com/p/abc/?token=SECRET&access_token=XYZ",
      text: "Clash reported https://www.postcourier.com.pg/story?utm_source=fb",
      images: [
        "https://scontent.fbcdn.net/v/photo.jpg?_nc_oh=SIG&oh=AAA&oe=BBB",
      ],
      links: ["https://looppng.com/article?fbclid=TRACK123"],
    });
    expect(norm).not.toBeNull();
    const allUrls = [norm!.url, ...norm!.imageUrls, ...norm!.outboundLinks];
    // No query/fragment, and none of the token-like params survive anywhere.
    for (const u of allUrls) {
      expect(u).not.toContain("?");
      expect(u).not.toMatch(/token|oh=|oe=|fbclid|utm_/i);
    }
    expect(norm!.url).toBe("https://www.facebook.com/p/abc");
    expect(norm!.imageUrls).toEqual([
      "https://scontent.fbcdn.net/v/photo.jpg",
    ]);
    expect(norm!.outboundLinks).toContain("https://looppng.com/article");
  });
});

// ---------------------------------------------------------------------------
// URL minimisation — no token-bearing / signed / tracking params persisted.
// ---------------------------------------------------------------------------
describe("sanitiseUrl drops query strings and fragments", () => {
  it("keeps scheme + host + path, strips query, fragment and trailing slash", () => {
    expect(sanitiseUrl("https://looppng.com/article/?fbclid=ABC#top")).toBe(
      "https://looppng.com/article",
    );
    expect(
      sanitiseUrl("https://cdn.fbcdn.net/v/x.jpg?oh=AAA&oe=BBB&token=Z"),
    ).toBe("https://cdn.fbcdn.net/v/x.jpg");
  });

  it("rejects non-http(s) and unparseable input", () => {
    expect(sanitiseUrl("javascript:alert(1)")).toBe("");
    expect(sanitiseUrl("ftp://host/file")).toBe("");
    expect(sanitiseUrl("not a url")).toBe("");
    expect(sanitiseUrl("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Classification end-to-end (scope + sanitise + category + dedup key).
// ---------------------------------------------------------------------------
describe("classifyPost", () => {
  const base: RawFacebookPost = {
    externalId: "fb_1",
    url: "https://www.facebook.com/p/1",
    caption: "",
    imageUrls: [],
    outboundLinks: [],
    postedAt: new Date("2026-06-20T00:00:00Z"),
  };

  it("returns null for out-of-scope posts", () => {
    expect(
      classifyPost({ ...base, caption: "Festival in Bali draws big crowds" }),
    ).toBeNull();
  });

  it("classifies an in-scope PNG post with a stable dedup key + valid topic", () => {
    const c = classifyPost({
      ...base,
      caption: "Armed robbery and shooting at a store in Port Moresby, Papua New Guinea",
    });
    expect(c).not.toBeNull();
    expect(c!.country).toBe("Papua New Guinea");
    expect(c!.dedupKey).toMatch(/^fb_/);
    expect(["flashpoint", "conflict"]).toContain(c!.promotionTopic);
    expect(typeof c!.securityRelevant).toBe("boolean");
  });
});

describe("classifyPostBroad keeps out-of-scope posts as non-promotable context", () => {
  const base: RawFacebookPost = {
    externalId: "fb_b1",
    url: "https://www.facebook.com/p/b1",
    caption: "",
    imageUrls: [],
    outboundLinks: [],
    postedAt: new Date("2026-06-20T00:00:00Z"),
  };

  it("keeps an out-of-scope post (which classifyPost rejects) as Unknown-country context", () => {
    const caption = "Festival in Bali draws big crowds";
    expect(classifyPost({ ...base, caption })).toBeNull();
    const c = classifyPostBroad({ ...base, caption });
    expect(c).not.toBeNull();
    expect(c!.inScope).toBe(false);
    expect(c!.country).toBe("Unknown");
    expect(c!.category).toBe("Other security");
    expect(c!.securityRelevant).toBe(false);
    expect(c!.businessImpact).toBe("");
  });

  it("a broad Unknown context row is structurally non-promotable", () => {
    const c = classifyPostBroad({
      ...base,
      caption: "Festival in Bali draws big crowds",
    })!;
    const e = deriveEligibility({
      category: c.category,
      sourceTier: "official",
      credibleDomainLabels: ["Reuters"],
      corroborated: true,
    });
    expect(e.promotable).toBe(false);
  });

  it("still drops an empty / media-only caption", () => {
    expect(classifyPostBroad({ ...base, caption: "   " })).toBeNull();
  });

  it("classifies an in-scope post identically to classifyPost", () => {
    const caption =
      "Armed robbery and shooting at a store in Port Moresby, Papua New Guinea";
    const c = classifyPostBroad({ ...base, caption });
    expect(c).not.toBeNull();
    expect(c!.inScope).toBe(true);
    expect(c!.country).toBe("Papua New Guinea");
  });
});

describe("makeFacebookDedupKey", () => {
  it("is stable across URL/whitespace noise so reposts collapse", () => {
    const a = makeFacebookDedupKey(
      "Roadblock near the highway https://x.test/abc",
      ["https://cdn/p/photo.jpg?token=1"],
    );
    const b = makeFacebookDedupKey(
      "Roadblock   near the highway https://x.test/DIFFERENT",
      ["https://cdn/p/photo.jpg?token=2"],
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^fb_/);
  });
});

// ---------------------------------------------------------------------------
// Credible-domain allow-list (the only "official" signal that comes from links).
// ---------------------------------------------------------------------------
describe("credible-domain detection", () => {
  it("matches exact hosts, suffix subdomains and ignores junk", () => {
    // www. is stripped; empty strings are skipped.
    const hosts = extractHosts(["https://www.reuters.com/world", ""]);
    expect(hosts).toEqual(["reuters.com"]);
    const m = detectCredibleDomains([
      "https://news.rpngc.gov.pg/release",
      "https://looppng.com/story",
    ]);
    expect(m.tier).toBe("official"); // gov.pg subdomain wins
    expect(m.labels).toEqual(
      expect.arrayContaining(["PNG Government", "Loop PNG"]),
    );
  });

  it("returns no match for an unknown domain", () => {
    const m = detectCredibleDomains(["https://some-random-blog.example/post"]);
    expect(m.tier).toBeNull();
    expect(m.labels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Eligibility — the core promote gate (security-relevant AND credible).
// ---------------------------------------------------------------------------
describe("deriveEligibility", () => {
  it("an official-tier security post is promotable", () => {
    const e = deriveEligibility({
      category: "Civil unrest / protest",
      sourceTier: "official",
      credibleDomainLabels: [],
      corroborated: false,
    });
    expect(e.securityRelevant).toBe(true);
    expect(e.credible).toBe(true);
    expect(e.promotable).toBe(true);
    expect(e.credibilityReason).toMatch(/official/i);
  });

  it("an unverified OSINT post with no corroboration is NOT promotable", () => {
    const e = deriveEligibility({
      category: "Civil unrest / protest",
      sourceTier: "osint",
      credibleDomainLabels: [],
      corroborated: false,
    });
    expect(e.securityRelevant).toBe(true);
    expect(e.credible).toBe(false);
    expect(e.promotable).toBe(false);
  });

  it("a linked credible domain upgrades an OSINT post to promotable", () => {
    const e = deriveEligibility({
      category: "Armed robbery / hold-up",
      sourceTier: "osint",
      credibleDomainLabels: ["Post-Courier"],
      corroborated: false,
    });
    expect(e.promotable).toBe(true);
    expect(e.credibilityReason).toMatch(/Post-Courier/);
  });

  it("cross-feed corroboration upgrades an OSINT post to promotable", () => {
    const e = deriveEligibility({
      category: "Tribal / communal violence",
      sourceTier: "osint",
      credibleDomainLabels: [],
      corroborated: true,
      corroborationReason: "Corroborated by incident #5",
    });
    expect(e.promotable).toBe(true);
    expect(e.credibilityReason).toMatch(/#5/);
  });

  it("a non-security category is never promotable, even from an official page", () => {
    const e = deriveEligibility({
      category: "Other security",
      sourceTier: "official",
      credibleDomainLabels: ["Reuters"],
      corroborated: true,
    });
    expect(e.securityRelevant).toBe(false);
    expect(e.promotable).toBe(false);
  });
});

describe("categoryToTopic routes violent crime to conflict, the rest to flashpoint", () => {
  it("armed/violent categories -> conflict", () => {
    expect(categoryToTopic("Armed robbery / hold-up")).toBe("conflict");
    expect(categoryToTopic("Homicide / violent crime")).toBe("conflict");
    expect(categoryToTopic("Tribal / communal violence")).toBe("conflict");
    expect(categoryToTopic("Theft / break-in")).toBe("conflict");
  });

  it("protest / policing / governance categories -> flashpoint", () => {
    expect(categoryToTopic("Civil unrest / protest")).toBe("flashpoint");
    expect(categoryToTopic("Policing operation")).toBe("flashpoint");
    expect(categoryToTopic("Government stability")).toBe("flashpoint");
  });
});

// ---------------------------------------------------------------------------
// Incident matching — soft corroboration vs hard duplicate-block.
// ---------------------------------------------------------------------------
describe("pickCorroboration (soft, upgrades credibility)", () => {
  const mk = (over: Partial<IncidentCandidate>): IncidentCandidate => ({
    id: 1,
    title: "Tribal clash injures several in Enga",
    summary: "Fighting between clans in the Enga highlands",
    country: "Papua New Guinea",
    occurredAt: new Date("2026-06-20T00:00:00Z"),
    ...over,
  });

  it("fires on a same-country, close-date token match", () => {
    const m = pickCorroboration(
      {
        text: "Tribal clash leaves several injured in the Enga highlands",
        country: "Papua New Guinea",
        province: null,
        category: "Tribal / communal violence",
        date: new Date("2026-06-20T06:00:00Z"),
      },
      [mk({})],
    );
    expect(m).not.toBeNull();
    expect(m!.incident.id).toBe(1);
  });

  it("never matches across countries", () => {
    const m = pickCorroboration(
      {
        text: "Tribal clash leaves several injured in the Enga highlands",
        country: "Indonesia",
        province: null,
        category: "Tribal / communal violence",
        date: new Date("2026-06-20T06:00:00Z"),
      },
      [mk({ country: "Papua New Guinea" })],
    );
    expect(m).toBeNull();
  });
});

describe("pickDuplicate (hard, blocks promotion)", () => {
  const dupCandidate: IncidentCandidate = {
    id: 7,
    title: "Violent demonstration blockade outside parliament damages vehicles",
    summary: "Protesters blockaded the parliament building and damaged vehicles",
    country: "Papua New Guinea",
    province: "National Capital District",
    category: "Civil unrest / protest",
    occurredAt: new Date("2026-06-20T00:00:00Z"),
    incidentDate: new Date("2026-06-20T00:00:00Z"),
  };

  it("blocks a same-day, same-category, high-overlap repost", () => {
    const m = pickDuplicate(
      {
        text: "Violent demonstration blockade outside parliament building damaged vehicles",
        country: "Papua New Guinea",
        province: "National Capital District",
        category: "Civil unrest / protest",
        date: new Date("2026-06-20T05:00:00Z"),
      },
      [dupCandidate],
    );
    expect(m).not.toBeNull();
    expect(m!.incident.id).toBe(7);
  });

  it("does not block a different-country post", () => {
    const m = pickDuplicate(
      {
        text: "Violent demonstration blockade outside parliament building damaged vehicles",
        country: "Indonesia",
        province: "Papua",
        category: "Civil unrest / protest",
        date: new Date("2026-06-20T05:00:00Z"),
      },
      [dupCandidate],
    );
    expect(m).toBeNull();
  });

  it("does not block a far-apart-in-time post", () => {
    const m = pickDuplicate(
      {
        text: "Violent demonstration blockade outside parliament building damaged vehicles",
        country: "Papua New Guinea",
        province: "National Capital District",
        category: "Civil unrest / protest",
        date: new Date("2026-07-20T05:00:00Z"),
      },
      [dupCandidate],
    );
    expect(m).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation — an unkeyed install is inactive (→ not_configured).
// ---------------------------------------------------------------------------
describe("isFacebookOsintActive gates on configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is inactive with no API key (not_configured)", () => {
    delete process.env.FACEBOOK_API_KEY;
    delete process.env.FACEBOOK_OSINT_ENABLED;
    expect(isFacebookOsintActive()).toBe(false);
    expect(readFacebookOsintConfig().configured).toBe(false);
  });

  it("is active when keyed and enabled", () => {
    process.env.FACEBOOK_API_KEY = "test_token";
    delete process.env.FACEBOOK_OSINT_ENABLED;
    expect(isFacebookOsintActive()).toBe(true);
  });

  it("is inactive when explicitly switched off even with a key (disabled)", () => {
    process.env.FACEBOOK_API_KEY = "test_token";
    process.env.FACEBOOK_OSINT_ENABLED = "false";
    expect(isFacebookOsintActive()).toBe(false);
  });
});

describe("normaliseSourceTier", () => {
  it("normalises declared tiers and defaults unknown to osint", () => {
    expect(normaliseSourceTier("official")).toBe("official");
    expect(normaliseSourceTier("Local-Media")).toBe("local_media");
    expect(normaliseSourceTier("press")).toBe("local_media");
    expect(normaliseSourceTier("")).toBe("osint");
    expect(normaliseSourceTier(undefined)).toBe("osint");
  });
});

// ---------------------------------------------------------------------------
// Review-flag triage — a TRIAGE signal only; it never promotes anything.
// ---------------------------------------------------------------------------
describe("deriveReview", () => {
  it("flags an in-scope, security-relevant post and records WHY", () => {
    const r = deriveReview({
      inScope: true,
      securityRelevant: true,
      promotable: false,
      category: "Civil unrest / protest",
    });
    expect(r.reviewFlag).toBe(true);
    expect(r.reviewReason).toMatch(/Civil unrest \/ protest/);
    // Not yet promotable → the reason names the missing credibility step.
    expect(r.reviewReason).toMatch(/credible source or cross-feed corroboration/);
  });

  it("notes promote-eligibility in the reason when already promotable", () => {
    const r = deriveReview({
      inScope: true,
      securityRelevant: true,
      promotable: true,
      category: "Armed robbery / hold-up",
    });
    expect(r.reviewFlag).toBe(true);
    expect(r.reviewReason).toMatch(/promote-eligible/);
  });

  it("does NOT flag an out-of-scope post", () => {
    const r = deriveReview({
      inScope: false,
      securityRelevant: true,
      promotable: true,
      category: "Civil unrest / protest",
    });
    expect(r.reviewFlag).toBe(false);
    expect(r.reviewReason).toBeNull();
  });

  it("does NOT flag a non-security-relevant post", () => {
    const r = deriveReview({
      inScope: true,
      securityRelevant: false,
      promotable: false,
      category: "Other security",
    });
    expect(r.reviewFlag).toBe(false);
    expect(r.reviewReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Confidence score — deterministic, 0-100, never fabricates certainty.
// ---------------------------------------------------------------------------
describe("computeConfidence", () => {
  it("scores 0 for an out-of-scope post regardless of other signals", () => {
    expect(
      computeConfidence({
        inScope: false,
        localityPrecise: true,
        securityRelevant: true,
        credible: true,
        corroborated: true,
        hasIncidentDate: true,
        keywordCount: 5,
      }),
    ).toBe(0);
  });

  it("a bare in-scope post with no other signal scores the base 25", () => {
    expect(
      computeConfidence({
        inScope: true,
        localityPrecise: false,
        securityRelevant: false,
        credible: false,
        corroborated: false,
        hasIncidentDate: false,
        keywordCount: 0,
      }),
    ).toBe(25);
  });

  it("adds points for each concrete signal that genuinely fired", () => {
    // 25 + 18 + 22 + 15 + 12 + 5 + 3 = 100 (clamped at the ceiling).
    expect(
      computeConfidence({
        inScope: true,
        localityPrecise: true,
        securityRelevant: true,
        credible: true,
        corroborated: true,
        hasIncidentDate: true,
        keywordCount: 3,
      }),
    ).toBe(100);
  });

  it("requires at least 3 keywords before the keyword bonus applies", () => {
    const base = {
      inScope: true,
      localityPrecise: false,
      securityRelevant: false,
      credible: false,
      corroborated: false,
      hasIncidentDate: false,
    };
    expect(computeConfidence({ ...base, keywordCount: 2 })).toBe(25);
    expect(computeConfidence({ ...base, keywordCount: 3 })).toBe(28);
  });

  it("never exceeds 100 and never drops below 5 when in scope", () => {
    const v = computeConfidence({
      inScope: true,
      localityPrecise: false,
      securityRelevant: false,
      credible: false,
      corroborated: false,
      hasIncidentDate: false,
      keywordCount: 0,
    });
    expect(v).toBeGreaterThanOrEqual(5);
    expect(v).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Keyword detection — transparency only; distinct, in cue order, no fabrication.
// ---------------------------------------------------------------------------
describe("detectKeywords", () => {
  it("returns the distinct curated cues that actually matched", () => {
    const kws = detectKeywords(
      "Tribal fighting and a shooting near the Enga highlands left people dead",
    );
    expect(kws).toEqual(
      expect.arrayContaining(["tribal fighting", "shooting", "killed", "highlands"]),
    );
  });

  it("returns an empty array for empty or signal-free text", () => {
    expect(detectKeywords("")).toEqual([]);
    expect(detectKeywords("A quiet community fair was held over the weekend")).toEqual([]);
  });

  it("does not duplicate a cue that matches more than once", () => {
    const kws = detectKeywords("protest, protests and more protesters at the protest");
    expect(kws.filter((k) => k === "protest")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Apify dataset normalisation aliases. The MANUAL importer feeds dataset items
// straight through normaliseFacebookPost, so these lock the field aliases the
// real Apify Facebook scrapers emit — an import must never silently drop a
// post's url / page provenance / timestamp / engagement.
// ---------------------------------------------------------------------------
describe("normaliseFacebookPost — Apify dataset aliases", () => {
  it("accepts a permalink-only item as the canonical url", () => {
    const norm = normaliseFacebookPost({
      permalink: "https://www.facebook.com/p/abc123",
      text: "Clash reported in Lae",
    });
    expect(norm).not.toBeNull();
    expect(norm!.url).toBe("https://www.facebook.com/p/abc123");
    expect(norm!.externalId).toMatch(/^fb_/);
  });

  it("captures groupUrl as the page/group provenance url", () => {
    const norm = normaliseFacebookPost({
      postId: "g1",
      text: "Roadblock near the highway",
      groupUrl: "https://www.facebook.com/groups/123456",
    });
    expect(norm).not.toBeNull();
    expect(norm!.pageUrl).toBe("https://www.facebook.com/groups/123456");
  });

  it("reads createdAt as the posted timestamp", () => {
    const norm = normaliseFacebookPost({
      postId: "t1",
      text: "Curfew imposed overnight",
      createdAt: "2026-06-18T09:30:00.000Z",
    });
    expect(norm).not.toBeNull();
    expect(norm!.postedAt).toBeInstanceOf(Date);
    expect(norm!.postedAt!.toISOString()).toBe("2026-06-18T09:30:00.000Z");
  });

  it("maps likesCount / commentsCount to coarse engagement counts", () => {
    const norm = normaliseFacebookPost({
      postId: "e1",
      text: "Protest march in Jayapura",
      likesCount: 42,
      commentsCount: 7,
    });
    expect(norm).not.toBeNull();
    expect(norm!.engagement).toEqual({ reactions: 42, comments: 7 });
  });
});

// ---------------------------------------------------------------------------
// Expanded PNG + Indonesian-Papua keyword cues (collection-time transparency).
// Bahasa captions arrive untranslated, so the cue set must match the local
// security vocabulary directly — these lock the new terms against real samples.
// ---------------------------------------------------------------------------
describe("detectKeywords — expanded PNG + Indonesian-Papua cues", () => {
  it("matches PNG-specific security vocabulary", () => {
    expect(
      detectKeywords("Sorcery-accusation related violence in the highlands"),
    ).toContain("sorcery-accusation violence");
    expect(detectKeywords("A raskol gang held up a store")).toContain(
      "raskol gang",
    );
  });

  it("matches untranslated Bahasa Indonesia security vocabulary", () => {
    expect(detectKeywords("Penembakan di Intan Jaya")).toContain("shooting (id)");
    expect(detectKeywords("Aksi unjuk rasa di Jayapura")).toContain(
      "protest (id)",
    );
    expect(detectKeywords("Pasukan Brimob dikerahkan ke lokasi")).toContain(
      "security-force deployment",
    );
    expect(detectKeywords("Penculikan seorang warga dilaporkan")).toContain(
      "abduction (id)",
    );
    expect(detectKeywords("Kontak senjata antara TNI dan KKB")).toEqual(
      expect.arrayContaining([
        "armed contact (id)",
        "Indonesian military",
        "armed group (KKB)",
      ]),
    );
  });

  it("does not fire on a benign Bahasa caption with no security cue", () => {
    expect(
      detectKeywords("Selamat pagi, semoga harimu menyenangkan"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// classifyPost — expanded theatre locality. The gazetteer resolves a sub-national
// place from the caption for BOTH theatres (PNG highlands + Indonesian-Papua
// regencies) so the analyst queue carries a precise location, not just a country.
// ---------------------------------------------------------------------------
describe("classifyPost — expanded theatre locality", () => {
  const base: RawFacebookPost = {
    externalId: "fb_loc",
    url: "https://www.facebook.com/p/loc",
    caption: "",
    imageUrls: [],
    outboundLinks: [],
    postedAt: new Date("2026-06-20T00:00:00Z"),
  };

  it("resolves a PNG highlands town to a location", () => {
    const c = classifyPost({
      ...base,
      caption: "Tribal fighting erupts in Mount Hagen, Papua New Guinea",
    });
    expect(c).not.toBeNull();
    expect(c!.country).toBe("Papua New Guinea");
    expect(c!.location?.toLowerCase()).toContain("mount hagen");
  });

  it("resolves an Indonesian-Papua regency to a location", () => {
    const c = classifyPost({
      ...base,
      caption: "Penembakan dilaporkan di Intan Jaya, Papua",
    });
    expect(c).not.toBeNull();
    expect(c!.country).toBe("Indonesia");
    expect(c!.location?.toLowerCase()).toContain("intan jaya");
    expect(c!.detectedKeywords).toContain("shooting (id)");
  });
});

// ---------------------------------------------------------------------------
// persistFacebookPosts — in-run de-duplication seam (shared by the live engine
// AND the manual Apify importer). The DB is fully stubbed to return no rows, so
// this isolates the in-memory collapse: a re-shared post (same content → same
// dedupKey) or a repeated dataset item (same externalId) must reduce to ONE row
// BEFORE any write. Dry-run, so nothing is inserted.
// ---------------------------------------------------------------------------
describe("persistFacebookPosts collapses duplicates in-run (dry-run)", () => {
  function emptyQuery(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      groupBy: () => chain,
      then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve([] as unknown[]).then(res, rej),
      catch: (rej: (e: unknown) => unknown) =>
        Promise.resolve([] as unknown[]).catch(rej),
      finally: (f: () => void) => Promise.resolve([] as unknown[]).finally(f),
    };
    return chain;
  }

  let insertSpy: jest.SpiedFunction<typeof db.insert>;
  beforeEach(() => {
    jest.spyOn(db, "select").mockImplementation(() => emptyQuery() as never);
    insertSpy = jest.spyOn(db, "insert");
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const base: RawFacebookPost = {
    externalId: "fb_a",
    url: "https://www.facebook.com/p/a",
    caption:
      "Armed robbery and shooting at a store in Port Moresby, Papua New Guinea",
    imageUrls: ["https://cdn/x.jpg"],
    outboundLinks: [],
    postedAt: new Date("2026-06-20T00:00:00Z"),
  };

  it("collapses re-shared posts with identical content (same dedupKey)", async () => {
    const res = await persistFacebookPosts(
      [
        base,
        { ...base, externalId: "fb_b", url: "https://www.facebook.com/p/b" },
      ],
      { commit: false },
    );
    expect(res.inScope).toBe(2);
    expect(res.newToInsert).toBe(1);
    expect(res.inserted).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("collapses repeated dataset items sharing one externalId", async () => {
    const res = await persistFacebookPosts(
      [
        base,
        {
          ...base,
          caption: "Tribal fighting erupts in Mount Hagen, Papua New Guinea",
          imageUrls: ["https://cdn/y.jpg"],
        },
      ],
      { commit: false },
    );
    expect(res.inScope).toBe(2);
    expect(res.newToInsert).toBe(1);
    expect(res.inserted).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
