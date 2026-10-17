// =============================================================================
// exportar.js - PDF de la cartera (jsPDF, descarga o compartir), exportar e
// importar CSV y borrar todos los datos.
// =============================================================================

async function ensureJsPdf() {
  if (window.jspdf?.jsPDF && window.jspdf?.jsPDF?.API?.autoTable) {
    return window.jspdf.jsPDF;
  }
  if (!window.jspdf?.jsPDF) {
    await loadExternalScript(JSPDF_URL);
  }
  if (!window.jspdf?.jsPDF?.API?.autoTable) {
    await loadExternalScript(JSPDF_AUTOTABLE_URL);
  }
  return window.jspdf?.jsPDF;
}

function formatGeneratedDate(date) {
  return new Intl.DateTimeFormat(getUiLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function handleResetData() {
  const confirmed = window.confirm(t("alerts.resetConfirm"));
  if (!confirmed) {
    return;
  }

  state.rows = [createRow()];
  state.history = [];
  state.activity = [];
  clearAllTimers();
  persistHistory();
  persistState(true);
  renderAll();
  showToast(t("alerts.resetDoneTitle"), t("alerts.resetDoneText"), "warning");
}

function handleExportCsv() {
  const headers = [
    "crypto",
    "coinId",
    "resolvedName",
    "symbol",
    "investment",
    "tokens",
    "entryPrice",
    "tp1",
    "tp2",
    "tp3",
    "favorite",
    "pinned",
    "derivedField",
    "note",
    "purchaseDate",
    "personalLabel"
  ];

  const rows = state.rows.map((row) => [
    row.crypto,
    row.coinId,
    row.resolvedName,
    row.symbol,
    row.investment,
    row.tokens,
    row.entryPrice,
    row.tp1,
    row.tp2,
    row.tp3,
    row.favorite ? "true" : "false",
    row.pinned ? "true" : "false",
    row.derivedField || "",
    row.note || "",
    row.purchaseDate || "",
    row.personalLabel || ""
  ]);

  const csv = [headers, ...rows]
    .map((line) => line.map(escapeCsvCell).join(","))
    .join("\n");

  const filename = `portfolio-${sanitizeFilenamePart(getPortfolioName())}-${formatFileDate(new Date())}.csv`;
  downloadTextFile(filename, csv, "text/csv;charset=utf-8");
  pushActivity(t("alerts.exportTitle"), t("alerts.exportText"), "neutral");
}

function sanitizePdfText(value) {
  return String(value ?? "")
    .replace(/€/g, "EUR ")
    .replace(/\u00a0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFileDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function drawPdfKpiCard(doc, x, y, width, height, label, value, color) {
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, width, height, 2.5, 2.5, "FD");

  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(sanitizePdfText(label), x + width / 2, y + 5.5, { align: "center" });

  doc.setTextColor(color[0], color[1], color[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(sanitizePdfText(value), x + width / 2, y + 13, { align: "center" });
}

function drawPdfFooter(doc, pageWidth, pageHeight, margin, pageNum) {
  const footerY = pageHeight - 8;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(sanitizePdfText(t("pdf.footer")), margin, footerY);
  doc.text(String(pageNum), pageWidth / 2, footerY, { align: "center" });
  doc.setFontSize(5.5);
  doc.text("ETH: 0x6Cb6eEC878C4bBF3eb464A597596cD6e8cF11B92", pageWidth - margin, footerY, { align: "right" });
}

function drawPdfGradientLine(doc, x, y, width) {
  const steps = 40;
  const stepW = width / steps;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.round(15 + (34 - 15) * ratio);
    const g = Math.round(23 + (211 - 23) * ratio);
    const b = Math.round(42 + (238 - 42) * ratio);
    doc.setFillColor(r, g, b);
    doc.rect(x + i * stepW, y, stepW + 0.3, 1.2, "F");
  }
}

function buildPdfPieChartImage(snapshot) {
  if (typeof Chart === "undefined") return null;
  const meaningfulItems = snapshot.items.filter(
    (item) => item.metrics.currentValue > 0 || item.metrics.investment > 0
  );
  if (!meaningfulItems.length) return null;

  const sorted = [...meaningfulItems].sort((a, b) =>
    (b.metrics.currentValue || b.metrics.investment) - (a.metrics.currentValue || a.metrics.investment)
  );
  const top = sorted.slice(0, 8);
  const othersValue = sorted.slice(8).reduce((s, i) => s + (i.metrics.currentValue || i.metrics.investment), 0);

  const labels = top.map(i => sanitizePdfText(assetDisplayName(i.row)));
  const data = top.map(i => i.metrics.currentValue || i.metrics.investment);
  if (othersValue > 0) {
    labels.push(sanitizePdfText(t("charts.others")));
    data.push(othersValue);
  }

  const colors = ["#0ea5e9","#22d3ee","#a78bfa","#f472b6","#fb923c","#facc15","#4ade80","#f87171","#94a3b8"];

  const canvas = document.createElement("canvas");
  canvas.width = 440;
  canvas.height = 440;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const chart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, data.length), borderWidth: 2, borderColor: "#ffffff" }] },
    options: {
      animation: false, responsive: false, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "bottom", labels: { font: { size: 11 }, color: "#334155", padding: 8 } },
        tooltip: { enabled: false }
      },
      layout: { padding: 10 }
    }
  });
  chart.update("none");
  const image = canvas.toDataURL("image/png", 1);
  chart.destroy();
  return image;
}

