import {
  classifySeverity,
  maxSeverity,
  severityFromFatalities,
  hasMassCasualtyToll,
} from "@workspace/ingest";

describe("classifySeverity", () => {
  it("rates cargo pilferage as low", () => {
    expect(classifySeverity("Minor pilferage at depot", "", "cargo_watch")).toBe("low");
  });

  it("rates substantive cargo theft as moderate", () => {
    expect(classifySeverity("Cargo stolen from warehouse", "", "cargo_watch")).toBe("moderate");
  });

  it("rates mass-casualty language as extreme", () => {
    expect(classifySeverity("Protest turns deadly, dozens killed", "", "flashpoint")).toBe("extreme");
  });

  it("rates forward-looking protest calls as insignificant", () => {
    expect(classifySeverity("Union plans to strike next week", "", "flashpoint")).toBe("insignificant");
  });

  it("rates shipping kinetic strikes as high", () => {
    expect(classifySeverity("Vessel struck by missile off coast", "", "shipping")).toBe("high");
  });

  it("rates shipping seizures as moderate", () => {
    expect(classifySeverity("Tanker seized by naval forces", "", "shipping")).toBe("moderate");
  });

  // A plain attack verb bound to a vessel/port object (no weapon noun) is a
  // high-severity maritime incident — the old classifier let these fall through
  // to the low/insignificant default.
  it("rates a plain 'tanker attack' as high", () => {
    expect(classifySeverity("Oil tanker attack reported in Gulf of Oman", "", "shipping")).toBe(
      "high",
    );
  });

  it("rates 'attack on vessel' as high", () => {
    expect(classifySeverity("Armed men launch attack on cargo vessel", "", "shipping")).toBe("high");
  });

  it("rates a strike headline referencing a tanker attack as high", () => {
    expect(
      classifySeverity("US launches fresh strikes on Iran after tanker attack", "", "shipping"),
    ).toBe("high");
  });

  // Labour "port strike" is a wage walkout, not a kinetic attack — it must not
  // read High.
  it("does not rate a labour port strike as high", () => {
    expect(classifySeverity("Port workers strike over pay dispute", "", "shipping")).not.toBe(
      "high",
    );
  });

  it("rates energy grid outages as moderate", () => {
    expect(classifySeverity("Nationwide blackout hits major cities", "", "energy")).toBe("moderate");
  });

  it("rates fuel shortages as moderate", () => {
    expect(classifySeverity("Fuel shortage forces rationing at pumps", "", "fuel")).toBe("moderate");
  });

  it("rates fertiliser supply crises as moderate", () => {
    expect(classifySeverity("Fertiliser shortage sparks supply crisis", "", "fertiliser")).toBe(
      "moderate",
    );
  });

  // A confirmed fatality overrides the mild fuel topic default, but a single /
  // unspecified toll reads High — Extreme is reserved for a mass-casualty count.
  it("rates a confirmed-fatality incident above the topic default", () => {
    expect(classifySeverity("Refinery fire killed workers", "", "fuel")).toBe("high");
  });

  // Reaction guard: an advocacy / statement headline that REFERENCES a prior
  // killing must not read Extreme — the casualty word is a reference, not a
  // fresh attack. This is the exact live mis-rating that was reported.
  it("does not rate a demand/justice advocacy headline as extreme", () => {
    expect(
      classifySeverity(
        "Zeliangrong Intellectual Group Demands Ban on Kuki Militant Groups, Seeks Justice for Six Slain Nagas",
        "",
        "conflict",
      ),
    ).toBe("low");
  });

  it("does not escalate a 'condemns the killing' reaction headline", () => {
    expect(classifySeverity("Civil society condemns killing of activist", "", "flashpoint")).toBe(
      "low",
    );
  });

  it("does not escalate a 'seeks justice for slain' reaction headline", () => {
    expect(classifySeverity("Villagers seek justice for slain farmer", "", "conflict")).toBe("low");
  });

  // Regression: "Merauke regency government awaits full report on shooting of
  // fishing vessel in PNG waters" was rated High/Extreme because the headline
  // is LED by "awaits" (a status-of-investigation verb), which REACTION_LEAD_RE
  // did not originally recognise, so the "shooting" in the body drove the
  // fatal-signal/security-signal HIGH branch instead of being suppressed like
  // every other reaction-led headline.
  it("does not escalate an 'awaits full report on shooting' status headline", () => {
    expect(
      classifySeverity(
        "Merauke regency government awaits full report on shooting of fishing vessel in PNG waters",
        "",
        "indonesia_local",
      ),
    ).toBe("low");
  });

  it("does not escalate a 'report pending' status headline", () => {
    expect(
      classifySeverity("Officials say report pending on Merauke fishing vessel incident", "", "apac_local"),
    ).toBe("low");
  });

  it("does not escalate a 'yet to release findings' status headline", () => {
    expect(
      classifySeverity("Papua police yet to release findings on fishing vessel shooting", "", "indonesia_local"),
    ).toBe("low");
  });

  // Control: a genuine fresh shooting (not framed as awaiting/pending a
  // report) must still escalate normally under the same reaction-guarded
  // topics -- the fix must not blanket-suppress every headline containing
  // "shooting".
  it("still rates a fresh fatal shooting as high even under the reaction-guarded topics", () => {
    expect(
      classifySeverity("Gunmen shoot dead two fishermen off Merauke coast", "", "indonesia_local"),
    ).toBe("high");
  });

  // A fresh attack that merely ENDS with a reaction is still the attack.
  it("still rates a fresh armed attack that ends with a reaction as high", () => {
    expect(
      classifySeverity(
        "Three youths injured in armed attack in Manipur, mob protests treatment",
        "",
        "conflict",
      ),
    ).toBe("high");
  });

  // A genuine fresh deadly event is never softened by the guard.
  it("still rates a fresh deadly clash as extreme", () => {
    expect(classifySeverity("Protest turns deadly, dozens killed", "", "conflict")).toBe("extreme");
  });

  // The guard is scoped to civil-unrest / conflict — a reaction-framed deadly
  // maritime attack keeps its escalation (it is likely the only record). The
  // confirmed killing reads High; Extreme stays reserved for a mass-casualty toll.
  it("does not apply the reaction guard to commodity/maritime topics", () => {
    expect(
      classifySeverity("Union condemns missile strike that killed two crew", "", "shipping"),
    ).toBe("high");
  });

  // Invariant the one-time severity heal relies on: a reaction-led headline
  // text-rates Low, but a structured fatality count floors it back up — so a
  // confirmed-fatality row is NEVER downgraded by the migration. A single / low
  // toll floors to High; only a mass-casualty count (>= MASS_FATALITY_THRESHOLD)
  // floors to the reserved Extreme tier.
  it("fatality floor lifts a reaction-led headline to at least high", () => {
    const text = classifySeverity("Villagers seek justice for slain farmer", "", "conflict");
    expect(text).toBe("low");
    expect(maxSeverity(text, severityFromFatalities(2)!)).toBe("high");
    expect(maxSeverity(text, severityFromFatalities(8)!)).toBe("extreme");
  });

  // A confirmed killing by a security force is the under-rating that was
  // reported ("killed in military op" reading low) — it must lift to High.
  it("rates a confirmed security-force killing as high", () => {
    expect(
      classifySeverity("Militant killed by security forces in Chhattisgarh encounter", "", "conflict"),
    ).toBe("high");
  });

  // Year guard: a 4-digit dateline year must never be read as a mass body count.
  // A court-process headline citing a 2-fatality shootout reads High, not Extreme.
  it("does not read a dateline year as a mass-casualty count", () => {
    expect(
      classifySeverity(
        "Ambush or self defense? Trial begins in 2025 Lorain shootout that killed 2",
        "",
        "conflict",
      ),
    ).toBe("high");
  });

  // The year guard must not suppress a genuine mass toll alongside a year.
  it("keeps a genuine mass toll Extreme even next to a year", () => {
    expect(
      classifySeverity(
        "Anniversary of 2019 Pulwama attack that killed 40 marked in Kashmir",
        "",
        "conflict",
      ),
    ).toBe("extreme");
  });

  // Judicial-emergency guard. The reported recurring failure: a court sentencing
  // that merely MENTIONS "martial law" hit the reserved-Extreme emergency
  // trigger and crowned South Korea as highest-severity. A judicial frame must
  // cancel the emergency Extreme so a sentencing can never reach the reserved
  // tier — defence in depth, independent of the relevance filter.
  it("does not rate a court sentencing about a past martial-law role as extreme", () => {
    expect(
      classifySeverity(
        "Ex-justice minister gets 25 years jail for martial law role",
        "",
        "flashpoint",
      ),
    ).not.toBe("extreme");
  });

  it("does not rate a conviction over a martial-law decree as extreme", () => {
    expect(
      classifySeverity("General convicted over the martial law decree", "", "conflict"),
    ).not.toBe("extreme");
  });

  // A GENUINE live emergency declaration must still read Extreme — the guard only
  // fires inside a judicial frame, so it must never soften a real declaration.
  it("still rates a genuine martial-law declaration as extreme", () => {
    expect(classifySeverity("President declares martial law nationwide", "", "flashpoint")).toBe(
      "extreme",
    );
  });

  it("still rates a genuine state-of-emergency declaration as extreme", () => {
    expect(classifySeverity("Government declares state of emergency", "", "flashpoint")).toBe(
      "extreme",
    );
  });

  // Judicial frame + a real mass-casualty toll: the casualty signal survives the
  // emergency-strip, so the row keeps its Extreme — the guard only suppresses
  // when the emergency phrase was the SOLE Extreme trigger.
  it("keeps a judicial martial-law headline Extreme when a mass toll is present", () => {
    expect(
      classifySeverity(
        "Ex-general convicted as martial law crackdown leaves hundreds killed",
        "",
        "conflict",
      ),
    ).toBe("extreme");
  });

  // The custodial-sentence SHAPE must also cancel the emergency Extreme even
  // without the word "jail" — mirrors the relevance layer so the two never drift.
  it("does not rate 'handed life for martial law role' as extreme", () => {
    expect(
      classifySeverity("Ex-minister handed life for martial law role", "", "flashpoint"),
    ).not.toBe("extreme");
  });

  it("does not rate 'gets 25 years for martial law role' as extreme", () => {
    expect(
      classifySeverity("Former general gets 25 years for martial law role", "", "conflict"),
    ).not.toBe("extreme");
  });

  // Active-declaration backstop: a GENUINE live emergency declaration whose
  // SUMMARY also mentions a related indictment must stay Extreme — the judicial
  // guard must never suppress a story that IS the emergency.
  it("keeps a live emergency declaration Extreme even when the summary mentions a trial", () => {
    expect(
      classifySeverity(
        "Government declares state of emergency",
        "Separately, a former minister was indicted this week.",
        "flashpoint",
      ),
    ).toBe("extreme");
  });

  // Reported failure: a sentencing headline whose TITLE names the martial-law
  // role must not read Extreme.
  it("does not rate 'gets 25-year prison term for role in martial law declaration' as extreme", () => {
    expect(
      classifySeverity(
        "Former South Korean justice minister gets 25-year prison term for role in martial law declaration",
        "",
        "flashpoint",
      ),
    ).not.toBe("extreme");
  });

  // The exact recurring defeat: a jailed-politician headline whose SUMMARY
  // recaps a PAST live declaration ("who declared martial law in December
  // 2024"). The recap used to fire ACTIVE_EMERGENCY_RE and re-crown Extreme; a
  // title-led judicial frame must now dominate.
  it("does not rate a jailed-politician headline whose summary recaps a past martial-law declaration as extreme", () => {
    expect(
      classifySeverity(
        "Ex-South Korean leader Yoon jailed 2 years over illegal polling",
        "Yoon, who declared martial law in December 2024, was convicted on Tuesday.",
        "flashpoint",
      ),
    ).not.toBe("extreme");
  });

  it("does not rate 'appeals court cuts jail term for ex-PM Han to 15 years in martial law case' as extreme", () => {
    expect(
      classifySeverity(
        "South Korea appeals court cuts jail term for ex-PM Han to 15 years in martial law case",
        "",
        "flashpoint",
      ),
    ).not.toBe("extreme");
  });

  // Mass-casualty backstop preserved: a genuine live declaration after a mass
  // toll stays Extreme even though it is not a judicial story.
  it("still rates 'junta declares martial law after dozens killed' as extreme", () => {
    expect(
      classifySeverity("Junta declares martial law after dozens killed", "", "flashpoint"),
    ).toBe("extreme");
  });

  // Confirmed-killing floor (reported West Papua defect: fatal events reading
  // Low). A past-tense killing bound to a human victim reads High even when the
  // headline names no separate security actor or weapon ("pilot" + "killed";
  // neither "pilot" nor "TPNPB" is a security keyword).
  it("rates a victim→verb killing with no security keyword as high", () => {
    expect(
      classifySeverity("American Pilot Killed in Papua; TPNPB Calls It a Message", "", "conflict"),
    ).toBe("high");
  });

  // Bahasa fatal term ("tembak mati" — shot dead) now floors High — a single
  // Indonesian killing rates the same as a single English killing.
  it("rates a Bahasa 'tembak mati' killing as high", () => {
    expect(
      classifySeverity("TPNPB Akui Tembak Mati Anggota TNI di Intan Jaya", "", "indonesia_local"),
    ).toBe("high");
  });

  // "tewas tertembak" (died, shot) is an explicit Bahasa killing → High.
  it("rates a Bahasa 'tewas tertembak' killing as high", () => {
    expect(
      classifySeverity("Mama Muda di Deiyai Tewas Tertembak Peluru Nyasar", "", "indonesia_local"),
    ).toBe("high");
  });

  // Bare "tewas" is a disaster-toll homonym, so it only escalates alongside a
  // Bahasa security context — here a military operation → High.
  it("rates a bare 'tewas' in a military-operation context as high", () => {
    expect(
      classifySeverity("Operasi Militer di Intan Jaya, Gembala GKII Tewas", "", "indonesia_local"),
    ).toBe("high");
  });

  // The disaster-toll homonym must NOT escalate: bare "tewas" with a natural
  // hazard and no security context stays off the High floor.
  it("does not escalate a bare 'tewas' disaster toll", () => {
    const s = classifySeverity("10 tewas akibat banjir bandang di Sentani", "", "indonesia_local");
    expect(s).not.toBe("high");
    expect(s).not.toBe("extreme");
  });

  // Accidental / transport death with no security signal must not float up on
  // the confirmed-killing floor — a road-crash death is not a security event.
  it("does not rate a road-crash death as a security killing", () => {
    expect(classifySeverity("Bus driver killed in highway crash", "", "flashpoint")).not.toBe(
      "high",
    );
  });

  // Workplace / industrial accident (no security signal) must not float up on
  // the confirmed-killing floor either — a factory-accident death is a tragedy,
  // not a security event.
  it("does not rate a factory-accident death as a security killing", () => {
    expect(
      classifySeverity("Two workers killed in factory accident", "", "flashpoint"),
    ).not.toBe("high");
  });

  it("does not rate a structural mine collapse death as a security killing", () => {
    expect(classifySeverity("Miners killed in mine collapse", "", "conflict")).not.toBe("high");
  });
});

