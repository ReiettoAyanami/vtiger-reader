// Runs on the CRM's pages the user allowed (see background.js). It adds one
// button and a full-screen view in the new look. The view lives in a shadow
// root, so the CRM's own styles cannot change it and it cannot change the CRM.
// Step 1: it shows the sample tickets only. The CRM is not read yet.
(function () {
  if (window.__vtrMounted) return;
  window.__vtrMounted = true;

  const data = self.VTR_SAMPLE;
  const tickets = data.tickets;

  const FILTERS = [
    { id: "all", label: "All", test: () => true },
    { id: "new", label: "New", test: (t) => t.status === "New" },
    { id: "waiting", label: "Waiting", test: (t) => t.status === "Waiting" },
  ];

  const state = {
    filter: "all",
    query: "",
    selected: tickets[0].id,
    tab: "clean",
  };

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  const host = document.createElement("div");
  host.id = "vtr-host";
  (document.body || document.documentElement).appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>${self.VTR_THEME_CSS}</style>
    <button class="vtr-launch" type="button" data-act="open" aria-haspopup="dialog">vtiger-reader</button>
    <div class="vtr-overlay" hidden>
      <div class="vtr-panel" role="dialog" aria-modal="true" aria-label="vtiger-reader">
        <header class="vtr-top">
          <div>
            <div class="vtr-title">vtiger-reader</div>
            <div class="vtr-sub">${tickets.length} tickets</div>
          </div>
          <span class="vtr-badge">Sample data</span>
          <span class="vtr-spacer"></span>
          <input class="vtr-search" type="search" placeholder="Search tickets" aria-label="Search tickets">
          <button class="vtr-btn ghost" type="button" data-act="close">Close</button>
        </header>
        <div class="vtr-body">
          <section class="vtr-list-col" aria-label="Ticket list">
            <div class="vtr-chips" role="group" aria-label="Filter"></div>
            <div class="vtr-list"></div>
          </section>
          <section class="vtr-detail" aria-label="Ticket detail"></section>
        </div>
      </div>
    </div>
  `;

  const $ = (selector) => root.querySelector(selector);
  const launch = $(".vtr-launch");
  const overlay = $(".vtr-overlay");
  const chips = $(".vtr-chips");
  const list = $(".vtr-list");
  const detail = $(".vtr-detail");
  const search = $(".vtr-search");

  function visibleTickets() {
    const filter = FILTERS.find((f) => f.id === state.filter) || FILTERS[0];
    return tickets.filter((t) => {
      if (!filter.test(t)) return false;
      if (!state.query) return true;
      const haystack = (t.title + " " + t.customer + " " + t.id).toLowerCase();
      return haystack.includes(state.query);
    });
  }

  function renderChips() {
    chips.innerHTML = FILTERS.map(
      (f) =>
        `<button type="button" class="vtr-chip" data-filter="${esc(f.id)}" aria-pressed="${state.filter === f.id}">${esc(f.label)}</button>`
    ).join("");
  }

  function renderList() {
    const items = visibleTickets();
    if (items.length === 0) {
      list.innerHTML = `<div class="vtr-empty">No tickets match.</div>`;
      return;
    }
    list.innerHTML = items
      .map(
        (t) => `
        <button type="button" class="vtr-item" data-id="${esc(t.id)}" aria-current="${t.id === state.selected}">
          <span class="vtr-item-title">${esc(t.title)}</span>
          <span class="vtr-item-line">#${esc(t.id)}</span>
          <span class="vtr-item-line">${esc(t.customer)}</span>
          <span class="vtr-item-date">Opened ${esc(t.opened)}</span>
          <span class="vtr-status" data-s="${esc(t.status)}">${esc(t.status)}</span>
        </button>`
      )
      .join("");
  }

  function meta(label, value) {
    return `<div><div class="vtr-label">${esc(label)}</div><div>${esc(value)}</div></div>`;
  }

  function renderDetail() {
    const t = tickets.find((x) => x.id === state.selected) || tickets[0];
    const clean = state.tab === "clean";
    const text = clean ? t.clean : t.raw;
    detail.innerHTML = `
      <h1 class="vtr-h1">${esc(t.title)}</h1>
      <div class="vtr-muted">#${esc(t.id)}</div>
      <div class="vtr-meta">
        ${meta("Customer", t.customer)}
        ${meta("Contact", t.contact)}
        ${meta("Opened", t.opened)}
        ${meta("Owner", t.owner)}
      </div>
      <div class="vtr-tabs" role="tablist" aria-label="Message view">
        <button type="button" class="vtr-tab" role="tab" data-tab="clean" aria-selected="${clean}">Cleaned</button>
        <button type="button" class="vtr-tab" role="tab" data-tab="raw" aria-selected="${!clean}">Raw</button>
      </div>
      <div class="vtr-text" style="white-space: ${clean ? "pre-line" : "pre-wrap"}">${esc(text)}</div>
      <div class="vtr-ai">
        <div class="vtr-ai-head">
          <div class="vtr-ai-title">AI summary</div>
          <div class="vtr-ai-chip">Sample</div>
        </div>
        <p style="margin: 0">${esc(t.ai)}</p>
        <div class="vtr-actions">
          <button type="button" class="vtr-btn primary" disabled>Ask AI</button>
          <button type="button" class="vtr-btn" disabled>Re-run</button>
        </div>
        <div class="vtr-note">AI comes in a later step: the text above is a sample.</div>
      </div>
      <div class="vtr-actions">
        <button type="button" class="vtr-btn" disabled>Reply</button>
        <button type="button" class="vtr-btn" disabled>Assign</button>
        <button type="button" class="vtr-btn" disabled>Close ticket</button>
      </div>
      <div class="vtr-note">Read-only in this version: the write actions are shown, not active.</div>
    `;
  }

  function renderAll() {
    renderChips();
    renderList();
    renderDetail();
  }

  function open() {
    overlay.hidden = false;
    renderAll();
    search.focus();
  }

  function close() {
    overlay.hidden = true;
    launch.focus();
  }

  launch.addEventListener("click", open);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  root.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const act = target.closest("[data-act='close']");
    if (act) return close();

    const chip = target.closest("[data-filter]");
    if (chip) {
      state.filter = chip.getAttribute("data-filter");
      renderChips();
      renderList();
      return;
    }

    const item = target.closest("[data-id]");
    if (item) {
      state.selected = item.getAttribute("data-id");
      renderList();
      renderDetail();
      return;
    }

    const tab = target.closest("[data-tab]");
    if (tab) {
      state.tab = tab.getAttribute("data-tab");
      renderDetail();
    }
  });

  search.addEventListener("input", () => {
    state.query = search.value.trim().toLowerCase();
    renderList();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });
})();