let pdfBuilding = false;
// mode: "download" guarda el fichero; "share" lo entrega a la hoja de
// compartir del sistema y solo descarga si el dispositivo no la admite.
async function handleDownloadPdf(mode = "download") {
  if (pdfBuilding) return;
  const snapshot = buildSnapshot();
  const meaningfulItems = snapshot.items.filter(
    (item) => item.metrics.investment > 0 || item.metrics.currentValue > 0 || item.metrics.tokens > 0
  );

  if (!meaningfulItems.length) {
    showToast(t("pdf.noDataTitle"), t("pdf.noDataText"), "warning");
    return;
  }

  pdfBuilding = true;
  setLoader(true, t("loader.syncMarket"));
  let jsPdfApi;
  try {
    jsPdfApi = await ensureJsPdf();
  } catch {
    jsPdfApi = null;
  }
  if (!jsPdfApi) {
    pdfBuilding = false;
    setLoader(false);
    showToast(t("pdf.exportErrorTitle"), t("pdf.exportErrorText"), "negative");
    return;
  }

  // El gráfico de distribución es opcional: si Chart.js no carga, el PDF sale sin él.
  let pieImage = null;
  try {
    await ensureChartJs();
    pieImage = buildPdfPieChartImage(snapshot);
  } catch {
    pieImage = null;
  }

  try {
    const doc = new jsPdfApi({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    const now = new Date();
    const portfolioName = getPortfolioName();
    const totalPnl = snapshot.totals.currentValue - snapshot.totals.investment;
    const totalReturn = snapshot.totals.investment
      ? (totalPnl / snapshot.totals.investment) * 100
      : 0;
    const weightBase = snapshot.totals.currentValue > 0 ? snapshot.totals.currentValue : snapshot.totals.investment;
    // El PDF respeta el mismo orden que la tabla en pantalla (columna de
    // orden activa, dirección y fijados), igual que la ve el usuario.
    const tableOrder = new Map(getSortedRows().map((row, index) => [row.id, index]));
    const pdfRows = [...meaningfulItems].sort(
      (a, b) =>
        (tableOrder.get(a.row.id) ?? Number.MAX_SAFE_INTEGER) -
        (tableOrder.get(b.row.id) ?? Number.MAX_SAFE_INTEGER)
    );
    const generatedAt = formatGeneratedDate(now);
    let pageNum = 1;

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    /* ── HEADER ── */
    let y = 16;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(16);
    doc.text("Crypto Portfolio Pro", margin, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(`${t("pdf.generatedAt", { date: generatedAt })}  |  ${portfolioName}`),
      pageWidth - margin, y, { align: "right" }
    );

    y += 3;
    drawPdfGradientLine(doc, margin, y, contentWidth);
    y += 6;

    /* ── KPI CARDS (3 columns x 2 rows) ── */
    const bestAsset = snapshot.bestAsset;
    const worstAsset = snapshot.worstAsset;
    const bestAssetLabel = bestAsset
      ? `${sanitizePdfText(assetDisplayName(bestAsset.row))} ${formatPercent(bestAsset.metrics.pnlPct)}`
      : "--";
    const worstAssetLabel = worstAsset
      ? `${sanitizePdfText(assetDisplayName(worstAsset.row))} ${formatPercent(worstAsset.metrics.pnlPct)}`
      : "--";
    const pnlColor = totalPnl > 0 ? [22, 101, 52] : totalPnl < 0 ? [153, 27, 27] : [15, 23, 42];
    const worstColor = worstAsset && worstAsset.metrics.pnlPct < 0 ? [153, 27, 27] : [15, 23, 42];
    const cardGap = 3;
    const cardCols = 3;
    const cardWidth = (contentWidth - cardGap * (cardCols - 1)) / cardCols;
    const cardHeight = 17;

    const cards = [
      { label: t("pdf.totalInvestment"), value: formatCurrency(snapshot.totals.investment), color: [15, 23, 42] },
      { label: t("pdf.totalValue"), value: formatCurrency(snapshot.totals.currentValue), color: [15, 23, 42] },
      { label: t("pdf.totalReturn"), value: `${formatSignedCurrency(totalPnl)} (${formatPercent(totalReturn)})`, color: pnlColor },
      { label: t("pdf.bestAsset") || "Best", value: bestAssetLabel, color: [22, 101, 52] },
      { label: t("pdf.worstAsset") || "Worst", value: worstAssetLabel, color: worstColor },
      { label: t("pdf.assetCount"), value: String(meaningfulItems.length), color: [15, 23, 42] }
    ];

    cards.forEach((card, index) => {
      const col = index % cardCols;
      const row = Math.floor(index / cardCols);
      const x = margin + col * (cardWidth + cardGap);
      const cardY = y + row * (cardHeight + cardGap);
      drawPdfKpiCard(doc, x, cardY, cardWidth, cardHeight, card.label, card.value, card.color);
    });

    y += (cardHeight + cardGap) * 2 + 3;

    /* ── PIE CHART INLINE (next to a small summary) ── */
    if (pieImage) {
      const chartSize = 52;
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, contentWidth, chartSize + 6, 3, 3, "FD");

      const pieTitle = sanitizePdfText(t("charts.portfolioDistribution"));
      const topItems = pdfRows.slice(0, 6);
      const infoLines = topItems.map((item) => {
        const weight = weightBase > 0 ? (item.metrics.currentValue / weightBase) * 100 : 0;
        return `${sanitizePdfText(assetDisplayName(item.row))}: ${formatCurrency(item.metrics.currentValue)} (${weight.toFixed(1)}%)`;
      });
      if (pdfRows.length > 6) {
        infoLines.push(`+ ${pdfRows.length - 6} more...`);
      }

      // Mide el bloque (dona + desglose) para centrarlo en la tarjeta.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const titleWidth = doc.getTextWidth(pieTitle);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const infoWidth = Math.max(titleWidth, ...infoLines.map((line) => doc.getTextWidth(line)));
      const groupWidth = chartSize + 10 + infoWidth;
      const startX = margin + Math.max(3, (contentWidth - groupWidth) / 2);

      doc.addImage(pieImage, "PNG", startX, y + 3, chartSize, chartSize, undefined, "FAST");

      const infoX = startX + chartSize + 10;
      let infoY = y + 8;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      doc.text(pieTitle, infoX, infoY);

      infoY += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      infoLines.forEach((line) => {
        doc.text(line, infoX, infoY);
        infoY += 4.5;
      });

      y += chartSize + 10;
    }

    /* ── TABLE HEADER ── */
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(10);
    doc.text(sanitizePdfText(t("pdf.positionsTable")), margin, y);
    y += 4;

    /* ── TABLE ── */
    const bodyRows = pdfRows.map((item) => {
      const weight = weightBase > 0 ? (item.metrics.currentValue / weightBase) * 100 : 0;
      return [
        sanitizePdfText(assetDisplayName(item.row) || "--"),
        sanitizePdfText(formatCurrency(item.metrics.investment)),
        sanitizePdfText(formatNumber(item.metrics.tokens, item.metrics.tokens >= 1 ? 4 : 8)),
        sanitizePdfText(
          item.metrics.entryPrice > 0
            ? formatCurrency(item.metrics.entryPrice, getPriceDigits(item.metrics.entryPrice))
            : "--"
        ),
        sanitizePdfText(
          item.metrics.currentPrice > 0
            ? formatCurrency(item.metrics.currentPrice, getPriceDigits(item.metrics.currentPrice))
            : "--"
        ),
        sanitizePdfText(formatSignedCurrency(item.metrics.pnlUsd)),
        sanitizePdfText(formatPercent(item.metrics.pnlPct)),
        sanitizePdfText(formatPercent(weight).replace("+", ""))
      ];
    });

    const totalsRow = [
      sanitizePdfText(t("table.totals")),
      sanitizePdfText(formatCurrency(snapshot.totals.investment)),
      "",
      "",
      "",
      sanitizePdfText(formatSignedCurrency(totalPnl)),
      sanitizePdfText(formatPercent(totalReturn)),
      "100%"
    ];

    doc.autoTable({
      startY: y,
      margin: { top: 30, right: margin, bottom: 18, left: margin },
      theme: "plain",
      showHead: "everyPage",
      styles: {
        font: "helvetica",
        fontSize: 7,
        textColor: [15, 23, 42],
        cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
        overflow: "linebreak",
        lineColor: [226, 232, 240],
        lineWidth: 0
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        halign: "center",
        lineWidth: 0
      },
      alternateRowStyles: {
        fillColor: [248, 249, 250]
      },
      columnStyles: {
        // La columna de activo queda en auto para absorber el ancho restante;
        // con las 8 columnas fijas autotable avisaba "width could not fit page".
        0: { halign: "left", fontStyle: "bold" },
        1: { cellWidth: 22, halign: "right" },
        2: { cellWidth: 18, halign: "right" },
        3: { cellWidth: 22, halign: "right" },
        4: { cellWidth: 22, halign: "right" },
        5: { cellWidth: 24, halign: "right" },
        6: { cellWidth: 20, halign: "right" },
        7: { cellWidth: 16, halign: "right" }
      },
      head: [[
        sanitizePdfText(t("pdf.asset")),
        sanitizePdfText(t("pdf.investment")),
        sanitizePdfText(t("pdf.amount")),
        sanitizePdfText(t("pdf.avgEntryPrice")),
        sanitizePdfText(t("pdf.currentPrice")),
        "PnL",
        "%",
        sanitizePdfText(t("pdf.weight"))
      ]],
      body: [...bodyRows, totalsRow],
      didParseCell: (data) => {
        if (data.section === "body") {
          const isLastRow = data.row.index === bodyRows.length;

          if (isLastRow) {
            data.cell.styles.fillColor = [15, 23, 42];
            data.cell.styles.textColor = [255, 255, 255];
            data.cell.styles.fontStyle = "bold";
          } else {
            if (data.column.index === 5 || data.column.index === 6) {
              const rowMetrics = pdfRows[data.row.index]?.metrics;
              if (rowMetrics) {
                if (rowMetrics.pnlUsd > 0) {
                  data.cell.styles.textColor = [22, 101, 52];
                } else if (rowMetrics.pnlUsd < 0) {
                  data.cell.styles.textColor = [153, 27, 27];
                }
              }
            }
          }

          if (!isLastRow) {
            data.cell.styles.lineWidth = { bottom: 0.15, top: 0, left: 0, right: 0 };
            data.cell.styles.lineColor = [226, 232, 240];
          }
        }
      },
      didDrawPage: () => {
        doc.setFillColor(255, 255, 255);

        if (doc.internal.getCurrentPageInfo().pageNumber > 1) {
          let hy = 14;
          doc.setFont("helvetica", "bold");
          doc.setTextColor(15, 23, 42);
          doc.setFontSize(10);
          doc.text("Crypto Portfolio Pro", margin, hy);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          doc.text(sanitizePdfText(portfolioName), pageWidth - margin, hy, { align: "right" });
          hy += 2.5;
          drawPdfGradientLine(doc, margin, hy, contentWidth);
        }

        pageNum++;
        drawPdfFooter(doc, pageWidth, pageHeight, margin, doc.internal.getCurrentPageInfo().pageNumber);
      }
    });

    drawPdfFooter(doc, pageWidth, pageHeight, margin, 1);

    const pdfName = `portfolio-resumen-${sanitizeFilenamePart(portfolioName)}-${formatFileDate(now)}.pdf`;
    if (mode === "share") {
      const shared = await sharePdfFile(doc, pdfName, portfolioName);
      if (!shared) {
        showToast(t("pdf.shareFallbackTitle"), t("pdf.shareFallbackText"), "warning");
        doc.save(pdfName);
      }
    } else {
      doc.save(pdfName);
    }
  } catch (error) {
    showToast(t("pdf.exportErrorTitle"), t("pdf.exportErrorText"), "negative");
  } finally {
    pdfBuilding = false;
    setLoader(false);
  }
}

// Web Share API nivel 2: manda el PDF como fichero a la hoja del sistema,
// sin pasar por la carpeta de descargas. Devuelve false cuando el navegador
// no admite compartir ficheros (escritorio, Firefox) o cuando la llamada
// se rechaza porque el gesto del usuario ya caduco mientras se generaba el
// informe; en ambos casos quien llama cae a la descarga de siempre.
async function sharePdfFile(doc, filename, portfolioName) {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }
  if (typeof navigator.canShare !== "function" || typeof File !== "function") {
    return false;
  }

  let file;
  try {
    file = new File([doc.output("blob")], filename, { type: "application/pdf" });
  } catch {
    return false;
  }
  if (!navigator.canShare({ files: [file] })) {
    return false;
  }

  try {
    await navigator.share({ files: [file], title: portfolioName });
    return true;
  } catch (error) {
    // Cancelar la hoja es una decision del usuario: no se descarga nada.
    return error?.name === "AbortError";
  }
}

