import * as pdfjsLib from "/vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";

const FIELD_LABELS = {
  invoiceNumber: "Invoice number",
  invoiceDate: "Invoice date",
  customerName: "Customer name",
  customerPhone: "Customer phone",
  customerEmail: "Customer email",
  orderRef: "Order reference",
  orderType: "Order type",
  pickupTime: "Pickup time",
  subtotal: "Subtotal",
  discount: "Discount",
  parcelCharge: "Parcel charge",
  cgst: "CGST",
  sgst: "SGST",
  total: "Final total",
  amountInWords: "Amount in words",
  paymentReference: "Payment reference",
  sellerNote: "Seller note",
  termsText: "Terms",
  sampleWatermark: "Sample watermark",
};

const configEl = document.getElementById("billing-config");
if (configEl) {
  init(JSON.parse(configEl.textContent));
}

function init(config) {
  const canvas = document.getElementById("billing-canvas");
  const overlay = document.getElementById("billing-overlay");
  const modeEl = document.getElementById("billing-mode");
  const feedback = document.getElementById("billing-feedback");
  const fieldList = document.getElementById("billing-field-list");
  const tableInfo = document.getElementById("billing-table-info");

  const state = {
    page: 0,
    scale: 1,
    viewport: null,
    pdfPage: null,
    mode: null,
    mapping: config.mapping || null,
    selectedField: null,
    errorField: null,
  };

  const setFeedback = (text, kind) => {
    if (!feedback) return;
    feedback.hidden = false;
    feedback.className = `billing-status billing-status--${kind || "ok"}`;
    feedback.textContent = text;
  };

  const pageSize = () => config.pageSizes[state.page] || { width: 595, height: 842 };

  // Controls are conditional (the Activate button disappears once the version
  // is frozen), so binding must never assume an element exists.
  function bind(id, type, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(type, handler);
    return el;
  }

  async function loadPdf() {
    const response = await fetch(config.fileUrl, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load the template PDF.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    return pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  }

  function ensureMappingDefaults() {
    if (!state.mapping) {
      state.mapping = {
        schemaVersion: 1,
        page: 0,
        taxMode: "none",
        cgstRateBp: 0,
        sgstRateBp: 0,
        constants: { sellerNote: "", termsText: "" },
        fields: {},
        itemTable: null,
        continuationTotals: null,
      };
    }
    if (!state.mapping.fields) state.mapping.fields = {};
    return state.mapping;
  }

  function pixelsToPdf(event) {
    const rect = canvas.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    const viewport = state.viewport;
    const vx = (cssX / rect.width) * viewport.width;
    const vy = (cssY / rect.height) * viewport.height;
    const [px, py] = viewport.convertToPdfPoint(vx, vy);
    return { x: Number(px.toFixed(3)), y: Number(py.toFixed(3)) };
  }

  function pdfToOverlay(point) {
    const viewport = state.viewport;
    const [vx, vy] = viewport.convertToViewportPoint(point.x, point.y);
    const rect = canvas.getBoundingClientRect();
    return { x: (vx / viewport.width) * rect.width, y: (vy / viewport.height) * rect.height };
  }

  function drawOverlay() {
    const ctx = overlay.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    overlay.width = rect.width * window.devicePixelRatio;
    overlay.height = rect.height * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const mapping = state.mapping;
    if (!mapping) return;

    ctx.font = "11px sans-serif";
    ctx.textBaseline = "alphabetic";

    for (const [key, field] of Object.entries(mapping.fields || {})) {
      const point = pdfToOverlay({ x: field.x, y: field.y });
      const selected = key === state.selectedField;
      ctx.strokeStyle = selected ? "rgba(255,107,0,1)" : "rgba(255,107,0,0.9)";
      ctx.fillStyle = "rgba(255,107,0,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(point.x - 4, point.y);
      ctx.lineTo(point.x + 4, point.y);
      ctx.stroke();
      ctx.fillText(FIELD_LABELS[key] || key, point.x + 6, point.y - 3);

      // Show the configured text box so the vendor can see the Max width and
      // the lines a wrapped value may use.
      if (selected && state.viewport) {
        const boxWidth = (field.maxWidth / state.viewport.width) * rect.width;
        const lineHeight = (field.lineHeight / state.viewport.height) * rect.height;
        const boxX =
          field.align === "right"
            ? point.x - boxWidth
            : field.align === "center"
              ? point.x - boxWidth / 2
              : point.x;
        ctx.strokeStyle = "rgba(255,107,0,0.45)";
        ctx.strokeRect(
          boxX,
          point.y - lineHeight * 0.85,
          boxWidth,
          Math.max(lineHeight * field.maxLines, 4),
        );
      }
    }

    if (mapping.itemTable) {
      const start = pdfToOverlay({ x: mapping.itemTable.originX, y: mapping.itemTable.originY });
      const rows = mapping.itemTable.maxRowsFirstPage;
      const rowHeightPx =
        (mapping.itemTable.rowHeight / state.viewport.height) * rect.height;
      const widthPx =
        ((pageSize().width - mapping.itemTable.originX - 24) / state.viewport.width) *
        rect.width;
      ctx.strokeStyle = "rgba(34,197,94,0.9)";
      ctx.strokeRect(start.x, start.y, Math.max(20, widthPx), rowHeightPx * rows);
    }
  }

  function fieldSummary(key, field) {
    const lines = field.maxLines === 1 ? "1 line" : `${field.maxLines} lines`;
    return `${FIELD_LABELS[key] || key} · ${field.fontSize} pt · Max ${Math.round(
      field.maxWidth,
    )} pt · ${lines}`;
  }

  function renderFieldList() {
    if (!fieldList) return;
    fieldList.innerHTML = "";
    const mapping = state.mapping;
    if (!mapping) return;
    const entries = Object.entries(mapping.fields || {});
    if (!entries.length) {
      const li = document.createElement("li");
      li.textContent = "No fields placed yet.";
      fieldList.appendChild(li);
    }
    for (const [key, field] of entries) {
      const li = document.createElement("li");
      if (key === state.selectedField) li.classList.add("is-selected");
      if (key === state.errorField) li.classList.add("is-error");

      const select = document.createElement("button");
      select.type = "button";
      select.className = "billing-field-button";
      select.textContent = fieldSummary(key, field);
      select.addEventListener("click", () => selectField(key));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--small btn--ghost";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        delete mapping.fields[key];
        if (state.selectedField === key) state.selectedField = null;
        if (state.errorField === key) state.errorField = null;
        renderFieldList();
        drawOverlay();
      });
      li.appendChild(select);
      li.appendChild(remove);
      fieldList.appendChild(li);
    }

    if (tableInfo) {
      tableInfo.textContent = mapping.itemTable
        ? `Table at ${mapping.itemTable.originX.toFixed(0)}, ${mapping.itemTable.originY.toFixed(0)} · ${mapping.itemTable.maxRowsFirstPage} rows`
        : "No item table placed.";
    }
  }

  function rowLineCapacity(rowHeight, fontSize) {
    return Math.max(1, Math.floor((Number(rowHeight) + 0.001) / (Number(fontSize) * 1.2)));
  }

  function buildColumns(originX, rowHeight) {
    const width = pageSize().width;
    const available = Math.max(180, width - originX - 36);
    const descW = Math.round(available * 0.46);
    const qtyW = Math.round(available * 0.12);
    const rateW = Math.round(available * 0.2);
    const amountW = available - descW - qtyW - rateW;
    const descLines = Math.min(2, rowLineCapacity(rowHeight, 9));
    return [
      { key: "description", x: originX, width: descW, align: "left", fontSize: 9, maxLines: descLines },
      { key: "quantity", x: originX + descW, width: qtyW, align: "center", fontSize: 9, maxLines: 1 },
      { key: "unitRate", x: originX + descW + qtyW, width: rateW, align: "right", fontSize: 9, maxLines: 1 },
      {
        key: "lineAmount",
        x: originX + descW + qtyW + rateW,
        width: amountW,
        align: "right",
        fontSize: 9,
        maxLines: 1,
      },
    ];
  }

  function copyTotalsForContinuation(mapping) {
    const keys = ["subtotal", "discount", "parcelCharge", "cgst", "sgst", "total", "amountInWords"];
    const totals = {};
    for (const key of keys) {
      if (mapping.fields[key]) totals[key] = { ...mapping.fields[key] };
    }
    return Object.keys(totals).length ? totals : null;
  }

  // Anchored text needs room in the direction it grows: a right-aligned field
  // at x can only use the space to its left, a centered field half the
  // available width on each side. Computing this as `pageWidth - x` gave
  // right-margin fields a ~24pt budget and made every value overflow.
  function fitWidth(requested, x, align, pageWidth) {
    const leftRoom = Math.max(10, x - 24);
    const rightRoom = Math.max(10, pageWidth - x - 24);
    const room =
      align === "right"
        ? leftRoom
        : align === "center"
          ? Math.max(10, Math.min(leftRoom, rightRoom) * 2)
          : rightRoom;
    return Math.round(Math.max(10, Math.min(requested, room)) * 1000) / 1000;
  }

  function defaultFields(width, height) {
    return {
      invoiceNumber: { x: width - 48, y: height - 96, align: "right", fontSize: 10, font: "bold", maxWidth: 160, maxLines: 1 },
      invoiceDate: { x: width - 48, y: height - 114, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
      customerName: { x: 48, y: height - 150, align: "left", fontSize: 10, font: "medium", maxWidth: 220, maxLines: 1 },
      subtotal: { x: width - 48, y: 260, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
      discount: { x: width - 48, y: 244, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
      parcelCharge: { x: width - 48, y: 228, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
      total: { x: width - 48, y: 200, align: "right", fontSize: 12, font: "bold", maxWidth: 160, maxLines: 1 },
      amountInWords: { x: 48, y: 160, align: "left", fontSize: 9, font: "regular", maxWidth: width - 96, maxLines: 3 },
    };
  }

  /**
   * A box narrower than four characters cannot print any value, so those saved
   * widths are unusable: they come from the old anchor math that gave
   * right-margin fields a ~24 pt budget. Widen them to the field's default and
   * report it, rather than failing every sample with no way to tell which field
   * is wrong.
   */
  function repairFieldWidths() {
    const mapping = state.mapping;
    if (!mapping || !mapping.fields) return [];
    const { width } = pageSize();
    const defaults = defaultFields(width, pageSize().height);
    const repaired = [];
    for (const [key, field] of Object.entries(mapping.fields)) {
      const floor = Number(field.fontSize) * 4;
      if (!(Number(field.maxWidth) >= floor)) {
        const target = defaults[key]?.maxWidth || 160;
        field.maxWidth = fitWidth(target, field.x, field.align, width);
        repaired.push(key);
      }
      if (!(Number(field.lineHeight) >= Number(field.fontSize))) {
        field.lineHeight = Math.round(Number(field.fontSize) * 1.25 * 1000) / 1000;
      }
    }
    return repaired;
  }

  function syncControls(field) {
    const align = document.getElementById("billing-align");
    const fontSize = document.getElementById("billing-fontsize");
    const maxWidth = document.getElementById("billing-maxwidth");
    const maxLines = document.getElementById("billing-maxlines");
    const select = document.getElementById("billing-field-select");
    if (align) align.value = field.align || "left";
    if (fontSize) fontSize.value = field.fontSize;
    if (maxWidth) maxWidth.value = Math.round(field.maxWidth);
    if (maxLines) maxLines.value = field.maxLines;
    if (select && state.selectedField && select.querySelector(`option[value="${state.selectedField}"]`)) {
      select.value = state.selectedField;
    }
  }

  function selectField(key) {
    const field = state.mapping?.fields?.[key];
    if (!field) return;
    state.selectedField = key;
    syncControls(field);
    renderFieldList();
    drawOverlay();
  }

  // Editing an already-placed field updates that field directly, so changing
  // Max width / Max lines does not require re-placing it and never resets the
  // other configured values.
  function applyControls() {
    const key = state.selectedField;
    const field = state.mapping?.fields?.[key];
    if (!field) return;
    const { width } = pageSize();
    const alignEl = document.getElementById("billing-align");
    const sizeEl = document.getElementById("billing-fontsize");
    const widthEl = document.getElementById("billing-maxwidth");
    const linesEl = document.getElementById("billing-maxlines");
    const align = alignEl?.value || field.align;
    const fontSize = Number(sizeEl?.value) || field.fontSize;
    const requested = Number(widthEl?.value) || field.maxWidth;
    const maxLines = Math.max(
      1,
      Math.min(5, Math.round(Number(linesEl?.value) || field.maxLines)),
    );
    field.align = align;
    field.fontSize = fontSize;
    field.lineHeight = Math.round(fontSize * 1.25 * 1000) / 1000;
    field.maxWidth = fitWidth(requested, field.x, align, width);
    field.maxLines = maxLines;
    if (state.errorField === key) state.errorField = null;
    renderFieldList();
    drawOverlay();
  }

  function showError(payload, fallback) {
    setFeedback(payload?.error || fallback, "err");
    const field = payload?.details?.field || null;
    state.errorField = field;
    if (field && state.mapping?.fields?.[field]) {
      state.selectedField = field;
      syncControls(state.mapping.fields[field]);
    }
    renderFieldList();
    if (field) {
      fieldList?.querySelector("li.is-error")?.scrollIntoView({ block: "nearest" });
    }
  }

  function applyDefaultPositions() {
    const mapping = ensureMappingDefaults();
    const { width, height } = pageSize();
    const defaults = defaultFields(width, height);
    for (const [key, value] of Object.entries(defaults)) {
      if (!mapping.fields[key]) {
        mapping.fields[key] = {
          ...value,
          maxWidth: fitWidth(value.maxWidth, value.x, value.align, width),
          lineHeight: Math.round(value.fontSize * 1.25 * 1000) / 1000,
        };
      }
    }
    repairFieldWidths();
    if (!mapping.itemTable) {
      const rowHeight = 22;
      mapping.itemTable = {
        originX: 48,
        originY: height - 300,
        rowHeight,
        maxRowsFirstPage: 10,
        baselineOffsetFromRowTop: 11,
        columns: buildColumns(48, rowHeight),
        continuation: { originY: height - 110, bottomMargin: 60, showPageNumbers: true },
      };
    }
    if (!mapping.continuationTotals) {
      mapping.continuationTotals = copyTotalsForContinuation(mapping);
    }
    const rowHeightInput = document.getElementById("billing-rowheight");
    const maxRowsInput = document.getElementById("billing-maxrows");
    if (rowHeightInput) rowHeightInput.value = mapping.itemTable.rowHeight;
    if (maxRowsInput) maxRowsInput.value = mapping.itemTable.maxRowsFirstPage;

    renderFieldList();
    drawOverlay();
    setFeedback("Default positions applied. Adjust them, save, then generate a sample.", "warn");
  }

  async function saveMapping({ silent } = {}) {
    const mapping = ensureMappingDefaults();
    const wasFrozen = config.mappingFrozen;
    config.mappingFrozen = false; // allow saving a draft only

    const table = mapping.itemTable;
    if (table) {
      table.rowHeight =
        Number(document.getElementById("billing-rowheight").value) || table.rowHeight;
      table.maxRowsFirstPage =
        Number(document.getElementById("billing-maxrows").value) || table.maxRowsFirstPage;
    }
    if (table && !mapping.continuationTotals) {
      mapping.continuationTotals = copyTotalsForContinuation(mapping);
    }

    const response = await fetch(config.saveUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ versionId: config.versionId, mapping }),
    });
    config.mappingFrozen = wasFrozen;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      showError(payload, "Could not save the field positions.");
      return null;
    }
    if (!silent) setFeedback("Field positions saved.", "ok");
    return payload;
  }

  async function post(url) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ versionId: config.versionId }),
    });
    return response.json().catch(() => ({}));
  }

  canvas.addEventListener("click", (event) => {
    if (!state.mode) {
      setFeedback("Choose a placement mode first.", "warn");
      return;
    }
    const point = pixelsToPdf(event);
    const mapping = ensureMappingDefaults();

    if (state.mode === "field") {
      const select = document.getElementById("billing-field-select");
      const key = select.value;
      if (!key) {
        setFeedback("Choose a field to place.", "warn");
        return;
      }
      const size = pageSize();
      const align = document.getElementById("billing-align").value;
      const fontSize = Number(document.getElementById("billing-fontsize").value) || 10;
      const requested = Number(document.getElementById("billing-maxwidth").value) || 160;
      const maxLines = Math.max(
        1,
        Math.min(5, Number(document.getElementById("billing-maxlines").value) || 1),
      );
      mapping.fields[key] = {
        x: point.x,
        y: point.y,
        align,
        fontSize,
        font:
          mapping.fields[key]?.font ||
          (key === "total" || key === "invoiceNumber" ? "bold" : "regular"),
        maxWidth: fitWidth(requested, point.x, align, size.width),
        maxLines,
        lineHeight: Math.round(fontSize * 1.25 * 1000) / 1000,
        truncate: false,
      };
      state.selectedField = key;
      state.errorField = null;
      syncControls(mapping.fields[key]);
      state.mode = null;
      modeEl.textContent = "No placement mode selected.";
      renderFieldList();
      drawOverlay();
      setFeedback(`Placed ${FIELD_LABELS[key] || key}.`, "ok");
      return;
    }

    if (state.mode === "table") {
      const rowHeight = Number(document.getElementById("billing-rowheight").value) || 22;
      mapping.itemTable = {
        originX: point.x,
        originY: point.y,
        rowHeight,
        maxRowsFirstPage: Number(document.getElementById("billing-maxrows").value) || 10,
        baselineOffsetFromRowTop: 11,
        columns: buildColumns(point.x, rowHeight),
        continuation: { originY: pageSize().height - 110, bottomMargin: 60, showPageNumbers: true },
      };
      if (!mapping.continuationTotals) {
        mapping.continuationTotals = copyTotalsForContinuation(mapping);
      }
      if (state.page !== (mapping.page || 0)) mapping.page = state.page;
      state.mode = null;
      modeEl.textContent = "No placement mode selected.";
      renderFieldList();
      drawOverlay();
      setFeedback("Item table placed.", "ok");
    }
  });

  bind("billing-mode-field", "click", () => {
    state.mode = "field";
    modeEl.textContent = "Click the PDF where the selected field's baseline should sit.";
  });
  bind("billing-mode-table", "click", () => {
    state.mode = "table";
    modeEl.textContent = "Click the PDF at the top-left corner of the first item row.";
  });
  bind("billing-defaults", "click", applyDefaultPositions);
  bind("billing-save", "click", () => saveMapping());
  bind("billing-preview", "click", async () => {
    const saved = await saveMapping({ silent: true });
    if (!saved) return;
    const result = await post(config.previewUrl);
    if (!result.ok) {
      showError(result, "Could not generate the sample invoice.");
      return;
    }
    state.errorField = null;
    renderFieldList();
    setFeedback("Sample invoice generated. Opening it in a new tab.", "ok");
    window.open(result.sampleUrl || config.sampleUrl, "_blank", "noopener");
  });
  bind("billing-activate", "click", async () => {
    const saved = await saveMapping({ silent: true });
    if (!saved) return;
    const result = await post(config.activateUrl);
    if (!result.ok) {
      showError(result, "Could not activate the template.");
      return;
    }
    setFeedback("Template activated. Invoices will use your design.", "ok");
    setTimeout(() => window.location.reload(), 800);
  });

  // Row height decides how many text lines a cell can hold, so keep the column
  // budgets in step instead of letting them print across the next row.
  bind("billing-rowheight", "change", () => {
    const mapping = ensureMappingDefaults();
    if (!mapping.itemTable) return;
    const input = document.getElementById("billing-rowheight");
    const rowHeight = Math.max(8, Math.min(60, Number(input.value) || mapping.itemTable.rowHeight));
    input.value = rowHeight;
    mapping.itemTable.rowHeight = rowHeight;
    mapping.itemTable.baselineOffsetFromRowTop = Math.min(
      mapping.itemTable.baselineOffsetFromRowTop,
      rowHeight,
    );
    for (const column of mapping.itemTable.columns) {
      column.maxLines = Math.min(
        column.maxLines,
        rowLineCapacity(rowHeight, column.fontSize),
      );
    }
    renderFieldList();
    drawOverlay();
  });

  for (const id of ["billing-align", "billing-fontsize", "billing-maxwidth", "billing-maxlines"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", applyControls);
    el.addEventListener("change", applyControls);
  }

  bind("billing-field-select", "change", () => {
    const select = document.getElementById("billing-field-select");
    if (select.value && state.mapping?.fields?.[select.value]) {
      selectField(select.value);
      return;
    }
    state.selectedField = null;
    renderFieldList();
    drawOverlay();
  });

  (async () => {
    try {
      const pdf = await loadPdf();
      state.pdfPage = await pdf.getPage((state.mapping?.page || 0) + 1);
      const container = document.getElementById("billing-canvas-stack");
      const baseViewport = state.pdfPage.getViewport({ scale: 1 });
      const targetWidth = Math.max(280, container.clientWidth || 520);
      state.scale = targetWidth / baseViewport.width;
      state.viewport = state.pdfPage.getViewport({ scale: state.scale });
      canvas.width = state.viewport.width;
      canvas.height = state.viewport.height;
      await state.pdfPage.render({
        canvasContext: canvas.getContext("2d"),
        viewport: state.viewport,
      }).promise;

      const repaired = config.mappingFrozen ? [] : repairFieldWidths();
      renderFieldList();
      drawOverlay();

      if (repaired.length) {
        const names = repaired.map((key) => FIELD_LABELS[key] || key).join(", ");
        setFeedback(
          `Widened fields that were too narrow to print any value: ${names}. Review them, then save to keep the fix.`,
          "warn",
        );
      } else if (config.mappingFrozen) {
        const tooNarrow = Object.entries(state.mapping?.fields || {})
          .filter(([, field]) => !(Number(field.maxWidth) >= Number(field.fontSize) * 4))
          .map(([key]) => FIELD_LABELS[key] || key);
        if (tooNarrow.length) {
          setFeedback(
            `${tooNarrow.join(", ")}: the saved Max width is too small to print a value. Upload this PDF again to create a new version and correct the positions.`,
            "err",
          );
        }
      }
    } catch (error) {
      setFeedback(error.message || "Could not preview the PDF.", "err");
    }
  })();

  window.addEventListener("resize", () => {
    if (!state.viewport) return;
    drawOverlay();
  });
}
