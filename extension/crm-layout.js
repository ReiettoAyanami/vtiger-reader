// vtiger-reader: impaginazione come nel canvas, sopra gli elementi del CRM.
// Non cambia dati né funzioni del CRM: aggiunge solo piccoli elementi di presentazione
// (filtri a pillole, contatto sotto il titolo, numero del ticket) e attributi data-vtr-*.
//  - lista: pillole di filtro con i conteggi (filtrano le righe della pagina aperta),
//           contatto sotto il titolo (la colonna Contatto si nasconde), riga aperta evidenziata;
//  - scheda: numero del ticket sopra il titolo.
(function () {
  if (window.__vtrLayout) return;
  window.__vtrLayout = true;

  // ---------- lista: filtri a pillole ----------
  const GROUPS = [
    { id: "all", label: "Tutti", test: () => true },
    { id: "work", label: "In lavorazione", test: (s) => s === "In Progress" },
    { id: "wait", label: "In attesa", test: (s) => s === "Wait For Response" || s.indexOf("Attesa") === 0 },
    { id: "plan", label: "Programmati", test: (s) => s.indexOf("Attivit") === 0 },
    { id: "new", label: "Non assegnati", test: (s) => s === "Open" },
    { id: "closed", label: "Chiusi", test: (s) => s === "Closed" || s === "Annullato" },
  ];
  let current = "all";

  function statusOf(tr) {
    const td = tr.querySelector('td[data-name="ticketstatus"]');
    return td ? (td.getAttribute("data-rawvalue") || td.textContent || "").trim() : null;
  }

  function applyFilter(table) {
    const g = GROUPS.find((x) => x.id === current) || GROUPS[0];
    table.querySelectorAll("tbody tr.listViewEntries").forEach((tr) => {
      const s = statusOf(tr);
      if (s === null || g.test(s)) tr.removeAttribute("data-vtr-hidden");
      else tr.setAttribute("data-vtr-hidden", "");
    });
  }

  function chips(table) {
    const rows = [...table.querySelectorAll("tbody tr.listViewEntries")];
    if (!rows.length || statusOf(rows[0]) === null) return; // la lista non ha la colonna Stato
    const holder = table.closest("#table-content") || table.parentElement;
    let bar = holder.previousElementSibling;
    if (!bar || !bar.classList.contains("vtr-chips")) {
      bar = document.createElement("div");
      bar.className = "vtr-chips";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Filtra per stato");
      holder.parentElement.insertBefore(bar, holder);
      bar.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-group]");
        if (!b) return;
        current = b.getAttribute("data-group");
        const t = document.querySelector("#listview-table");
        if (t) { chips(t); applyFilter(t); }
      });
    }
    const counts = GROUPS.map((g) => rows.filter((tr) => g.test(statusOf(tr))).length);
    if (!counts[GROUPS.findIndex((g) => g.id === current)]) current = "all";
    const html = GROUPS.map((g, i) => (g.id !== "all" && !counts[i]) ? "" :
      `<button type="button" class="vtr-chip" data-group="${g.id}" aria-pressed="${g.id === current}">${g.label} (${counts[i]})</button>`).join("");
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }

  // ---------- lista: contatto sotto il titolo ----------
  function contactUnderTitle(table) {
    const head = table.querySelector("thead tr.listViewContentHeader") || table.querySelector("thead tr");
    const th = head && head.querySelector('th[data-columnname="contact_id"]');
    const hasTitle = table.querySelector('td[data-name="ticket_title"]');
    if (!th || !hasTitle) return;
    const idx = [...head.children].indexOf(th);
    th.setAttribute("data-vtr-col-hidden", "");
    // la colonna del titolo, con il contatto sotto, ha bisogno di spazio: se è stretta la
    // allargo una volta (larghezza in linea, come fa il CRM), poi resta trascinabile
    const tth = head.querySelector('th[data-columnname="ticket_title"]');
    if (tth && !tth.hasAttribute("data-vtr-widened") && tth.getBoundingClientRect().width < 300) {
      tth.style.width = "320px";
      tth.setAttribute("data-vtr-widened", "");
    }
    const search = table.querySelector("thead tr.searchRow");
    if (search && search.children[idx]) search.children[idx].setAttribute("data-vtr-col-hidden", "");
    table.querySelectorAll("tbody tr.listViewEntries").forEach((tr) => {
      const t = tr.querySelector('td[data-name="ticket_title"]');
      const c = tr.querySelector('td[data-name="contact_id"]');
      if (!t || !c) return;
      c.setAttribute("data-vtr-col-hidden", "");
      const name = c.textContent.replace(/\s+/g, " ").trim();
      let under = t.querySelector(".vtr-under");
      if (!name || name === "--") { if (under) under.remove(); return; }
      if (!under) {
        under = document.createElement("div");
        under.className = "vtr-under";
        t.appendChild(under);
      }
      if (under.textContent !== name) under.textContent = name;
    });
  }

  // ---------- lista: riga aperta ----------
  document.addEventListener("click", (e) => {
    const tr = e.target.closest && e.target.closest("tr.listViewEntries");
    if (!tr) return;
    document.querySelectorAll("tr.listViewEntries[data-vtr-open]").forEach((x) => x.removeAttribute("data-vtr-open"));
    tr.setAttribute("data-vtr-open", "");
  }, true);

  // ---------- scheda: numero del ticket sopra il titolo ----------
  function ticketNumber() {
    const label = document.querySelector(".record-header .recordLabel");
    if (!label || label.parentElement.querySelector(".vtr-ticketno")) return;
    const input = document.querySelector('input.fieldBasicData[data-name="ticket_no"]');
    let no = input && (input.getAttribute("data-displayvalue") || input.getAttribute("data-value"));
    if (!no) {
      // Riepilogo: tr[data-fieldname]; Dettagli: td con id …_fieldValue_ticket_no
      const td = document.querySelector('tr[data-fieldname="ticket_no"] td.fieldValue, [id$="_fieldValue_ticket_no"]');
      no = td && td.textContent.replace(/\s+/g, " ").trim();
    }
    if (!no) return;
    const el = document.createElement("div");
    el.className = "vtr-ticketno";
    el.textContent = "#" + no;
    label.parentElement.insertBefore(el, label);
  }

  function run() {
    const table = document.querySelector("#listview-table");
    if (table && table.querySelector("tr.listViewEntries")) {
      contactUnderTitle(table);
      chips(table);
      applyFilter(table);
    }
    ticketNumber();
  }

  let timer = null;
  function later() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; run(); }, 80);
  }

  run();
  new MutationObserver((list) => {
    // ignoro i cambiamenti fatti da questo script (pillole e righe sotto il titolo)
    const mine = list.every((m) => m.target.closest && m.target.closest(".vtr-chips, .vtr-under"));
    if (!mine) later();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
