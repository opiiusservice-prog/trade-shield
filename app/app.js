// Hugo Trade Shield desk app: customer book, review queue, proof log, daily watch.
// Storage is IndexedDB in this browser. The only network request is the public list file (../lists.json).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const E = window.TSEngine, M = window.TSMatch;
  const CONTACT = "opiiusservice@gmail.com", TRIAL_MAX = 5;
  const today = () => new Date().toISOString().slice(0, 10);
  const nice = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";
  const niceDay = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const pct = (s) => Math.round(s * 100) + "%";
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const MEANS = {
    "US OFAC SDN": "Blocked. US persons may not deal with them at all.",
    "UK Sanctions List": "UK asset freeze or trade limits apply.",
    "UN Security Council": "UN sanctions, applied by every member state.",
    "US BIS Entity List": "A US export licence is needed for items under US export rules.",
    "US BIS Denied Persons": "No US exports to them, of any kind.",
    "US OFAC SSI": "Some new debt and equity deals are restricted.",
    "US OFAC CMIC": "US persons may not invest in them.",
    "US State ITAR Debarred": "Barred from US defence trade.",
    "US BIS Military End User": "A licence is needed for listed items.",
    "US BIS Unverified": "Extra checks and statements are needed before export.",
  };
  const PILL = { hit: "On a list", rev: "Check", clr: "Clear", ok: "Cleared by you", blk: "Stopped", new: "Not checked yet" };
  const SAMPLE = ["Northwind Pumps Ltd, GB", "Bluefin Marine Supplies, SG", "Atlas Tools GmbH, DE", "Hikvision, CN", "Kestrel Agro Exports, KE",
    "Al Noor Trading LLC, AE", "Lumen Packaging S.A. de C.V., MX", "PJSC Sovcomflot, RU", "Harbourline Foods Pty Ltd, AU", "Mahan Airlines, IR",
    "Cedar & Pine Furniture Inc, CA", "Banco Nacional de Cuba, CU", "Orchid Circuit Works Sdn Bhd, MY", "Mahan Travel Agency, MY",
    "Shahed Aviation Industries, IR", "Vela Coatings BV, NL", "Huizhou Youli Fushi Co Ltd, CN, yk@yolimachine.com", "Sunrise Ceramics LLC, US",
    "Korea Kwangson Banking Corporation, KP", "Huawei Technologies Co., Ltd., CN"];

  let S = { v: 1, org: { co: "", me: "" }, key: "", parties: [], audit: [], alerts: [], lastBuilt: "", lastRun: "", backupAt: "" };
  let eng = null, lic = null, mode = "trial", busy = false, openId = null;

  // ---------- storage ----------
  const store = {
    db: null,
    open() {
      return new Promise((res) => {
        try {
          const rq = indexedDB.open("trade-shield", 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
          rq.onsuccess = () => { store.db = rq.result; res(); };
          rq.onerror = () => res();
        } catch (e) { res(); }
      });
    },
    get() {
      return new Promise((res) => {
        if (!store.db) { try { res(JSON.parse(localStorage.getItem("ts-state") || "null")); } catch (e) { res(null); } return; }
        const rq = store.db.transaction("kv").objectStore("kv").get("state");
        rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
      });
    },
    set(v) {
      if (!store.db) { try { localStorage.setItem("ts-state", JSON.stringify(v)); } catch (e) {} return; }
      try { store.db.transaction("kv", "readwrite").objectStore("kv").put(v, "state"); } catch (e) {}
    },
  };
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set(S), 150); };

  // ---------- licence ----------
  async function loadLicence() {
    lic = S.key ? await E.verifyKey(S.key, window.TS_PUB) : null;
    mode = E.licenceState(lic, today());
    const b = $("plan");
    b.className = "plan " + mode;
    b.textContent = { trial: "Trial", pilot: "Pilot", paid: "Active", expired: "Expired" }[mode];
    $("licline").textContent = mode === "trial" ? `Trial: quick checks are free. Save up to ${TRIAL_MAX} customers to try the daily watch.`
      : mode === "expired" ? `The licence for ${lic.c} ended on ${niceDay(lic.e)}. Your data is safe and can still be exported; screening is paused.`
      : `${mode === "pilot" ? "Free pilot" : "Licensed"} for ${lic.c}, valid until ${niceDay(lic.e)}. Unlimited customers.`;
  }
  const canScreen = () => mode !== "expired";
  const own = () => S.parties.filter((p) => !p.sample).length;

  // ---------- log ----------
  function resultText(p) {
    const st = E.status(p), top = (p.matches || []).find(E.counts);
    let s = PILL[st];
    if (top) s += top.kind === "name" ? ` (${pct(top.score)} ${top.list}: ${top.name})` : ` (same ${E.KIND[top.kind]} as ${top.list}: ${top.name})`;
    if (p.flag) s += ` [destination ${E.RISKY[p.flag]}]`;
    return s;
  }
  function log(p, act, detail) {
    S.audit.unshift({ t: new Date().toISOString(), pid: p ? p.id : "", party: p ? p.name : "All customers", cc: p ? p.cc || "" : "", act, detail: detail || "", by: S.org.me || "", lists: eng ? eng.built : S.lastBuilt });
    if (S.audit.length > 20000) S.audit.length = 20000;
  }

  // ---------- screening ----------
  function runBatch(list, bar, each, done) {
    busy = true;
    if (bar) { bar.style.display = "block"; bar.firstElementChild.style.width = "0"; }
    let i = 0;
    (function step() {
      const end = Math.min(list.length, i + 2);
      for (; i < end; i++) each(list[i]);
      if (bar) bar.firstElementChild.style.width = (100 * i / Math.max(1, list.length)) + "%";
      if (i < list.length) return setTimeout(step, 0);
      busy = false;
      if (bar) setTimeout(() => (bar.style.display = "none"), 500);
      done();
    })();
  }
  function addParties(parsed, sample) {
    if (!eng) return note("The lists are still loading. Try again in a moment.");
    if (!canScreen()) return note("Your licence has ended, so new screening is paused. Your data is still here and can be exported.");
    if (busy) return;
    const have = new Set(S.parties.map((p) => M.norm(p.name) + "|" + (p.cc || "")));
    let fresh = parsed.filter((p) => { const k = M.norm(p.name) + "|" + (p.cc || ""); if (!p.name || have.has(k)) return false; have.add(k); return true; });
    const skipped = parsed.length - fresh.length;
    let cut = 0;
    if (mode === "trial" && !sample) { const room = Math.max(0, TRIAL_MAX - own()); if (fresh.length > room) { cut = fresh.length - room; fresh = fresh.slice(0, room); } }
    if (!fresh.length) return note(cut ? trialMsg() : skipped ? "Those customers are already on your list." : "Nothing to add. Type one customer per line.");
    const t0 = performance.now(), now = new Date().toISOString();
    const made = fresh.map((p) => ({ id: uid(), name: p.name, cc: p.cc || "", ids: p.ids || "", added: now, sample: !!sample }));
    runBatch(made, $("prog"), (p) => {
      E.apply(p, E.screen(eng, p), eng.built, new Date().toISOString());
      S.parties.push(p);
      log(p, "Screened and added to the watch", resultText(p));
    }, () => {
      S.lastBuilt = eng.built; S.lastRun = new Date().toISOString();
      const c = count(made);
      $("took").textContent = `${made.length} added and checked against ${eng.total.toLocaleString("en-US")} listed parties in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${c.clr} clear, ${c.rev} to look at, ${c.hit} on a list.` + (skipped ? ` ${skipped} were already on your list.` : "");
      $("inp").value = "";
      note(cut ? trialMsg() : "");
      save(); draw();
    });
  }
  const trialMsg = () => `The trial watches up to ${TRIAL_MAX} customers. <a href="#" data-go="set">Add a pilot key</a> to screen your whole list (the 30-day pilot is free).`;
  function recheckAll(auto) {
    if (!eng || busy || !S.parties.length) return;
    if (!canScreen()) { if (!auto) note("Your licence has ended, so screening is paused."); return; }
    const t0 = performance.now(), changes = [];
    runBatch(S.parties.slice(), $("prog2"), (p) => {
      const was = p.blocked;
      const ch = E.apply(p, E.screen(eng, p), eng.built, new Date().toISOString());
      if (ch.first || was) return;
      if (ch.fresh.length) {
        const m = p.matches.find((x) => ch.fresh.includes(x.ref));
        const text = m ? `now matches ${m.name} on ${m.list}` + (m.kind === "name" ? ` (${pct(m.score)})` : ` by ${E.KIND[m.kind]}`) : `destination ${E.RISKY[p.flag]} is now flagged`;
        changes.push({ t: p.checked, id: p.id, name: p.name, kind: "new", text });
        log(p, "List change: new match", resultText(p));
      } else if (ch.gone.length && ch.before !== ch.after) {
        changes.push({ t: p.checked, id: p.id, name: p.name, kind: "gone", text: "a listing that matched this customer was removed" });
        log(p, "List change: a match was removed", resultText(p));
      }
    }, () => {
      S.lastBuilt = eng.built; S.lastRun = new Date().toISOString();
      S.alerts = changes.concat(S.alerts).slice(0, 200);
      log(null, auto ? "Daily watch: all customers re-checked" : "All customers re-checked", `${S.parties.length} customers, ${changes.length} change${changes.length === 1 ? "" : "s"}`);
      $("took2").textContent = `${S.parties.length} customers re-checked in ${((performance.now() - t0) / 1000).toFixed(1)} s. ${changes.length ? changes.length + " change(s), shown above." : "No changes."}`;
      save(); draw();
    });
  }

  // ---------- drawing ----------
  function count(list) {
    const c = { clr: 0, rev: 0, hit: 0, ok: 0, blk: 0, new: 0 };
    (list || S.parties).forEach((p) => c[E.status(p)]++);
    return c;
  }
  const barc = (s) => (s >= E.HIT ? "var(--red)" : s >= E.REVIEW ? "var(--amber)" : "var(--green)");
  function rowHtml(p) {
    const st = E.status(p), top = (p.matches || []).find(E.counts);
    const near = top ? `<div>${esc(top.name)}</div><div class="lst">${esc(top.list)}${top.kind !== "name" ? " · same " + E.KIND[top.kind] : top.via ? " · also known as " + esc(top.via) : ""}</div>` : `<span class="lst">No close match</span>`;
    const sc = top ? (top.kind === "name" ? `<span class="bar"><b style="width:${Math.round(top.score * 100)}%;background:${barc(top.score)}"></b></span>${pct(top.score)}` : `<b style="color:var(--red)">exact</b>`) : `<span class="lst">–</span>`;
    return `<tr class="go" data-id="${p.id}"><td><b>${esc(p.name)}</b> <span class="lst">${esc(p.cc)}</span>${p.sample ? ' <span class="lst">· sample</span>' : ""}${p.flag ? `<div class="flag">⚑ Destination: ${esc(E.RISKY[p.flag])}</div>` : ""}${p.ids ? `<div class="lst">${esc(p.ids)}</div>` : ""}</td>
      <td><span class="pill ${st}">${PILL[st]}</span></td><td>${near}</td><td style="white-space:nowrap">${sc}</td><td class="lst" style="white-space:nowrap">${nice(p.checked)}</td></tr>`;
  }
  function bind(tbody) { tbody.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => open(tr.dataset.id))); }
  function draw() {
    const c = count();
    $("k-all").textContent = S.parties.length; $("k-clr").textContent = c.clr + c.ok; $("k-rev").textContent = c.rev; $("k-hit").textContent = c.hit;
    $("nbook").textContent = S.parties.length || ""; $("nrev").textContent = (c.rev + c.hit) || "";
    // customers
    const f = $("filt").value, q = M.norm($("find").value);
    const list = S.parties.filter((p) => (!f || E.status(p) === f || (f === "clr" && false)) && (!q || M.norm(p.name + " " + (p.ids || "")).includes(q)));
    const order = { hit: 0, rev: 1, blk: 2, new: 3, ok: 4, clr: 5 };
    list.sort((a, b) => order[E.status(a)] - order[E.status(b)] || a.name.localeCompare(b.name));
    $("rows").innerHTML = list.length ? list.slice(0, 500).map(rowHtml).join("") + (list.length > 500 ? `<tr><td colspan="5" class="empty">Showing the first 500 of ${list.length}. Use the search box.</td></tr>` : "")
      : `<tr><td colspan="5" class="empty">${S.parties.length ? "No customer matches that filter." : "No customers yet. Paste your list above, or try the 20 sample customers."}</td></tr>`;
    bind($("rows"));
    // review
    const qd = S.parties.filter((p) => ["hit", "rev"].includes(E.status(p))).sort((a, b) => order[E.status(a)] - order[E.status(b)]);
    $("qrows").innerHTML = qd.length ? qd.map(rowHtml).join("") : `<tr><td colspan="5" class="empty">${S.parties.length ? "Nothing waiting. Every customer is clear or has a decision." : "Add customers first."}</td></tr>`;
    bind($("qrows"));
    // alerts
    const news = S.alerts.filter((a) => a.kind === "new"), gone = S.alerts.filter((a) => a.kind === "gone");
    $("alerts").innerHTML = (news.length ? `<div class="alert"><h3>${news.length} customer${news.length === 1 ? "" : "s"} newly matched a list</h3><div class="lst">Hold open orders for these until you have looked.</div>
      ${news.map((a) => `<div class="it" data-id="${a.id}"><b>${esc(a.name)}</b> ${esc(a.text)} <span class="lst">· ${nice(a.t)}</span></div>`).join("")}
      <div class="acts"><button class="btn sm" id="seen">Mark all as seen</button></div></div>` : "") +
      (gone.length ? `<div class="alert info"><h3>${gone.length} listing${gone.length === 1 ? "" : "s"} removed</h3>${gone.map((a) => `<div class="it" data-id="${a.id}"><b>${esc(a.name)}</b>: ${esc(a.text)}</div>`).join("")}
      ${news.length ? "" : '<div class="acts"><button class="btn sm" id="seen">Mark all as seen</button></div>'}</div>` : "");
    $("alerts").querySelectorAll(".it").forEach((d) => (d.onclick = () => open(d.dataset.id)));
    if ($("seen")) $("seen").onclick = () => { S.alerts = []; save(); draw(); };
    $("watchline").textContent = S.parties.length
      ? `${S.parties.length} customers watched. Last full re-check: ${nice(S.lastRun)}, against the lists of ${niceDay(S.lastBuilt)}. Open this page each morning: when the official lists have changed, every customer is re-checked by itself.`
      : "Add customers and they are re-checked every time the official lists change.";
    // log
    $("logn").textContent = S.audit.length ? `${S.audit.length.toLocaleString("en-US")} entries` : "";
    $("arows").innerHTML = S.audit.length ? S.audit.slice(0, 300).map((a) => `<tr><td class="lst" style="white-space:nowrap">${nice(a.t)}</td><td><b>${esc(a.party)}</b> <span class="lst">${esc(a.cc)}</span></td><td>${esc(a.act)}</td><td class="lst">${esc(a.detail)}</td><td class="lst">${esc(a.by)}</td><td class="lst" style="white-space:nowrap">${esc(a.lists)}</td></tr>`).join("") +
      (S.audit.length > 300 ? `<tr><td colspan="6" class="empty">Showing the latest 300. Download the CSV for all ${S.audit.length}.</td></tr>` : "")
      : `<tr><td colspan="6" class="empty">Nothing yet. Every check and every decision will be listed here.</td></tr>`;
    $("bkline").textContent = S.backupAt ? `Last backup: ${nice(S.backupAt)}.` : S.parties.length ? "No backup yet. Download one after your first import." : "";
  }
  function note(html) {
    $("notice").innerHTML = html ? `<div class="notice">${html}</div>` : "";
    $("notice").querySelectorAll("[data-go]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); tab(a.dataset.go); }));
  }
  function tab(t) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    ["today", "book", "review", "log", "set"].forEach((k) => ($("t-" + k).style.display = k === t ? "" : "none"));
    window.scrollTo(0, 0);
  }

  // ---------- drawer ----------
  function marked(name, query) {
    const Q = M.tokens(query || "");
    return esc(name).split(/(\s+)/).map((w) => { const t = M.norm(w).replace(/\s/g, ""); return t && Q.some((q) => M.jw(q, t) >= 0.9) ? `<mark>${w}</mark>` : w; }).join("");
  }
  function matchHtml(p, m) {
    const how = m.kind === "name" ? `${pct(m.score)} name match` : `Same ${E.KIND[m.kind]}: <b>${esc(m.via)}</b>`;
    return `<div class="vs"><div><small>Your customer</small><b>${m.kind === "name" ? marked(p.name, m.name + " " + (m.via || "")) : esc(p.name)}</b><div class="lst">${esc(p.cc) || "no country given"}</div></div>
      <div><small>Listed party · ${how}</small><b>${m.kind === "name" ? marked(m.name, p.name) : esc(m.name)}</b>${m.kind === "name" && m.via ? `<div class="lst">also known as ${marked(m.via, p.name)}</div>` : ""}<div class="lst">${esc(m.country || "country not given")}</div></div></div>
      <dl><dt>List</dt><dd><b>${esc(m.list)}</b></dd><dt>What it means</dt><dd>${esc(MEANS[m.list] || "Restricted. Read the official notice.")}</dd>
      <dt>Type</dt><dd>${esc(m.type)}</dd>${m.program ? `<dt>Programme</dt><dd>${esc(m.program)}</dd>` : ""}</dl>`;
  }
  function open(id) {
    const p = S.parties.find((x) => x.id === id);
    if (!p) return;
    openId = id;
    const st = E.status(p), rel = (p.matches || []).filter(E.counts), far = (p.matches || []).filter((m) => !E.counts(m));
    let h = `<button class="x" id="dx" aria-label="Close">×</button><h2>${esc(p.name)}</h2>
      <div><span class="pill ${st}">${PILL[st]}</span> <span class="lst">${esc(p.cc)} · last checked ${nice(p.checked)} · lists of ${niceDay(p.lists)}</span></div>`;
    if (p.flag) h += `<p class="flag" style="margin-top:10px">⚑ Destination: ${esc(E.RISKY[p.flag])}. US sanctions or export limits are heavy here. Check the current rules before you ship.</p>`;
    if (rel.length) h += rel.map((m) => matchHtml(p, m)).join("") + `<p class="lst">Confirm on the official source: <a href="https://sanctionssearch.ofac.treas.gov/" target="_blank" rel="noopener">OFAC search</a> · <a href="https://www.trade.gov/consolidated-screening-list" target="_blank" rel="noopener">US Consolidated Screening List</a> · <a href="https://search-uk-sanctions-list.service.gov.uk/" target="_blank" rel="noopener">UK list</a></p>`;
    else h += `<p style="margin:14px 0">No listed party is close to this one${far[0] ? ` (the closest name is only ${pct(far[0].score)}: ${esc(far[0].name)})` : ""}.</p>`;
    if (st === "hit" || st === "rev") {
      const onlyFlag = !rel.filter((m) => !(p.cleared || []).includes(m.ref)).length;
      h += `<div class="dec"><b>Your decision</b>
        <select id="why">${(onlyFlag ? ["Shipment is allowed (licence, exemption or not a controlled item)", "Customer is not in that country"] : ["Different country", "Different business or industry", "Different address or ID checked", "Only a common word matches"]).map((o) => `<option>${o}</option>`).join("")}</select>
        <input type="text" id="notes" placeholder="Notes (optional), e.g. checked trade licence">
        <div class="acts" style="margin:0"><button class="btn grn" id="ok">${onlyFlag ? "Checked: clear it" : "Not the same party: clear it"}</button><button class="btn red" id="stop">${onlyFlag ? "Stop the deal" : "Same party: stop the deal"}</button></div></div>`;
    } else if (st === "ok" || st === "blk") {
      h += `<div class="dec">Decided: <b>${st === "blk" ? "stopped" : "cleared by you"}</b>. It is in the proof log. <button class="btn sm" id="reopen" style="margin-left:8px">Reopen</button></div>`;
    }
    h += `<div class="dec"><b>More details for this customer</b><div class="lst">Email, phone, website or company number. These catch a listed party that trades under a new name.</div>
      <input type="text" id="pids" value="${esc(p.ids || "")}" placeholder="e.g. sales@example.com, +86 158 0000 0000">
      <div class="acts" style="margin:0"><button class="btn" id="resc">Save and check again</button><button class="btn" id="del">Remove customer</button></div></div>`;
    const hist = S.audit.filter((a) => a.pid === p.id).slice(0, 12);
    if (hist.length) h += `<p style="margin-top:16px"><b>History</b></p>` + hist.map((a) => `<div class="m"><span class="lst">${nice(a.t)}${a.by ? " · " + esc(a.by) : ""}</span><br>${esc(a.act)}${a.detail ? ` <span class="lst">· ${esc(a.detail)}</span>` : ""}</div>`).join("");
    h += `<div class="note">Trade Shield shows you a lead, you make the call. Always confirm a real match on the official source.</div>`;
    $("drawer").innerHTML = h;
    $("drawer").classList.add("on"); $("shade").classList.add("on");
    $("dx").onclick = close;
    const top = rel[0];
    if ($("why") && top && p.cc && top.country && p.cc === top.country) $("why").selectedIndex = 1;
    const notes = () => ($("notes").value.trim() ? ": " + $("notes").value.trim() : "");
    if ($("ok")) $("ok").onclick = () => { if (!needName()) return; p.cleared = E.refsOf(p); log(p, "Cleared by a person", $("why").value + notes()); done(id); };
    if ($("stop")) $("stop").onclick = () => { if (!needName()) return; p.blocked = true; log(p, "Stopped the deal", "Confirmed match" + notes()); done(id); };
    if ($("reopen")) $("reopen").onclick = () => { p.blocked = false; p.cleared = []; log(p, "Reopened for review", ""); done(id); };
    $("resc").onclick = () => {
      if (!eng || !canScreen()) return;
      p.ids = $("pids").value.trim();
      E.apply(p, E.screen(eng, p), eng.built, new Date().toISOString());
      log(p, "Details updated and re-checked", resultText(p)); done(id);
    };
    $("del").onclick = () => { if (!confirm(`Remove ${p.name} from the watch? Its history stays in the proof log.`)) return; log(p, "Removed from the watch", ""); S.parties = S.parties.filter((x) => x.id !== id); S.alerts = S.alerts.filter((a) => a.id !== id); save(); draw(); close(); };
  }
  function done(id) { S.alerts = S.alerts.filter((a) => a.id !== id || a.kind !== "new"); save(); draw(); open(id); }
  function needName() {
    if (S.org.me) return true;
    const n = prompt("Your name, for the proof log (who made this decision):");
    if (!n || !n.trim()) return false;
    S.org.me = n.trim(); $("s-me").value = S.org.me; save();
    return true;
  }
  function close() { $("drawer").classList.remove("on"); $("shade").classList.remove("on"); openId = null; }

  // ---------- quick check ----------
  function quick() {
    const text = $("q").value.trim();
    if (!text) return $("q").focus();
    if (!eng) { $("qres").innerHTML = `<div class="qres">The lists are still loading. Try again in a moment.</div>`; return; }
    if (!canScreen()) { $("qres").innerHTML = `<div class="qres">Your licence has ended, so screening is paused.</div>`; return; }
    const p = Object.assign({ id: "", checked: "" }, E.parseLine(text));
    if (!p.name) p.name = text;
    E.apply(p, E.screen(eng, p), eng.built, new Date().toISOString());
    const st = E.status(p), rel = p.matches.filter(E.counts);
    log(Object.assign({}, p, { id: "" }), "Quick check", resultText(p));
    const head = st === "hit" ? "On a sanctions list, or an exact identifier match" : st === "rev" ? "Needs a quick look" : "Clear: no listed party is close";
    $("qres").innerHTML = `<div class="qres ${st}"><b>${head}</b> <span class="lst">· checked ${nice(p.checked)} against ${eng.total.toLocaleString("en-US")} listed parties</span>
      ${p.flag ? `<div class="flag">⚑ Destination: ${esc(E.RISKY[p.flag])}. Check the current rules before you ship.</div>` : ""}
      ${rel.map((m) => `<div class="m"><b>${esc(m.name)}</b> <span class="lst">· ${esc(m.list)} · ${esc(m.country)}</span><br>${m.kind === "name" ? pct(m.score) + " name match" + (m.via ? `, also known as ${esc(m.via)}` : "") : `same ${E.KIND[m.kind]}: ${esc(m.via)}`}<div class="lst">${esc(MEANS[m.list] || "")}</div></div>`).join("")}
      <div class="acts"><button class="btn sm" id="qsave">Add to my customers and keep watching</button><span class="lst">Saved in the proof log.</span></div></div>`;
    $("qsave").onclick = () => { addParties([{ name: p.name, cc: p.cc, ids: p.ids }]); $("qres").innerHTML = ""; $("q").value = ""; tab("book"); };
    save(); draw();
  }

  // ---------- exports ----------
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function csvOut() {
    const q = (s) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    download(`trade-shield-proof-log-${today()}.csv`, ["time,customer,country,what_happened,detail,by,list_version"].concat(S.audit.map((a) => [a.t, a.party, a.cc, a.act, a.detail, a.by, a.lists].map(q).join(","))).join("\r\n"), "text/csv");
  }
  function certificate() {
    const w = window.open("", "_blank");
    if (!w) return note("Allow pop-ups for this page to open the certificate.");
    const c = count(), decided = S.audit.filter((a) => /Cleared by a person|Stopped the deal/.test(a.act)).slice(0, 200);
    const trial = mode === "trial" ? '<div class="demo">TRIAL COPY</div>' : "";
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Screening certificate</title><style>
      body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#0f1b2d;max-width:900px;margin:40px auto;padding:0 24px}
      h1{font-size:24px;margin:0}h2{font-size:16px;margin:22px 0 4px}.top{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #d97706;padding-bottom:14px;margin-bottom:18px}
      table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e3e7ee;vertical-align:top}th{color:#6b768a;font-size:11px;text-transform:uppercase}
      .k{display:flex;gap:28px;margin:10px 0}.k b{font-size:22px;display:block}.demo{color:#b42318;font-weight:700;letter-spacing:.08em}button{margin-top:20px;padding:8px 16px}@media print{button{display:none}}</style></head><body>
      <div class="top"><div><h1>Screening certificate</h1><div>${esc(S.org.co || "Company name not set")} · Hugo Trade Shield</div>${trial}</div><div style="text-align:right">Issued ${nice(new Date().toISOString())}<br>Prepared by: ${esc(S.org.me || "not set")}</div></div>
      <p>${S.parties.length} parties are on the watch list. Each was screened by name, and by any email, phone, website or registration number on file, against ${eng ? eng.total.toLocaleString("en-US") : ""} listed parties from the US Consolidated Screening List (OFAC SDN and other OFAC lists, BIS Entity List, Denied Persons, Unverified and Military End User lists, State Department lists), the UN Security Council consolidated list and the UK Sanctions List. List version: ${esc(S.lastBuilt)}. Last full re-check: ${nice(S.lastRun)}.</p>
      <div class="k"><div><b>${c.clr}</b>clear</div><div><b>${c.ok}</b>cleared by a person</div><div><b>${c.rev + c.hit}</b>open for review</div><div><b>${c.blk}</b>stopped</div></div>
      <h2>Watch list</h2><table><tr><th>Party</th><th>Country</th><th>Status</th><th>Closest listed party</th><th>Last checked</th></tr>
      ${S.parties.map((p) => { const t = (p.matches || []).find(E.counts); return `<tr><td>${esc(p.name)}</td><td>${esc(p.cc)}</td><td>${PILL[E.status(p)]}</td><td>${t ? esc(t.name) + " (" + esc(t.list) + ")" : "–"}</td><td>${nice(p.checked)}</td></tr>`; }).join("")}</table>
      ${decided.length ? `<h2>Decisions made by a person</h2><table><tr><th>Time</th><th>Party</th><th>Decision</th><th>Reason</th><th>By</th></tr>${decided.map((a) => `<tr><td>${nice(a.t)}</td><td>${esc(a.party)} ${esc(a.cc)}</td><td>${esc(a.act)}</td><td>${esc(a.detail)}</td><td>${esc(a.by)}</td></tr>`).join("")}</table>` : ""}
      <p style="color:#6b768a;font-size:12px;margin-top:18px">A record of screening done with Hugo Trade Shield. It is not legal advice and does not replace a check of the official source for any match. The EU list is not included.</p>
      <button id="pr">Print or save as PDF</button></body></html>`);
    w.document.close();
    w.document.getElementById("pr").onclick = () => w.print();
  }

  // ---------- wiring ----------
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => tab(b.dataset.t)));
  document.querySelectorAll(".tile").forEach((d) => (d.onclick = () => { $("filt").value = d.dataset.f; draw(); tab(d.dataset.f === "rev" || d.dataset.f === "hit" ? "review" : "book"); }));
  $("plan").onclick = () => tab("set");
  $("qgo").onclick = quick;
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") quick(); });
  $("add").onclick = () => addParties(E.parseList($("inp").value));
  $("sample").onclick = () => addParties(SAMPLE.map(E.parseLine), true);
  $("csv").onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then((t) => { addParties(E.parseList(t)); e.target.value = ""; }); };
  $("find").oninput = draw; $("filt").onchange = draw;
  $("recheck").onclick = () => recheckAll(false);
  $("cert").onclick = certificate; $("csvout").onclick = csvOut;
  $("shade").onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  $("s-save").onclick = () => { S.org.co = $("s-co").value.trim(); S.org.me = $("s-me").value.trim(); save(); $("s-ok").textContent = "Saved."; setTimeout(() => ($("s-ok").textContent = ""), 2000); };
  $("s-lic").onclick = async () => {
    const k = $("s-key").value.trim(), got = await E.verifyKey(k, window.TS_PUB);
    if (!got) { $("s-licok").textContent = "That key is not valid. Paste it exactly as it was sent."; return; }
    S.key = k; if (!S.org.co) { S.org.co = got.c; $("s-co").value = got.c; }
    await loadLicence(); save(); note("");
    $("s-licok").textContent = mode === "expired" ? "That key has ended." : "Activated.";
    log(null, "Licence activated", `${got.c}, ${got.p}, until ${got.e}`); draw();
  };
  $("askpilot").href = `mailto:${CONTACT}?subject=${encodeURIComponent("Hugo Trade Shield pilot")}&body=${encodeURIComponent("Hi,\n\nWe'd like to try Hugo Trade Shield free for 30 days.\n\nCompany:\nWebsite:\nRoughly how many customers or consignees do you check each month:\n\nThanks")}`;
  $("bk-out").onclick = () => { S.backupAt = new Date().toISOString(); download(`trade-shield-backup-${today()}.json`, JSON.stringify(S), "application/json"); save(); draw(); };
  $("bk-in").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then(async (t) => {
      try {
        const d = JSON.parse(t);
        if (!d || d.v !== 1 || !Array.isArray(d.parties) || !Array.isArray(d.audit)) throw 0;
        if (S.parties.length && !confirm(`Replace the ${S.parties.length} customers here with the ${d.parties.length} in the backup?`)) return;
        S = Object.assign({ org: { co: "", me: "" }, key: "", alerts: [], lastBuilt: "", lastRun: "", backupAt: "" }, d);
        await loadLicence(); fill(); save(); draw(); note("Backup restored.");
      } catch (err) { note("That file is not a Trade Shield backup."); }
      e.target.value = "";
    });
  };
  $("wipe").onclick = () => {
    if (!confirm("Delete every customer and the whole proof log from this browser? This cannot be undone. Download a backup first if you may need it.")) return;
    S = { v: 1, org: S.org, key: S.key, parties: [], audit: [], alerts: [], lastBuilt: "", lastRun: "", backupAt: "" };
    save(); draw(); note("Everything was deleted from this browser.");
  };
  function fill() { $("s-co").value = S.org.co || ""; $("s-me").value = S.org.me || ""; $("s-key").value = S.key || ""; }

  // ---------- start ----------
  async function loadLists() {
    try {
      const r = await fetch("../lists.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      const doc = await r.json();
      await new Promise((res) => setTimeout(res, 20));
      eng = E.build(doc);
      $("dot").className = "on";
      $("lstat").textContent = `Lists of ${niceDay(eng.built)} · ${eng.total.toLocaleString("en-US")} listed parties · US, UN, UK`;
      $("covline").textContent = `${eng.total.toLocaleString("en-US")} listed parties, list version ${eng.built}.`;
      return true;
    } catch (e) {
      $("dot").className = "err";
      $("lstat").innerHTML = `Could not load the lists. <a href="#" id="retry" style="color:#fff">Try again</a>`;
      $("retry").onclick = (ev) => { ev.preventDefault(); $("lstat").textContent = "Loading the lists…"; $("dot").className = ""; start2(); };
      return false;
    }
  }
  async function start2() {
    if (!(await loadLists())) return;
    if (mode === "expired") note(`The licence for ${esc(lic.c)} ended on ${niceDay(lic.e)}. Your customers and proof log are still here and can be exported. <a href="mailto:${CONTACT}?subject=Renew%20Hugo%20Trade%20Shield">Renew</a> to switch screening back on.`);
    if (S.parties.length && canScreen() && (S.lastBuilt !== eng.built || S.parties.some((p) => !p.checked))) recheckAll(true);
  }
  (async function start() {
    await store.open();
    const got = await store.get();
    if (got && got.v === 1) S = Object.assign(S, got);
    await loadLicence();
    fill(); draw();
    await start2();
  })();
  window.TSApp = { state: () => S, engine: () => eng };   // for support and tests
})();
