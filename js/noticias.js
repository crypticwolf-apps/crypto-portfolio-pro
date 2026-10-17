// =============================================================================
// noticias.js - Pestana Noticias: feed de cryptoatalaya.com con cache,
// categorias e impacto.
// =============================================================================

// ── Pestaña Mercados: una única tabla general de mercado, ordenable ──
/* ═══════════════════════════════════════════════════════
   NOTICIAS — feed de Crypto Atalaya (solo lectura).
   ═══════════════════════════════════════════════════════ */

function loadNewsCache() {
  const c = safeParse(localStorage.getItem(NEWS_CACHE_KEY));
  if (c && Array.isArray(c.items)) {
    state.news = c.items;
    state.newsAt = Number(c.at) || 0;
  }
}

function saveNewsCache() {
  try {
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ at: state.newsAt, items: state.news.slice(0, 60) }));
  } catch {
    // Cuota llena: las noticias siguen en memoria durante la sesion.
  }
}

// Normaliza cada noticia a lo que pinta la interfaz. Campos ausentes no rompen.
function normalizeNews(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((n) => ({
      id: String(n.id || n.tg || Math.random()),
      ts: Number(n.ts) > 0 ? Number(n.ts) * 1000 : Date.parse(n.fecha || "") || 0,
      titulo: String(n.titulo || "").trim(),
      cuerpo: String(n.cuerpo || "").trim(),
      analisis: String(n.analisis || "").trim(),
      cat: String(n.cat || "").trim(),
      cats: Array.isArray(n.cats) ? n.cats : [],
      tags: Array.isArray(n.tags) ? n.tags : [],
      impacto: Number.isFinite(Number(n.impacto)) ? Number(n.impacto) : null,
      enlace: String(n.web || n.url || n.permalink || n.tg || n.fuente || "").trim()
    }))
    .filter((n) => n.titulo)
    .sort((a, b) => b.ts - a.ts);
}

