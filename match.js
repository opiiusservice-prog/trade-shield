// Name matching for Hugo Trade Shield. Pure functions, used by the page and by the tests (node test_match.js).
(function (root) {
  const DROP = new Set(("ltd limited llc l l c inc incorporated co company corp corporation plc gmbh sa s a ooo oao zao jsc pjsc ojsc " +
    "the of llp lp srl bv ag fze fzco fzc fz est establishment pte pvt private sdn bhd kft spa sarl ltda cia de la el al").split(" "));

  function norm(s) {
    return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9Ѐ-ӿ؀-ۿ一-鿿]+/g, " ").trim();
  }
  function tokens(s) {
    const all = norm(s).split(" ").filter(Boolean);
    const kept = all.filter((t) => !DROP.has(t));
    return kept.length ? kept : all;
  }
  // Jaro-Winkler similarity, 0..1
  function jw(a, b) {
    if (a === b) return 1;
    const la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
    const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
    let m = 0;
    for (let i = 0; i < la; i++) {
      const lo = Math.max(0, i - win), hi = Math.min(lb - 1, i + win);
      for (let j = lo; j <= hi; j++) if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
    if (!m) return 0;
    let k = 0, tr = 0;
    for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) tr++; k++; }
    const j = (m / la + m / lb + (m - tr / 2) / m) / 3;
    let p = 0;
    while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
    return j + p * 0.1 * (1 - j);
  }
  const COMMON = new Set(("global logistics logistic trading trade shipping international intl group services service industries " +
    "industry holding holdings enterprises enterprise import export imports exports freight cargo express general technology " +
    "technologies tech solutions transport transportation line lines marine sea air world worldwide oil gas energy bank " +
    "investment investments development products supply supplies systems engineering and electronics electronic electric " +
    "chemicals chemical machinery equipment materials metals steel parts auto motors food foods textile textiles " +
    "pharma pharmaceutical medical petroleum petrochemical commercial manufacturing factory works plant center centre").split(" "));
  function side(A, B) {           // how well every token of A is found in B (weighted by token length)
    let s = 0, w = 0;
    for (const a of A) {
      let best = 0;
      for (const b of B) { const v = jw(a, b); if (v > best) best = v; if (best === 1) break; }
      const wt = Math.min(a.length, 8) * (COMMON.has(a) ? 0.3 : 1);
      s += best * wt; w += wt;
    }
    return w ? s / w : 0;
  }
  // score of a typed name against one listed name (both already tokenised)
  function score(Q, N) {
    if (!Q.length || !N.length) return 0;
    if (Q.join(" ") === N.join(" ")) return 1;
    const a = side(Q, N), b = side(N, Q);
    // a listed name with extra middle names should still match; a one-word query should not match every long name
    let sc = (2 * a + b) / 3;                       // every typed word should be found; extra listed words cost less
    if (Q.length === 1 && N.length > 2) sc *= 0.93;  // one typed word shouldn't hit every long name
    if (N.length === 1 && Q.length > 1) sc *= 0.9;   // a one-word listed name (often a ship) shouldn't hit full names
    return sc;
  }
  function prepare(doc) {
    return doc.e.map((r) => {
      const toks = [tokens(r[2])].concat((r[3] || []).map(tokens));
      const first = new Set();
      for (const T of toks) for (const t of T) first.add(t[0]);
      return { r, toks, first };
    });
  }
  function search(index, query, min = 0.88, max = 12) {
    const Q = tokens(query);
    if (!Q.length || Q.join("").length < 3) return [];
    const out = [], qf = Q.map((t) => t[0]);
    for (const it of index) {
      if (!qf.some((c) => it.first.has(c))) continue;   // no word starts with the same letter: cannot score high
      let best = 0, via = 0;
      for (let i = 0; i < it.toks.length; i++) { const v = score(Q, it.toks[i]); if (v > best) { best = v; via = i; } }
      if (best >= min) out.push({ score: best, entry: it.r, via: via ? it.r[3][via - 1] : null });
    }
    out.sort((x, y) => y.score - x.score);
    return out.slice(0, max);
  }
  const api = { norm, tokens, jw, score, prepare, search };
  if (typeof module !== "undefined") module.exports = api; else root.TSMatch = api;
})(this);
