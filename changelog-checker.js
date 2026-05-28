/* ── changelog-checker.js ─────────────────────────────────────
   Integrálás — csak ezt a 2 sort kell beilleszteni:

   <script id="cl-script"
     src="combined.changelog.js?app=SLUG&v=VERSION"></script>
   <script id="checker-script"
     src="changelog-checker.js?pass=PASSWORD&salt=SALT"></script>

   Kötelező elem az oldalon:  <button id="btn-version"></button>
   Opcionális letöltés gomb:  <a id="btn-download" href="#" style="display:none">...</a>

   Megjegyzés: base64 salt-ban lévő + jel → %2B az URL-ben
───────────────────────────────────────────────────────────── */
(function () {
  /* ── Saját script src rögzítése (document.currentScript csak szinkron futásban elérhető) ── */
  const SELF_SRC = document.currentScript ? document.currentScript.src : '';

  /* ── Helpers ── */
  function parseQuery(url) {
    const result = {};
    (url.split('?')[1] || '').split('&').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx < 0) return;
      result[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
    });
    return result;
  }

  function b64ToBuf(b64) {
    const s = atob(b64);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  /* ── Crypto ── */
  async function buildKey(pass, salt) {
    const raw = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBuf(salt), iterations: 100000, hash: 'SHA-256' },
      raw,
      { name: 'AES-GCM', length: 256 },
      false, ['decrypt']
    );
  }

  async function decryptEntries(encObj, pass, salt) {
    const key = await buildKey(pass, salt);
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(encObj.iv) },
      key,
      b64ToBuf(encObj.data)
    );
    return JSON.parse(new TextDecoder().decode(buf));
  }

  /* ── CSS injektálás (önálló modal, Bootstrap nélkül) ── */
  function injectStyles() {
    if (document.getElementById('cl-styles')) return;
    const style = document.createElement('style');
    style.id = 'cl-styles';
    style.textContent = `
      #cl-backdrop {
        display: none; position: fixed; inset: 0; z-index: 9998;
        background: rgba(0,0,0,.6); backdrop-filter: blur(2px);
        align-items: center; justify-content: center;
      }
      #cl-backdrop.open { display: flex; }
      #cl-dialog {
        background: #1e2130; color: #e2e8f0; border: 1px solid #2d3250;
        border-radius: 12px; width: min(680px, 95vw);
        max-height: 85vh; display: flex; flex-direction: column;
        box-shadow: 0 24px 64px rgba(0,0,0,.7);
        font-family: 'Segoe UI', system-ui, sans-serif;
      }
      #cl-dialog-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px; border-bottom: 1px solid #2d3250; flex-shrink: 0;
      }
      #cl-dialog-title { font-size: 15px; font-weight: 700; color: #f1f5f9; }
      #cl-dialog-close {
        background: none; border: none; color: #94a3b8; font-size: 20px;
        cursor: pointer; padding: 0 4px; line-height: 1;
      }
      #cl-dialog-close:hover { color: #f1f5f9; }
      #cl-dialog-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
      #cl-dialog-footer {
        padding: 12px 20px; border-top: 1px solid #2d3250;
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }
      .cl-entry {
        background: #252a3d; border: 1px solid #2d3250; border-radius: 8px;
        padding: 12px 16px; margin-bottom: 10px;
      }
      .cl-entry-meta {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        margin-bottom: 6px;
      }
      .cl-ver {
        font-family: monospace; font-size: 11px; background: #3a3f5c;
        padding: 2px 7px; border-radius: 4px; color: #94a3b8;
      }
      .cl-badge {
        font-size: 10px; font-weight: 700; padding: 2px 7px;
        border-radius: 4px; color: #fff; text-transform: uppercase;
      }
      .cl-badge-feature  { background: #1d4ed8; }
      .cl-badge-fix      { background: #15803d; }
      .cl-badge-breaking { background: #b91c1c; }
      .cl-badge-security { background: #7c3aed; }
      .cl-badge-docs     { background: #0e7490; }
      .cl-badge-tag {
        font-size: 10px; padding: 2px 6px; border-radius: 4px;
        background: #1e2130; border: 1px solid #3a3f5c; color: #64748b;
      }
      .cl-entry-title { font-weight: 600; font-size: 13px; color: #f1f5f9; }
      .cl-entry-body  { font-size: 12px; color: #94a3b8; margin-top: 4px; white-space: pre-wrap; }
      .cl-entry-date  { font-size: 11px; color: #475569; margin-top: 6px; }
      .cl-btn {
        border: none; border-radius: 6px; padding: 6px 14px;
        font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .cl-btn-close    { background: #334155; color: #cbd5e1; margin-left: auto; }
      .cl-btn-close:hover { background: #475569; }
      .cl-btn-download { background: #d97706; color: #fff; }
      .cl-btn-download:hover { background: #b45309; }
      #cl-update-banner {
        display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 9997;
        background: #dc3545; color: #fff; padding: 10px 20px;
        align-items: center; justify-content: center; gap: 12px;
        font-size: 13px; font-weight: 600; font-family: 'Segoe UI', system-ui, sans-serif;
        box-shadow: 0 -2px 16px rgba(0,0,0,.4);
      }
      #cl-update-banner.open { display: flex; }
      #cl-update-banner button {
        background: #fff; color: #dc3545; border: none; border-radius: 4px;
        padding: 4px 12px; font-weight: 700; cursor: pointer; font-size: 12px;
      }
      #btn-version.cl-has-update {
        animation: cl-pulse 1.4s ease-in-out infinite;
      }
      @keyframes cl-pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(220,53,69,.7); }
        50%      { box-shadow: 0 0 0 8px rgba(220,53,69,0); }
      }
    `;
    document.head.appendChild(style);
  }

  /* ── Modal HTML injektálás ── */
  function injectModal() {
    if (document.getElementById('cl-backdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'cl-backdrop';
    backdrop.innerHTML = `
      <div id="cl-dialog">
        <div id="cl-dialog-header">
          <span id="cl-dialog-title">Változásnapló</span>
          <button id="cl-dialog-close" title="Bezárás">&#x2715;</button>
        </div>
        <div id="cl-dialog-body"><p style="color:#64748b;text-align:center;padding:24px">Betöltés...</p></div>
        <div id="cl-dialog-footer">
          <button class="cl-btn cl-btn-close" id="cl-btn-close-footer">Bezárás</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const banner = document.createElement('div');
    banner.id = 'cl-update-banner';
    banner.innerHTML = `<span id="cl-banner-text"></span><button id="cl-banner-open">Megnézem</button>`;
    document.body.appendChild(banner);

    // Zárás kezelők
    document.getElementById('cl-dialog-close').addEventListener('click', closeModal);
    document.getElementById('cl-btn-close-footer').addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    document.getElementById('cl-banner-open').addEventListener('click', openModal);
  }

  function openModal()  { document.getElementById('cl-backdrop')?.classList.add('open'); }
  function closeModal() { document.getElementById('cl-backdrop')?.classList.remove('open'); }

  /* ── Bejegyzések renderelése ── */
  const TYPE_LABELS = {
    feature: 'Új funkció', fix: 'Hiba javítás',
    breaking: 'Törő változás', security: 'Biztonsági', docs: 'Dokumentáció'
  };
  const TYPE_CLS = {
    feature: 'cl-badge-feature', fix: 'cl-badge-fix',
    breaking: 'cl-badge-breaking', security: 'cl-badge-security', docs: 'cl-badge-docs'
  };

  function renderEntries(entries) {
    const body = document.getElementById('cl-dialog-body');
    if (!body) return;
    if (!entries || !entries.length) {
      body.innerHTML = '<p style="color:#64748b;text-align:center;padding:24px">Nincs bejegyzés.</p>';
      return;
    }
    body.innerHTML = [...entries]
      .sort((a, b) => b.version.localeCompare(a.version))
      .map(e => `
        <div class="cl-entry">
          <div class="cl-entry-meta">
            <span class="cl-ver">${e.version}</span>
            <span class="cl-badge ${TYPE_CLS[e.type] || ''}">${TYPE_LABELS[e.type] || e.type}</span>
            ${(e.tags || []).map(t => `<span class="cl-badge-tag">${t}</span>`).join('')}
          </div>
          <div class="cl-entry-title">${e.title || ''}</div>
          ${e.body ? `<div class="cl-entry-body">${e.body}</div>` : ''}
          <div class="cl-entry-date">${e.date || ''}</div>
        </div>`)
      .join('');
  }

  /* ── Fő inicializálás ── */
  function init() {
    const selfParams = parseQuery(SELF_SRC);
    const PASS = selfParams['pass'] || 'changelog_manager_auto_unlock_secret_2026';
    const SALT = selfParams['salt'] || 'Y2hhbmdlbG9nXzIwMjYhIQ==';

    // cl-script tag keresése (combined.changelog.js)
    const clEl = document.getElementById('cl-script') ||
      Array.from(document.querySelectorAll('script[src]'))
        .find(s => s.src.includes('.changelog.js') && !s.src.includes('changelog-checker'));
    if (!clEl) return;

    const clParams = parseQuery(clEl.src);
    const slug     = clParams['app'];
    const current  = clParams['v'];
    if (!slug || !current) return;

    // Changelog adatobjektum
    const clObj =
      (typeof CHANGELOG_COMBINED !== 'undefined' ? CHANGELOG_COMBINED : null) ||
      window['CHANGELOG_' + slug.toUpperCase().replace(/-/g, '_')] || null;
    if (!clObj) return;

    const appData = clObj.apps ? clObj.apps[slug] : clObj;
    if (!appData) return;

    const latest = appData.meta?.latestVersion;

    injectStyles();
    injectModal();

    // #btn-version feltöltése és kattintás kezelő
    const btn = document.getElementById('btn-version');
    if (btn) {
      btn.textContent = `v${current}`;

      let entriesCache = null;
      btn.addEventListener('click', async () => {
        openModal();
        if (!entriesCache) {
          try {
            entriesCache = await decryptEntries(appData.encrypted, PASS, SALT);
          } catch (err) {
            document.getElementById('cl-dialog-body').innerHTML =
              `<p style="color:#f87171;padding:16px">Visszafejtési hiba: ${err.message}</p>`;
            return;
          }
        }
        renderEntries(entriesCache);
      });

      // Frissítési UI
      if (latest && latest > current) {
        const seenKey = 'cl_seen_' + slug;
        btn.classList.add('cl-has-update');

        if (localStorage.getItem(seenKey) !== latest) {
          const banner = document.getElementById('cl-update-banner');
          document.getElementById('cl-banner-text').textContent =
            `⚠ Frissítés elérhető: ${latest} verzió (jelenlegi: ${current})`;
          banner?.classList.add('open');
        }

        // Letöltés gomb a modal footerben
        const footer = document.getElementById('cl-dialog-footer');
        if (footer && !document.getElementById('cl-btn-download')) {
          const dl = document.createElement('button');
          dl.id        = 'cl-btn-download';
          dl.className = 'cl-btn cl-btn-download';
          dl.textContent = `⬇ Frissítés letöltése (${latest})`;
          dl.addEventListener('click', () => {
            localStorage.setItem('cl_seen_' + slug, latest);
            document.getElementById('cl-update-banner')?.classList.remove('open');
            btn.classList.remove('cl-has-update');
            // TODO: ide kerülhet a tényleges letöltési link
            alert(`Frissítés: ${latest} — add meg a letöltési URL-t a changelog-checker.js-ben.`);
          });
          footer.prepend(dl);
        }
      }
    }
  }

  // window.load-ot használunk: garantálja hogy a CDN-ről töltött
  // combined.changelog.js már lefutott és CHANGELOG_COMBINED elérhető.
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