async function fetchNews(force) {
  if (state.newsLoading) return;
  const fresco = Date.now() - state.newsAt < NEWS_TTL;
  if (!force && fresco && state.news.length) return;
  state.newsLoading = true;
  state.newsError = null;
  renderNews();
  try {
    const res = await fetch(NEWS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const items = normalizeNews(data && data.noticias ? data.noticias : data);
    if (items.length) {
      state.news = items;
      state.newsAt = Date.now();
      saveNewsCache();
    }
  } catch (error) {
    // Sin conexion o el servidor aun no permite el acceso desde este dominio:
    // se conservan las ultimas noticias guardadas y se avisa.
    state.newsError = error && error.message ? error.message : "error";
  } finally {
    state.newsLoading = false;
    renderNews();
  }
}

function newsCategories() {
  const cuenta = new Map();
  state.news.forEach((n) => {
    (n.cats && n.cats.length ? n.cats : [n.cat]).forEach((c) => {
      if (!c) return;
      cuenta.set(c, (cuenta.get(c) || 0) + 1);
    });
  });
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

function newsFiltered() {
  if (state.newsFilter === "all") return state.news;
  return state.news.filter((n) => (n.cats && n.cats.includes(state.newsFilter)) || n.cat === state.newsFilter);
}

function newsImpactTone(v) {
  if (v == null) return "";
  if (v >= 70) return "alta";
  if (v >= 40) return "media";
  return "baja";
}

function renderNews() {
  const box = document.getElementById("newsList");
  if (!box) return;
  const estado = document.getElementById("newsStatus");
  const filtros = document.getElementById("newsFilters");

  if (estado) {
    estado.textContent = state.newsLoading
      ? t("news.loading")
      : state.newsAt
        ? t("news.updated", { time: formatRelativeTime(state.newsAt) })
        : t("news.subtitle");
  }

  if (filtros) {
    const cats = newsCategories();
    filtros.innerHTML = state.news.length
      ? [["all", state.news.length]].concat(cats)
          .map(([c, n]) => `<button class="news-filter ${state.newsFilter === c ? "is-active" : ""}" type="button" data-news-cat="${escapeHtml(c)}">${escapeHtml(c === "all" ? t("news.all") : c)} <span>${n}</span></button>`)
          .join("")
      : "";
  }

  // Cargando por primera vez: esqueleto con la forma final.
  if (state.newsLoading && !state.news.length) {
    box.innerHTML = Array.from({ length: 4 }, () => `
      <article class="news-card is-skeleton">
        <div class="news-card-top"><span class="news-sk news-sk-cat"></span><span class="news-sk news-sk-time"></span></div>
        <span class="news-sk news-sk-title"></span>
        <span class="news-sk news-sk-line"></span>
        <span class="news-sk news-sk-line short"></span>
      </article>`).join("");
    return;
  }

  const items = newsFiltered();

  if (!items.length) {
    box.innerHTML = `
      <div class="news-empty">
        <strong>${escapeHtml(state.newsError ? t("news.errorTitle") : t("news.emptyTitle"))}</strong>
        <p>${escapeHtml(state.newsError ? t("news.errorText") : t("news.emptyText"))}</p>
        <button class="ghost-btn" type="button" data-news-action="retry">${escapeHtml(t("news.retry"))}</button>
      </div>`;
    return;
  }

  const aviso = state.newsError
    ? `<p class="news-stale">${escapeHtml(t("news.staleText", { time: state.newsAt ? formatRelativeTime(state.newsAt) : "--" }))}</p>`
    : "";

  box.innerHTML = aviso + items.map((n) => {
    const abierta = Boolean(state.newsOpen[n.id]);
    const tono = newsImpactTone(n.impacto);
    return `
      <article class="news-card${abierta ? " is-open" : ""}" data-news-id="${escapeHtml(n.id)}">
        <button class="news-card-head" type="button" data-news-toggle="${escapeHtml(n.id)}" aria-expanded="${abierta ? "true" : "false"}">
          <span class="news-card-top">
            ${n.cat ? `<span class="news-cat">${escapeHtml(n.cat)}</span>` : ""}
            <span class="news-time">${escapeHtml(n.ts ? formatRelativeTime(n.ts) : "")}</span>
            ${n.impacto != null ? `<span class="news-impact ${tono}" title="${escapeHtml(t("news.impact"))}">${n.impacto}</span>` : ""}
          </span>
          <span class="news-title">${escapeHtml(n.titulo)}</span>
        </button>
        <div class="news-body">
          ${n.cuerpo ? `<p class="news-text">${escapeHtml(n.cuerpo)}</p>` : ""}
          ${n.analisis ? `<p class="news-analysis"><strong>${escapeHtml(t("news.analysis"))}</strong> ${escapeHtml(n.analisis)}</p>` : ""}
        </div>
      </article>`;
  }).join("");
}

function bindNews() {
  const box = document.getElementById("newsList");
  const filtros = document.getElementById("newsFilters");
  document.getElementById("newsRefreshBtn")?.addEventListener("click", () => fetchNews(true));
  filtros?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-news-cat]");
    if (!b) return;
    state.newsFilter = b.dataset.newsCat;
    renderNews();
  });
  box?.addEventListener("click", (e) => {
    const r = e.target.closest('[data-news-action="retry"]');
    if (r) { fetchNews(true); return; }
    const tgl = e.target.closest("[data-news-toggle]");
    if (!tgl) return;
    const id = tgl.dataset.newsToggle;
    state.newsOpen[id] = !state.newsOpen[id];
    const card = box.querySelector(`[data-news-id="${CSS.escape(id)}"]`);
    if (card) {
      card.classList.toggle("is-open", state.newsOpen[id]);
      tgl.setAttribute("aria-expanded", state.newsOpen[id] ? "true" : "false");
    }
  });
}