async function handleImportCsv(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const records = parseCsv(text);
    if (!records.length) {
      throw new Error(t("alerts.importFailedText"));
    }

    state.rows = records.map((record) => createRow({
      crypto: record.crypto || record.symbol || "",
      coinId: record.coinId || "",
      resolvedName: record.resolvedName || "",
      symbol: record.symbol || "",
      investment: record.investment || "",
      tokens: record.tokens || "",
      entryPrice: record.entryPrice || "",
      tp1: record.tp1 || "",
      tp2: record.tp2 || "",
      tp3: record.tp3 || "",
      favorite: record.favorite === "true",
      pinned: record.pinned === "true",
      derivedField: record.derivedField || "",
      note: record.note || "",
      purchaseDate: record.purchaseDate || "",
      personalLabel: record.personalLabel || ""
    }));

    renderAll();
    scheduleAutosave();
    pushActivity(
      t("alerts.importTitle"),
      t("alerts.importText", { count: state.rows.length, file: file.name }),
      "positive"
    );
    showToast(t("alerts.importDoneTitle"), t("alerts.importDoneText", { count: state.rows.length }), "positive");
    await refreshAllPrices({ silentWhenEmpty: true, force: true, reason: "import" });
  } catch (error) {
    showToast(t("alerts.importFailedTitle"), error.message || t("alerts.importFailedText"), "negative");
  }
}
