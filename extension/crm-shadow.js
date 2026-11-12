// vtiger-reader: commenti del CRM, dentro le loro shadow root.
// 1. Stile: il corpo dei commenti (spesso una mail con i suoi colori) sta in una shadow root
//    aperta, dove crm-look.css non arriva. Aggiungo solo un <style> e l'attributo
//    data-vtr-dark sull'elemento che la ospita.
// 2. Immagini: le mail citano le immagini come "cid:image001.jpg@…", che il CRM non risolve.
//    Lo stesso commento ha gli allegati con quel nome e un link di download della sessione:
//    scarico l'allegato con la sessione già aperta e lo mostro al posto del riferimento.
// Non cambio dati del CRM e non uso chiavi o password.
(function () {
  if (window.__vtrShadowStyled) return;
  window.__vtrShadowStyled = true;

  const CSS = `
    :host { color: #e6e6ea !important; }
    *, *::before, *::after {
      color: inherit !important;
      background-color: transparent !important;
      border-color: #3d3d44 !important;
    }
    * { font-family: "Roboto Mono", ui-monospace, monospace !important; }
    a, a * { color: #d0bcff !important; }
    blockquote {
      margin-left: 0 !important;
      padding-left: 12px !important;
      border-left: 2px solid #3d3d44 !important;
      color: #b9b9c1 !important;
    }
    hr { border: 0 !important; border-top: 2px solid #3d3d44 !important; }
    img { max-width: 100% !important; height: auto !important; border-radius: 6px; }
    img[data-vtr-cid]:not([data-vtr-ok]) { min-width: 24px; min-height: 16px; outline: 2px dashed #3d3d44; }
  `;

  // ---------- immagini cid: ----------
  const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
  const loaded = new Map(); // url -> Promise<object URL>

  function cidName(src) {
    // "cid:image001.jpg@01DD6D4C.7407C030" -> "image001.jpg"
    let v = src.slice(4);
    try { v = decodeURIComponent(v); } catch (e) { /* lascio com'è */ }
    return v.split("@")[0].trim().toLowerCase();
  }

  function attachmentsOf(host) {
    const map = new Map(); // nome file -> { url, el }
    const box = host.closest(".singleComment, .commentDetails, .commentDiv");
    if (!box) return map;
    box.querySelectorAll(".filePreview").forEach((fp) => {
      const prev = fp.querySelector("a.previewfile");
      const dl = fp.querySelector('a[name="downloadfile"]');
      if (!prev || !dl) return;
      const name = (prev.getAttribute("data-filename") || prev.textContent || "").trim().toLowerCase();
      if (name) map.set(name, { url: dl.href, el: fp });
    });
    return map;
  }

  function objectUrl(url, name) {
    if (!loaded.has(url)) {
      const type = TYPES[(name.split(".").pop() || "").toLowerCase()] || "";
      loaded.set(url, fetch(url, { credentials: "same-origin" })
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          // una pagina HTML (sessione scaduta, errore) non è un'immagine: lascio stare
          if ((r.headers.get("content-type") || "").includes("text/html")) throw new Error("non è un'immagine");
          return r.blob();
        })
        .then((b) => {
          if (!b.size) throw new Error("vuoto");
          return URL.createObjectURL(type ? new Blob([b], { type }) : b);
        }));
    }
    return loaded.get(url);
  }

  function fixImages(host) {
    const root = host.shadowRoot;
    if (!root) return;
    const imgs = root.querySelectorAll('img[src^="cid:" i]');
    if (!imgs.length) return;
    const map = attachmentsOf(host);
    imgs.forEach((img) => {
      if (img.hasAttribute("data-vtr-cid")) return;
      const name = cidName(img.getAttribute("src"));
      img.setAttribute("data-vtr-cid", name);
      const att = map.get(name);
      if (!att) return;
      objectUrl(att.url, name)
        .then((u) => {
          img.src = u;
          img.setAttribute("data-vtr-ok", "");
          att.el.setAttribute("data-vtr-inline", ""); // l'allegato si vede già nella mail
        })
        .catch(() => { /* l'immagine resta com'era nel CRM */ });
    });
  }

  // ---------- stile ----------
  // con shadow root: aggiungo lo stile (una volta sola). Senza: il testo è nel DOM normale e
  // crm-look.css lo stilizza già. In tutti e due i casi segno l'elemento come scuro; se la
  // shadow root arriva dopo, la scansione successiva aggiunge lo stile.
  function style(host) {
    const root = host.shadowRoot;
    if (root && !root.querySelector("style[data-vtr]")) {
      const el = document.createElement("style");
      el.setAttribute("data-vtr", "");
      el.textContent = CSS;
      root.appendChild(el);
    }
    if (!host.hasAttribute("data-vtr-dark")) host.setAttribute("data-vtr-dark", "");
    fixImages(host);
  }

  function scan() {
    document.querySelectorAll(".commentInfoContent .shadow-dom-content").forEach(style);
  }

  // i commenti arrivano anche dopo (Ajax) e la shadow root può essere attaccata
  // un attimo dopo l'elemento: ricontrollo a ogni cambiamento, più due volte dopo
  let timer = null;
  function later() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
      setTimeout(scan, 400);
      setTimeout(scan, 1500);
    }, 50);
  }

  scan();
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
})();