// A Bahasa (Indonesian-language) mass-casualty toll must floor at the reserved
// Extreme tier exactly like its English equivalent. Reported defect: a Bangkok
// bar fire filed on indonesia_local ("Korban Tewas ... Jadi 32 Orang") read LOW
// because the mass-toll classifier only understood English "N killed" / "kills
// N". The natural-cause + illness guards must still keep a disaster / obituary
// toll out of the reserved tier, and money / age / year figures must never read
// as a body count.
describe("classifySeverity — Bahasa mass-casualty toll", () => {
  const T = "indonesia_local" as const;

  it("rates a Bahasa rising death toll as extreme (the reported Bangkok bar fire)", () => {
    expect(
      classifySeverity("Korban Tewas Kebakaran Bar di Bangkok Jadi 32 Orang", "", T),
    ).toBe("extreme");
  });

  it("rates 'menewaskan N orang' as extreme", () => {
    expect(classifySeverity("Kebakaran bar di Bangkok menewaskan 27 orang", "", T)).toBe(
      "extreme",
    );
  });

  it("rates 'N orang tewas' as extreme", () => {
    expect(classifySeverity("Kebakaran klub malam, 28 orang tewas", "", T)).toBe("extreme");
  });

  it("rates a bare 'N tewas' toll as extreme", () => {
    expect(classifySeverity("Kecelakaan bus di tol, 15 tewas", "", T)).toBe("extreme");
  });

  it("suppresses a Bahasa NATURAL-disaster toll from the reserved tier", () => {
    expect(classifySeverity("Banjir bandang di Sumatra, 20 orang tewas", "", T)).not.toBe(
      "extreme",
    );
  });

  it("does NOT escalate an illness / obituary Bahasa death (meninggal)", () => {
    expect(classifySeverity("Aktor senior meninggal dunia di usia 82", "", T)).not.toBe(
      "extreme",
    );
  });

  it("does NOT read a large Bahasa money / age number as a body count", () => {
    expect(classifySeverity("Kerugian kebakaran capai 32 miliar rupiah", "", T)).not.toBe(
      "extreme",
    );
    expect(classifySeverity("Pria 27 tahun tewas dalam kecelakaan tunggal", "", T)).not.toBe(
      "extreme",
    );
  });

  it("does NOT read a bare year as a mass toll", () => {
    expect(classifySeverity("Mengenang tragedi 1998 di Jakarta", "", T)).not.toBe("extreme");
  });
});

describe("hasMassCasualtyToll", () => {
  it("detects English and Bahasa mass tolls", () => {
    expect(hasMassCasualtyToll("Fire kills 28", "")).toBe(true);
    expect(hasMassCasualtyToll("Korban tewas kebakaran jadi 32 orang", "")).toBe(true);
    expect(hasMassCasualtyToll("28 orang tewas", "")).toBe(true);
    expect(hasMassCasualtyToll("Kebakaran menewaskan 27 orang", "")).toBe(true);
  });

  it("does not fire on a single death or a year / money figure", () => {
    expect(hasMassCasualtyToll("One person killed in crash", "")).toBe(false);
    expect(hasMassCasualtyToll("Satu orang tewas dalam kecelakaan", "")).toBe(false);
    expect(hasMassCasualtyToll("Kerugian capai 32 miliar rupiah", "")).toBe(false);
    expect(hasMassCasualtyToll("Mengenang tragedi 1998", "")).toBe(false);
  });
});
