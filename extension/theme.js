// Look of the overlay: the same tokens as substance-tracker (dark violet, Roboto Mono,
// 2 px borders, glass). Kept as a string because a content script cannot load a
// stylesheet of its own without listing it as a web-accessible resource.
self.VTR_THEME_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap");

:host { all: initial; }
* { box-sizing: border-box; }

.vtr-launch {
  position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;
  height: 48px; padding: 0 18px; border-radius: 12px;
  border: 2px solid #d0bcff; background: #d0bcff; color: #381e72;
  font: 700 14px/1 'Roboto Mono', monospace; cursor: pointer;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.vtr-launch:focus-visible, .vtr-btn:focus-visible, .vtr-chip:focus-visible,
.vtr-item:focus-visible, .vtr-tab:focus-visible, .vtr-search:focus-visible {
  outline: 2px solid #d0bcff; outline-offset: 2px;
}

.vtr-overlay {
  position: fixed; inset: 0; z-index: 2147483001;
  background: rgba(10,10,12,0.72);
  display: flex; align-items: stretch; justify-content: center;
  padding: 24px;
}
.vtr-overlay[hidden] { display: none; }

.vtr-panel {
  width: 100%; max-width: 1280px; max-height: 100%;
  display: flex; flex-direction: column; gap: 16px; padding: 20px;
  background: #1f1f22; color: #e6e6ea;
  border: 2px solid #3d3d44; border-radius: 12px;
  font: 400 14px/1.5 'Roboto Mono', monospace;
  overflow: auto;
}

.vtr-top {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px;
  padding: 14px 18px; background: rgba(35,35,39,0.6);
  border: 2px solid #3d3d44; border-radius: 12px;
}
.vtr-title { font-size: 20px; font-weight: 700; color: #d0bcff; }
.vtr-sub { color: #b9b9c1; font-size: 12px; }
.vtr-badge {
  padding: 3px 10px; border-radius: 999px; border: 2px solid #8b8b95;
  color: #b9b9c1; font-size: 11px; font-weight: 700; text-transform: uppercase;
}
.vtr-spacer { flex: 1 1 auto; }
.vtr-search {
  flex: 1 1 240px; min-width: 0; height: 40px; padding: 0 12px;
  border: 2px solid #3d3d44; border-radius: 10px; background: #121214;
  color: #e6e6ea; font: inherit;
}

.vtr-body {
  display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;
}
.vtr-list-col {
  flex: 1 1 320px; max-width: 420px; min-width: 0;
  display: flex; flex-direction: column; gap: 12px;
}
.vtr-detail {
  flex: 999 1 520px; min-width: 0;
  display: flex; flex-direction: column; gap: 14px;
}

.vtr-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.vtr-chip {
  height: 32px; padding: 0 14px; border-radius: 999px;
  border: 2px solid #3d3d44; background: transparent; color: #e6e6ea;
  font: inherit; cursor: pointer;
}
.vtr-chip[aria-pressed="true"] { background: #4f378b; border-color: #d0bcff; color: #eaddff; font-weight: 700; }

.vtr-item {
  width: 100%; text-align: left; cursor: pointer;
  display: flex; flex-direction: column; gap: 3px;
  padding: 14px 16px; border-radius: 12px;
  border: 2px solid #3d3d44; background: #18181b; color: inherit; font: inherit;
}
.vtr-item[aria-current="true"] { border-color: #d0bcff; background: #121214; }
.vtr-item-title { font-weight: 700; font-size: 15px; }
.vtr-item-line { color: #b9b9c1; font-size: 12px; }
.vtr-item-date { color: #8b8b95; font-size: 12px; }

.vtr-status {
  align-self: flex-start; margin-top: 6px; padding: 2px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.vtr-status[data-s="New"] { background: #4f378b; color: #eaddff; }
.vtr-status[data-s="In progress"] { background: #004f58; color: #97f0ff; }
.vtr-status[data-s="Waiting"] { background: #3d3d44; color: #e6e6ea; }

.vtr-h1 { margin: 0; font-size: 22px; font-weight: 700; }
.vtr-muted { color: #b9b9c1; }
.vtr-meta {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px 20px; padding: 16px 18px;
  background: #232327; border: 2px solid #3d3d44; border-radius: 12px;
}
.vtr-label { color: #8b8b95; font-size: 11px; font-weight: 700; text-transform: uppercase; }

.vtr-tabs {
  display: inline-flex; align-self: flex-start; gap: 4px; padding: 4px;
  border: 2px solid #3d3d44; border-radius: 999px; background: #121214;
}
.vtr-tab {
  height: 34px; padding: 0 16px; border: 0; border-radius: 999px;
  background: transparent; color: #e6e6ea; font: inherit; cursor: pointer;
}
.vtr-tab[aria-selected="true"] { background: #d0bcff; color: #381e72; font-weight: 700; }

.vtr-text {
  padding: 18px 20px; background: #121214; border: 2px solid #3d3d44; border-radius: 12px;
  display: flex; flex-direction: column; gap: 12px; white-space: pre-line;
}
.vtr-ai {
  padding: 18px 20px; background: #232327; border: 2px solid #4f378b; border-radius: 12px;
  display: flex; flex-direction: column; gap: 12px;
}
.vtr-ai-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.vtr-ai-title { font-size: 16px; font-weight: 700; }
.vtr-ai-chip {
  padding: 4px 12px; border-radius: 999px; background: #004f58; color: #97f0ff;
  font-size: 12px; font-weight: 700;
}

.vtr-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.vtr-btn {
  height: 40px; padding: 0 18px; border-radius: 10px;
  border: 2px solid #8b8b95; background: transparent; color: #e6e6ea;
  font: 700 14px/1 'Roboto Mono', monospace; cursor: pointer;
}
.vtr-btn.primary { background: #d0bcff; border-color: #d0bcff; color: #381e72; }
.vtr-btn.ghost { border-color: #8b8b95; }
.vtr-btn:disabled { opacity: .38; cursor: not-allowed; }
.vtr-note { color: #8b8b95; font-size: 12px; }

.vtr-empty { color: #8b8b95; padding: 24px 0; }

@media (max-width: 720px) {
  .vtr-overlay { padding: 8px; }
  .vtr-launch { right: 12px; bottom: 12px; }
}
`;
