// Hugo Trade Shield desk: the screening logic. Pure functions, no page and no storage in here, so it is
// tested from Node (node test_engine.js) and used unchanged by the app page.
(function (root) {
  const M = typeof module !== "undefined" ? require("../match.js") : root.TSMatch;
  const HIT = 0.95, REVIEW = 0.88;
  // destinations where US sanctions or export limits are heavy enough that a person should always look
  const RISKY = { CU: "Cuba", IR: "Iran", KP: "North Korea", SY: "Syria", RU: "Russia", BY: "Belarus" };
  const CNAME = { cuba: "CU", iran: "IR", "north korea": "KP", dprk: "KP", syria: "SY", russia: "RU", "russian federation": "RU", belarus: "BY" };
  const FREE = new Set(("gmail.com yahoo.com hotmail.com outlook.com live.com aol.com icloud.com mail.ru yandex.ru yandex.com bk.ru list.ru " +
    "inbox.ru rambler.ru 163.com 126.com qq.com sina.com foxmail.com protonmail.com proton.me gmx.com gmx.de web.de msn.com me.com " +
    "ymail.com googlemail.com hotmail.co.uk yahoo.co.uk naver.com yahoo.fr hotmail.fr tutanota.com zoho.com").split(" "));
  const SEVERE = ["US OFAC SDN", "UN Security Council", "UK Sanctions List", "US BIS Denied Persons", "US BIS Entity List",
    "US State ITAR Debarred", "US OFAC SSI", "US BIS Military End User", "US OFAC CMIC"];
  const KIND = { name: "name", e: "email address", w: "website", p: "phone number", r: "registration number", i: "ship IMO number" };
  const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

  const dom = (s) => s.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[\/?#:\s]/)[0].replace(/\.$/, "");
  const alnum = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const sev = (list) => { const k = SEVERE.indexOf(list); return k < 0 ? 99 : k; };

  function country(s) {
    const t = (s || "").trim();
    if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
    return CNAME[t.toLowerCase()] || "";
  }

  // ---- index ----
  function build(doc) {
    const index = M.prepare(doc);
    const byPre = new Map();
    const ids = { e: new Map(), w: new Map(), p: new Map(), r: new Map(), i: new Map() };
    const push = (map, key, k) => { const a = map.get(key); if (a) { if (!a.includes(k)) a.push(k); } else map.set(key, [k]); };
    index.forEach((it, k) => {
      const seen = new Set();
      for (const toks of it.toks) for (const t of toks) seen.add(t.slice(0, 2));
      for (const pre of seen) { const a = byPre.get(pre); if (a) a.push(k); else byPre.set(pre, [k]); }
      for (const s of it.r[7] || []) {
        const t = s[0], v = s.slice(2);
        if (t === "p") push(ids.p, v.slice(-8), k);
        else if (ids[t]) push(ids[t], v, k);
        if (t === "e") { const d = v.split("@")[1]; if (d && !FREE.has(d)) push(ids.w, d, k); }
      }
    });
    return { doc, index, byPre, ids, built: doc.built, total: doc.e.length };
  }

  function searchNames(eng, query, min, max) {
    const Q = M.tokens(query);
    if (!Q.length || Q.join("").length < 3) return [];
    const cand = new Set();
    for (const q of Q) for (const k of eng.byPre.get(q.slice(0, 2)) || []) cand.add(k);
    const out = [];
    for (const k of cand) {
      const it = eng.index[k];
      let best = 0, via = 0;
      for (let i = 0; i < it.toks.length; i++) { const v = M.score(Q, it.toks[i]); if (v > best) { best = v; via = i; } }
      if (best >= min) out.push({ k, score: best, via: via ? it.r[3][via - 1] : null });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, max);
  }

  // ---- identifiers: emails, websites, phones, registration numbers, IMO numbers found in any pasted text ----
  function extractIds(text) {
    const out = [], seen = new Set();
    const add = (t, v, raw) => { if (v && !seen.has(t + v)) { seen.add(t + v); out.push({ t, v, raw: raw.trim() }); } };
    let s = " " + (text || "") + " ";
    s = s.replace(EMAIL, (m) => { const e = m.toLowerCase().replace(/\.$/, ""); add("e", e, m); const d = e.split("@")[1]; if (!FREE.has(d)) add("w", d, m); return " "; });
    s = s.replace(/(?:https?:\/\/|www\.)[^\s,;<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi, (m) => { const d = dom(m); if (/\.[a-z]{2,}$/.test(d)) add("w", d, m); return " " + m + " "; });
    s.replace(/\bIMO[\s:#.-]*(\d{7})\b/gi, (m, d) => { add("i", d, m); return m; });
    s.replace(/\+?\d[\d\s().-]{6,20}\d/g, (m) => { const d = m.replace(/\D/g, ""); if (d.length >= 8 && d.length <= 15) add("p", d, m); return m; });
    s.replace(/\b[A-Za-z0-9][A-Za-z0-9\/-]{5,}\b/g, (m) => {
      const a = alnum(m);
      if (a.length >= 6 && (a.match(/\d/g) || []).length >= 4) { add("r", a, m); if (/^\d{7}$/.test(a)) add("i", a, m); }
      return m;
    });
    return out;
  }
  function lookupIds(eng, found) {
    const out = [];
    for (const f of found) {
      let ks = [];
      if (f.t === "p") {
        for (const k of eng.ids.p.get(f.v.slice(-8)) || []) {
          // the shorter number must be the tail of the longer one (country code or leading 0 may differ)
          const ok = (eng.doc.e[k][7] || []).some((x) => { if (x[0] !== "p") return false; const L = x.slice(2); const a = L.length < f.v.length ? L : f.v, b = L.length < f.v.length ? f.v : L; return b.endsWith(a.replace(/^0+/, "")); });
          if (ok) ks.push(k);
        }
      } else ks = eng.ids[f.t].get(f.v) || [];
      for (const k of ks) out.push({ k, t: f.t, raw: f.raw });
    }
    return out;
  }

  // ---- screen one party: { name, cc, ids } -> { matches: [...], flag } ----
  function screen(eng, p) {
    const byK = new Map();
    const nameText = (p.name || "").replace(EMAIL, " ");
    for (const m of searchNames(eng, nameText, 0.8, 6)) byK.set(m.k, { k: m.k, score: m.score, kind: "name", via: m.via });
    for (const h of lookupIds(eng, extractIds((p.name || "") + " \n " + (p.ids || "")))) {
      const had = byK.get(h.k);                       // an exact email beats the website taken from that same email
      if (!had || had.kind === "name") byK.set(h.k, { k: h.k, score: 1, kind: h.t, via: h.raw });
    }
    const ms = [...byK.values()].map((m) => {
      const r = eng.doc.e[m.k];
      return { ref: r[0] + "|" + r[6], list: r[0], name: r[2], type: r[1], country: r[4] || "", program: r[5] || "", score: m.score, kind: m.kind, via: m.via || null };
    });
    ms.sort((a, b) => (a.kind !== "name") !== (b.kind !== "name") ? (a.kind !== "name" ? -1 : 1)
      : Math.abs(a.score - b.score) < 0.005 ? sev(a.list) - sev(b.list) : b.score - a.score);
    const cc = country(p.cc);
    return { matches: ms.slice(0, 6), flag: RISKY[cc] ? cc : "" };
  }

  // a match counts when it is an exact identifier or a name at review level or above
  const counts = (m) => m.kind !== "name" || m.score >= REVIEW;
  const strong = (m) => m.kind !== "name" || m.score >= HIT;
  function refsOf(p) {
    return (p.matches || []).filter(counts).map((m) => m.ref).concat(p.flag ? ["dest|" + p.flag] : []);
  }
  // blk = stopped by the user, new = never screened, hit = on a list, rev = needs a look, ok = cleared by the user, clr = clear
  function status(p) {
    if (p.blocked) return "blk";
    if (!p.checked) return "new";
    const cleared = new Set(p.cleared || []);
    const open = (p.matches || []).filter((m) => counts(m) && !cleared.has(m.ref));
    const flagOpen = p.flag && !cleared.has("dest|" + p.flag);
    if (open.some(strong)) return "hit";
    if (open.length || flagOpen) return "rev";
    return refsOf(p).length ? "ok" : "clr";
  }
  // store a fresh screening result on the party and say what changed since the last one
  function apply(p, res, built, nowIso) {
    const first = !p.checked, before = status(p), prev = new Set(p.seen || []);
    p.matches = res.matches; p.flag = res.flag; p.checked = nowIso; p.lists = built;
    const refs = refsOf(p);
    const fresh = refs.filter((r) => !prev.has(r));
    const gone = [...prev].filter((r) => !refs.includes(r));
    p.seen = refs;
    if (p.cleared) p.cleared = p.cleared.filter((r) => refs.includes(r));
    return { first, before, after: status(p), fresh, gone };
  }

  // ---- input lines: "name, country, anything else (email, phone, website)" ----
  function parseLine(line) {
    const parts = line.split(/[,\t;]/).map((s) => s.trim()).filter(Boolean);
    const ids = [];
    let cc = "";
    const idLike = (s) => /@/.test(s) || /^(?:https?:\/\/|www\.)/i.test(s) || (s.replace(/\D/g, "").length >= 7 && !/[a-z]{4,}/i.test(s)) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(s);
    while (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (idLike(last)) ids.unshift(parts.pop());
      else if (!cc && country(last)) cc = country(parts.pop());
      else break;
    }
    return { name: parts.join(", "), cc, ids: ids.join(" ") };
  }
  function parseCsvRow(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === "," || c === ";" || c === "\t") { out.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  // a pasted list or a CSV file -> parties. A header row with a name column maps the columns; otherwise each line is free text.
  function parseList(text) {
    const lines = (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const head = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const cName = col(/^(name|company|customer|consignee|party|shipper|buyer|account)/);
    if (cName >= 0 && head.length > 1 || (cName >= 0 && head.length === 1 && lines.length > 1 && /^(name|company|customer)s?( name)?$/.test(head[0]))) {
      const cC = col(/country/), idCols = head.map((h, i) => (/e-?mail|phone|tel|web|url|site|tax|vat|reg|imo/.test(h) ? i : -1)).filter((i) => i >= 0);
      return lines.slice(1).map((l) => { const c = parseCsvRow(l); return { name: c[cName] || "", cc: cC >= 0 ? country(c[cC]) : "", ids: idCols.map((i) => c[i]).filter(Boolean).join(" ") }; }).filter((p) => p.name);
    }
    return lines.map(parseLine).filter((p) => p.name);
  }

  // ---- licence keys: TS1.<payload>.<signature>, signed with ECDSA P-256; only the public key ships with the app ----
  const b64u = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  async function verifyKey(key, pubJwk) {
    try {
      const m = /^TS1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec((key || "").trim());
      if (!m || !pubJwk) return null;
      const pub = await crypto.subtle.importKey("jwk", pubJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64u(m[2]), new TextEncoder().encode(m[1]));
      if (!ok) return null;
      const lic = JSON.parse(new TextDecoder().decode(b64u(m[1])));
      return lic && lic.c && lic.e ? lic : null;      // { c: company, p: "pilot" | "paid", e: "YYYY-MM-DD" }
    } catch (e) { return null; }
  }
  const licenceState = (lic, today) => !lic ? "trial" : lic.e < today ? "expired" : lic.p === "paid" ? "paid" : "pilot";

  const api = { HIT, REVIEW, RISKY, KIND, FREE, build, searchNames, extractIds, lookupIds, screen, status, apply, refsOf, counts, strong,
    country, parseLine, parseList, verifyKey, licenceState };
  if (typeof module !== "undefined") module.exports = api; else root.TSEngine = api;
})(this);
