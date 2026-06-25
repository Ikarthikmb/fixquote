// ── Repair Estimator – Full Page ──────────────────────────────────────────────

let parts       = [];
let labourRates = {};
let dragSrcIdx  = null;

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

// ── Brand classification ───────────────────────────────────────────────────────
const BRANDS = [
  { name: "Apple",    icon: "🍎", kw: ["iphone","ipad","macbook","apple","ipod","airpod","imac"] },
  { name: "Samsung",  icon: "🌀", kw: ["samsung","galaxy"] },
  { name: "Google",   icon: "🔵", kw: ["google","pixel"] },
  { name: "OnePlus",  icon: "➕", kw: ["oneplus"] },
  { name: "Motorola", icon: "〽️", kw: ["motorola","moto"] },
  { name: "LG",       icon: "🔲", kw: ["lg"] },
  { name: "Huawei",   icon: "📡", kw: ["huawei","honor"] },
  { name: "Sony",     icon: "🎮", kw: ["sony","xperia"] },
  { name: "Nokia",    icon: "📻", kw: ["nokia"] },
];

function getBrand(name) {
  const l = (name || "").toLowerCase();
  for (const b of BRANDS) if (b.kw.some(k => l.includes(k))) return b;
  return { name: "Other", icon: "📦", kw: [] };
}

const DICONS = { iphone:"📱",ipad:"🖥",macbook:"💻",samsung:"📱",galaxy:"📱",
  pixel:"📱",oneplus:"📱",lg:"📱",motorola:"📱",huawei:"📱",sony:"📱",nokia:"📱" };

function dIcon(name) {
  const l = (name || "").toLowerCase();
  for (const [k, v] of Object.entries(DICONS)) if (l.includes(k)) return v;
  return "📦";
}

// ── Load ───────────────────────────────────────────────────────────────────────
function loadAll() {
  chrome.storage.local.get(
    ["estimateParts","labourRates","shippingCost","taxRate","markupPct","currentJob"],
    (res) => {
      parts       = res.estimateParts || [];
      labourRates = res.labourRates   || {};
      document.getElementById("shippingInput").value = res.shippingCost ?? 0;
      document.getElementById("taxRate").value        = res.taxRate      ?? 7;
      document.getElementById("markupPct").value      = res.markupPct    ?? 0;
      const job = res.currentJob || {};
      document.getElementById("customerName").value = job.customerName || "";
      renderEstimate();
      renderLabourEditor();
    }
  );
}

function saveParts() { chrome.storage.local.set({ estimateParts: parts }); }

// ── Grouping ───────────────────────────────────────────────────────────────────
function buildGroups() {
  const map = new Map();
  parts.forEach((p, i) => {
    const key = p.detectedDevice || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ ...p, origIdx: i });
  });
  return map;
}

// ── Estimate rendering ─────────────────────────────────────────────────────────
function renderEstimate() {
  const container = document.getElementById("groupedParts");
  if (!parts.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="icon">📦</div><h3>No parts yet</h3>
      <p>Browse a product on PhoneLCDParts, MobileSentrix, or eBay<br>and click <strong>Add to Estimate</strong>.</p>
    </div>`;
    recalc(); return;
  }

  const groups = buildGroups();
  container.innerHTML = "";
  for (const [device, items] of groups) {
    const groupSum = items.reduce((s, p) => s + p.price*(p.qty||1) + (p.labour||0), 0);
    const card = document.createElement("div");
    card.className = "group-card";
    card.dataset.device = device;
    card.innerHTML = `
      <div class="group-header" data-device="${esc(device)}">
        <span class="group-icon">${dIcon(device)}</span>
        <span class="group-name">${esc(device)}</span>
        <span class="group-count">${items.length} part${items.length!==1?"s":""}</span>
        <span class="group-total-badge">$${groupSum.toFixed(2)}</span>
      </div>
      <div class="group-parts">${items.map(partHtml).join("")}</div>
      <div class="group-footer">
        <span>Group total (parts + labour)</span>
        <span>$${groupSum.toFixed(2)}</span>
      </div>`;
    container.appendChild(card);
  }

  bindPartEvents(container);
  bindDragDrop(container);
  recalc();
}

function partHtml(p) {
  const qty    = p.qty || 1;
  const total  = (p.price * qty).toFixed(2);
  const labour = (p.labour || 0).toFixed(2);
  const srcHtml = p.url
    ? `<a href="${esc(p.url)}" target="_blank">${esc(p.source || p.url)}</a>`
    : (p.source && p.source !== "manual" ? esc(p.source) : "");
  return `
    <div class="part-item" draggable="true" data-orig="${p.origIdx}">
      <span class="drag-handle" title="Drag to move to a different group">⠿</span>
      <div class="part-info">
        <div class="part-name" title="${esc(p.name)}">${esc(p.name)}</div>
        ${srcHtml ? `<div class="part-source">${srcHtml}</div>` : ""}
        <div class="part-price-row">
          <span class="part-price">$${total}</span>
          <div class="part-qty">
            <button class="qty-btn" data-action="dec" data-orig="${p.origIdx}">−</button>
            <span class="qty-val">${qty}</span>
            <button class="qty-btn" data-action="inc" data-orig="${p.origIdx}">+</button>
          </div>
          <span class="part-unit">@ $${p.price.toFixed(2)}</span>
        </div>
        <div class="part-labour-row">
          <span class="part-labour-label">Labour</span>
          <div class="part-labour-wrap">
            <span class="part-labour-sym">$</span>
            <input class="part-labour-input" type="number" min="0" step="5"
              value="${labour}" data-orig="${p.origIdx}" />
          </div>
        </div>
      </div>
      <button class="btn-remove" data-orig="${p.origIdx}" title="Remove">✕</button>
    </div>`;
}

function bindPartEvents(container) {
  container.querySelectorAll(".btn-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      parts.splice(+btn.dataset.orig, 1);
      saveParts(); renderEstimate();
    });
  });
  container.querySelectorAll(".qty-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = +btn.dataset.orig;
      parts[i].qty = Math.max(1, (parts[i].qty||1) + (btn.dataset.action==="inc"?1:-1));
      saveParts(); renderEstimate();
    });
  });
  container.querySelectorAll(".part-labour-input").forEach(input => {
    input.addEventListener("input", () => {
      parts[+input.dataset.orig].labour = parseFloat(input.value) || 0;
      saveParts(); recalc(); refreshGroupTotals();
    });
  });
}

function refreshGroupTotals() {
  const groups = buildGroups();
  document.querySelectorAll(".group-card").forEach(card => {
    const items = groups.get(card.dataset.device) || [];
    const total = items.reduce((s, p) => s + p.price*(p.qty||1) + (p.labour||0), 0);
    const badge = card.querySelector(".group-total-badge");
    const foot  = card.querySelector(".group-footer span:last-child");
    if (badge) badge.textContent = `$${total.toFixed(2)}`;
    if (foot)  foot.textContent  = `$${total.toFixed(2)}`;
  });
}

// ── Drag & Drop ────────────────────────────────────────────────────────────────
function bindDragDrop(container) {
  container.querySelectorAll(".part-item").forEach(el => {
    el.addEventListener("dragstart", (e) => {
      dragSrcIdx = +el.dataset.orig;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      container.querySelectorAll(".group-card").forEach(c => c.classList.remove("drag-over"));
    });
  });

  container.querySelectorAll(".group-header").forEach(hdr => {
    hdr.addEventListener("dragover", (e) => {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      hdr.closest(".group-card").classList.add("drag-over");
    });
    hdr.addEventListener("dragleave", () => hdr.closest(".group-card").classList.remove("drag-over"));
    hdr.addEventListener("drop", (e) => {
      e.preventDefault();
      const target = hdr.dataset.device;
      if (dragSrcIdx != null && parts[dragSrcIdx]) {
        const src = parts[dragSrcIdx].detectedDevice || "Other";
        if (src !== target) {
          parts[dragSrcIdx].detectedDevice = target;
          if (!(parts[dragSrcIdx].labour > 0) && labourRates[target]) {
            parts[dragSrcIdx].labour = labourRates[target];
          }
          saveParts(); renderEstimate();
          showToast(`Moved to ${target}`);
        }
      }
      dragSrcIdx = null;
      container.querySelectorAll(".group-card").forEach(c => c.classList.remove("drag-over"));
    });
  });
}

// ── Recalculate ────────────────────────────────────────────────────────────────
function recalc() {
  const partsTotal  = parts.reduce((s, p) => s + p.price*(p.qty||1), 0);
  const labourTotal = parts.reduce((s, p) => s + (p.labour||0), 0);
  const shipping    = parseFloat(document.getElementById("shippingInput").value) || 0;
  const markupPct   = parseFloat(document.getElementById("markupPct").value)    || 0;
  const base        = partsTotal + labourTotal + shipping;
  const markupAmt   = base * (markupPct / 100);
  const pretax      = base + markupAmt;
  const taxRate     = parseFloat(document.getElementById("taxRate").value) || 0;
  const taxAmt      = pretax * (taxRate / 100);
  const grand       = pretax + taxAmt;

  document.getElementById("subtotal").textContent    = `$${partsTotal.toFixed(2)}`;
  document.getElementById("labourTotal").textContent = `$${labourTotal.toFixed(2)}`;
  document.getElementById("markupAmt").textContent   = `$${markupAmt.toFixed(2)}`;
  document.getElementById("pretaxTotal").textContent = `$${pretax.toFixed(2)}`;
  document.getElementById("taxAmount").textContent   = `$${taxAmt.toFixed(2)}`;
  document.getElementById("grandTotal").textContent  = `$${grand.toFixed(2)}`;
}

// ── Labour Editor ──────────────────────────────────────────────────────────────
function renderLabourEditor(filter = "") {
  const grid          = document.getElementById("labourDeviceGrid");
  const activeDevices = new Set(parts.map(p => p.detectedDevice).filter(Boolean));

  const entries = Object.entries(labourRates)
    .filter(([n]) => !filter || n.toLowerCase().includes(filter.toLowerCase()))
    .sort(([a],[b]) => a.localeCompare(b));

  if (!entries.length) {
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      ${filter ? `No devices match "${esc(filter)}"` : 'No rates yet. Click <strong>+ Add Device</strong>.'}
    </div>`;
    return;
  }

  const branded = new Map();
  entries.forEach(([name, rate]) => {
    const b = getBrand(name);
    if (!branded.has(b.name)) branded.set(b.name, { brand: b, entries: [] });
    branded.get(b.name).entries.push([name, rate]);
  });

  const order  = [...BRANDS.map(b => b.name), "Other"];
  const sorted = [...branded.entries()].sort(([a],[b]) => order.indexOf(a) - order.indexOf(b));

  grid.innerHTML = sorted.map(([, { brand, entries: devs }]) => `
    <div class="brand-section">
      <div class="brand-header">
        <span class="brand-icon">${brand.icon}</span>
        <span class="brand-name">${esc(brand.name)}</span>
        <span class="brand-count">${devs.length} device${devs.length!==1?"s":""}</span>
      </div>
      <div class="device-grid">${devs.map(([name, rate]) => {
        const inUse = activeDevices.has(name);
        return `<div class="device-card ${inUse?"in-use":""}" data-device="${esc(name)}">
          <div class="device-card-info">
            <div class="device-card-name">${esc(name)}</div>
            ${inUse?`<div class="device-in-use-badge">● In estimate</div>`:""}
          </div>
          <div class="device-rate-wrap">
            <span class="device-rate-currency">$</span>
            <input class="device-rate-input" type="number" min="0" step="5"
              value="${Number(rate).toFixed(2)}" data-device="${esc(name)}" />
          </div>
          <button class="btn-del-device" data-device="${esc(name)}" title="Delete">✕</button>
        </div>`;
      }).join("")}</div>
    </div>`).join("");

  grid.querySelectorAll(".device-rate-input").forEach(input => {
    input.addEventListener("change", () => {
      const dev = input.dataset.device;
      const val = parseFloat(input.value) || 0;
      labourRates[dev] = val;
      chrome.storage.local.set({ labourRates });
      renderEstimate();
      showToast(`✅ ${dev} → $${val.toFixed(0)}`);
    });
  });

  grid.querySelectorAll(".btn-del-device").forEach(btn => {
    btn.addEventListener("click", () => {
      const dev = btn.dataset.device;
      if (!confirm(`Delete "${dev}" from labour rates?`)) return;
      delete labourRates[dev];
      chrome.storage.local.set({ labourRates });
      renderLabourEditor(document.getElementById("labourSearch").value);
      showToast(`Deleted: ${dev}`);
    });
  });
}

// ── History Tab ────────────────────────────────────────────────────────────────
function renderHistory(filter = "") {
  chrome.storage.local.get(["jobHistory"], (res) => {
    const history = res.jobHistory || [];
    const list    = document.getElementById("historyList");

    const filtered = filter
      ? history.filter(j => (j.customerName || "").toLowerCase().includes(filter.toLowerCase()))
      : history;

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">
        <div class="icon">📂</div>
        <h3>${filter ? `No jobs match "${esc(filter)}"` : "No saved jobs yet"}</h3>
        <p>${filter ? "" : "Click <strong>Save Job</strong> to archive the current estimate."}</p>
      </div>`;
      return;
    }

    list.innerHTML = filtered.map(job => {
      const date      = new Date(job.savedAt || job.createdAt).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
      const partCount = (job.parts || []).length;
      const grand     = job.totals?.grand || 0;
      return `<div class="history-card" data-id="${job.id}">
        <div class="history-card-header">
          <div class="history-customer">${esc(job.customerName || "Unnamed Job")}</div>
          <div class="history-date">${date}</div>
          <div class="history-total">$${grand.toFixed(2)}</div>
        </div>
        <div class="history-meta">
          <div class="history-chip">🔧 <strong>${partCount}</strong> part${partCount!==1?"s":""}</div>
          <div class="history-chip">🏷 Parts: <strong>$${(job.totals?.partsTotal||0).toFixed(2)}</strong></div>
          <div class="history-chip">⚙ Labour: <strong>$${(job.totals?.labourTotal||0).toFixed(2)}</strong></div>
          <div class="history-chip">🧾 Tax: <strong>$${(job.totals?.taxAmt||0).toFixed(2)}</strong></div>
        </div>
        <div class="history-actions">
          <button class="btn-hist view"    data-id="${job.id}">👁 View</button>
          <button class="btn-hist restore" data-id="${job.id}">♻ Restore</button>
          <button class="btn-hist del"     data-id="${job.id}">🗑 Delete</button>
        </div>
      </div>`;
    }).join("");

    // View
    list.querySelectorAll(".btn-hist.view").forEach(btn => {
      btn.addEventListener("click", () => {
        const job = history.find(j => j.id == btn.dataset.id);
        if (job) openHistoryModal(job);
      });
    });

    // Restore
    list.querySelectorAll(".btn-hist.restore").forEach(btn => {
      btn.addEventListener("click", () => {
        const job = history.find(j => j.id == btn.dataset.id);
        if (!job) return;
        if (!confirm(`Restore job "${job.customerName || "Unnamed"}"? This will replace the current estimate.`)) return;
        const newJob = { id: job.id, customerName: job.customerName, createdAt: job.createdAt };
        chrome.storage.local.set({
          estimateParts: JSON.parse(JSON.stringify(job.parts || [])),
          currentJob:    newJob
        }, () => {
          parts = job.parts || [];
          document.getElementById("customerName").value = job.customerName || "";
          renderEstimate();
          // Switch to estimate tab
          document.querySelectorAll(".tab-btn,.tab-panel").forEach(el => el.classList.remove("active"));
          document.querySelector('[data-tab="estimate"]').classList.add("active");
          document.getElementById("tab-estimate").classList.add("active");
          showToast(`Restored: ${job.customerName || "job"}`);
        });
      });
    });

    // Delete
    list.querySelectorAll(".btn-hist.del").forEach(btn => {
      btn.addEventListener("click", () => {
        const job = history.find(j => j.id == btn.dataset.id);
        if (!job) return;
        if (!confirm(`Delete "${job.customerName || "Unnamed"}" from history?`)) return;
        const updated = history.filter(j => j.id != btn.dataset.id);
        chrome.storage.local.set({ jobHistory: updated }, () => {
          showToast("Job deleted");
          renderHistory(document.getElementById("historySearch").value);
        });
      });
    });
  });
}

function openHistoryModal(job) {
  const modal    = document.getElementById("historyModal");
  const title    = document.getElementById("modalTitle");
  const body     = document.getElementById("modalBody");
  const date     = new Date(job.savedAt || job.createdAt).toLocaleString();
  const parts    = job.parts || [];
  const totals   = job.totals || {};

  title.textContent = job.customerName || "Unnamed Job";

  // Group parts by device
  const groups = {};
  parts.forEach(p => {
    const key = p.detectedDevice || "Other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  let html = `<div style="color:var(--muted);font-size:12px;margin-bottom:12px">Saved: ${date}</div>`;

  for (const [device, items] of Object.entries(groups)) {
    html += `<div class="modal-section-title">${dIcon(device)} ${esc(device)}</div>`;
    items.forEach(p => {
      const qty = p.qty || 1;
      html += `<div class="modal-part-row">
        <span>${esc(p.name)}</span>
        <span>$${(p.price * qty).toFixed(2)}${qty > 1 ? ` ×${qty}` : ""}${p.labour > 0 ? ` + Labour $${p.labour.toFixed(2)}` : ""}</span>
      </div>`;
    });
  }

  html += `<div class="modal-section-title">Totals</div>
    <div class="modal-total-row"><span>Parts</span><span>$${(totals.partsTotal||0).toFixed(2)}</span></div>
    <div class="modal-total-row"><span>Labour</span><span>$${(totals.labourTotal||0).toFixed(2)}</span></div>
    <div class="modal-total-row"><span>Shipping</span><span>$${(totals.shipping||0).toFixed(2)}</span></div>
    <div class="modal-total-row"><span>Tax (${(job.taxRate||7)}%)</span><span>$${(totals.taxAmt||0).toFixed(2)}</span></div>
    <div class="modal-total-row grand"><span>Grand Total</span><span>$${(totals.grand||0).toFixed(2)}</span></div>`;

  body.innerHTML = html;
  modal.classList.add("open");
}

document.getElementById("btnModalClose").addEventListener("click", () => {
  document.getElementById("historyModal").classList.remove("open");
});
document.getElementById("historyModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
});
document.getElementById("historySearch").addEventListener("input", (e) => {
  renderHistory(e.target.value);
});

// ── Session: Save Job ──────────────────────────────────────────────────────────
document.getElementById("btnSaveJob").addEventListener("click", () => {
  chrome.storage.local.get(["currentJob","jobHistory","estimateParts"], (r) => {
    const job     = r.currentJob    || {};
    const history = r.jobHistory    || [];
    const pts     = r.estimateParts || [];

    if (!pts.length) { showToast("Nothing to save — estimate is empty"); return; }

    const partsTotal  = pts.reduce((s, p) => s + p.price*(p.qty||1), 0);
    const labourTotal = pts.reduce((s, p) => s + (p.labour||0), 0);
    const shipping    = parseFloat(document.getElementById("shippingInput").value) || 0;
    const taxRate     = parseFloat(document.getElementById("taxRate").value)       || 0;
    const markupPct   = parseFloat(document.getElementById("markupPct").value)     || 0;
    const base        = partsTotal + labourTotal + shipping;
    const markupAmt   = base * (markupPct / 100);
    const pretax      = base + markupAmt;
    const taxAmt      = pretax * (taxRate / 100);

    const record = {
      id:           job.id || Date.now(),
      customerName: job.customerName || document.getElementById("customerName").value.trim() || "Unnamed",
      createdAt:    job.createdAt    || Date.now(),
      savedAt:      Date.now(),
      parts:        JSON.parse(JSON.stringify(pts)),
      shipping, taxRate, markupPct,
      totals: { partsTotal, labourTotal, shipping, markupPct, markupAmt, pretax, taxAmt, grand: pretax + taxAmt }
    };

    const existingIdx = history.findIndex(h => h.id === job.id);
    if (existingIdx >= 0) history[existingIdx] = record;
    else { job.id = record.id; history.unshift(record); }

    chrome.storage.local.set({ jobHistory: history, currentJob: job }, () => showToast("✅ Job saved"));
  });
});

// ── New Job (Clear) ────────────────────────────────────────────────────────────
document.getElementById("btnClearAll").addEventListener("click", () => {
  if (!parts.length && !document.getElementById("customerName").value) return;
  if (!confirm("Start a new job? Unsaved changes will be lost.")) return;
  const newJob = { id: Date.now(), customerName: "", createdAt: Date.now() };
  chrome.storage.local.set({ estimateParts: [], currentJob: newJob }, () => {
    parts = [];
    document.getElementById("customerName").value = "";
    renderEstimate();
    showToast("New job started");
  });
});

// ── Customer name ──────────────────────────────────────────────────────────────
document.getElementById("customerName").addEventListener("input", (e) => {
  chrome.storage.local.get(["currentJob"], (r) => {
    const job = r.currentJob || {};
    job.customerName = e.target.value.trim();
    chrome.storage.local.set({ currentJob: job });
  });
});

// ── Shipping / markup / tax ────────────────────────────────────────────────────
["shippingInput","markupPct","taxRate"].forEach(id => {
  document.getElementById(id).addEventListener("input", (e) => {
    const key = id === "shippingInput" ? "shippingCost" : id === "taxRate" ? "taxRate" : "markupPct";
    chrome.storage.local.set({ [key]: parseFloat(e.target.value) || 0 });
    recalc();
  });
});

// ── Tabs ───────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    // Admin link opens admin page in a new tab
    if (btn.dataset.tab === "__admin") {
      chrome.tabs.create({ url: chrome.runtime.getURL("admin.html") });
      return;
    }
    document.querySelectorAll(".tab-btn,.tab-panel").forEach(el => el.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "labour")  renderLabourEditor(document.getElementById("labourSearch").value);
    if (btn.dataset.tab === "history") renderHistory(document.getElementById("historySearch").value);
  });
});

// ── Copy / Print ───────────────────────────────────────────────────────────────
function getCalc() {
  const partsTotal  = parts.reduce((s, p) => s + p.price*(p.qty||1), 0);
  const labourTotal = parts.reduce((s, p) => s + (p.labour||0), 0);
  const shipping    = parseFloat(document.getElementById("shippingInput").value) || 0;
  const markupPct   = parseFloat(document.getElementById("markupPct").value)     || 0;
  const base        = partsTotal + labourTotal + shipping;
  const markupAmt   = base * (markupPct / 100);
  const pretax      = base + markupAmt;
  const taxRate     = parseFloat(document.getElementById("taxRate").value) || 0;
  const taxAmt      = pretax * (taxRate / 100);
  return { partsTotal, labourTotal, shipping, markupPct, markupAmt, pretax, taxRate, taxAmt, grand: pretax + taxAmt };
}

function buildPrintHtml() {
  const groups   = buildGroups();
  const c        = getCalc();
  const customer = document.getElementById("customerName").value.trim();
  const row = (l, v, indent = 0) =>
    `<tr><td>${"&nbsp;".repeat(indent*4)}${l}</td><td style="text-align:right"><strong>${v}</strong></td></tr>`;

  let rows = "";
  for (const [device, items] of groups) {
    const groupSum = items.reduce((s, p) => s + p.price*(p.qty||1) + (p.labour||0), 0);
    rows += `<tr><td colspan="2" style="padding-top:14px;padding-bottom:3px;font-weight:700;border-bottom:1px solid #ccc">
      ${dIcon(device)} ${esc(device)}</td></tr>`;
    items.forEach(p => {
      const qty = p.qty || 1;
      rows += row(qty>1?`${esc(p.name.substring(0,48))} ×${qty}`:esc(p.name.substring(0,55)), `$${(p.price*qty).toFixed(2)}`, 1);
      if (p.labour) rows += row("Labour", `$${p.labour.toFixed(2)}`, 2);
    });
    rows += `<tr><td style="padding-left:2em;font-style:italic;color:#666">Group total</td>
      <td style="text-align:right;font-style:italic">$${groupSum.toFixed(2)}</td></tr>`;
  }
  rows += `<tr><td colspan="2" style="padding-top:16px;border-top:2px solid #333"></td></tr>
    ${row("Parts",    "$"+c.partsTotal.toFixed(2))}
    ${row("Labour",   "$"+c.labourTotal.toFixed(2))}
    ${row("Shipping", "$"+c.shipping.toFixed(2))}
    ${c.markupPct>0?row(`Markup (${c.markupPct}%)`, "$"+c.markupAmt.toFixed(2)):""}
    ${row("Subtotal", "$"+c.pretax.toFixed(2))}
    ${row(`Tax (${c.taxRate}%)`, "$"+c.taxAmt.toFixed(2))}
    <tr style="font-size:16px;font-weight:800"><td>GRAND TOTAL</td><td style="text-align:right">$${c.grand.toFixed(2)}</td></tr>`;

  return `<!DOCTYPE html><html><head><title>Repair Estimate</title>
    <style>body{font-family:monospace;padding:36px;font-size:13px}
    h2{margin-bottom:2px}.sub{color:#666;font-size:12px;margin-bottom:4px}
    .date{color:#999;font-size:11px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}
    @media print{button{display:none}}</style></head><body>
    <h2>🔧 Repair Estimate</h2>
    ${customer?`<div class="sub">Customer: <strong>${esc(customer)}</strong></div>`:""}
    <div class="date">Generated: ${new Date().toLocaleString()}</div>
    <table>${rows}</table></body></html>`;
}

function buildCopySummary() {
  const groups   = buildGroups();
  const c        = getCalc();
  const customer = document.getElementById("customerName").value.trim();
  const lines    = ["=== Repair Estimate ==="];
  if (customer) lines.push(`Customer: ${customer}`);
  lines.push("");
  for (const [device, items] of groups) {
    lines.push(`${device}:`);
    items.forEach(p => {
      const qty = p.qty || 1;
      lines.push(`  ${p.name.substring(0,55)}  x${qty}  $${(p.price*qty).toFixed(2)}`);
      if (p.labour) lines.push(`    Labour  $${p.labour.toFixed(2)}`);
    });
    lines.push("");
  }
  lines.push("─".repeat(36),
    `Parts:    $${c.partsTotal.toFixed(2)}`,
    `Labour:   $${c.labourTotal.toFixed(2)}`,
    `Shipping: $${c.shipping.toFixed(2)}`,
    c.markupPct > 0 ? `Markup (${c.markupPct}%): $${c.markupAmt.toFixed(2)}` : null,
    `Subtotal: $${c.pretax.toFixed(2)}`,
    `Tax (${c.taxRate}%): $${c.taxAmt.toFixed(2)}`,
    `TOTAL:    $${c.grand.toFixed(2)}`,
    "", `Generated: ${new Date().toLocaleString()}`
  ).filter(Boolean);
  return lines.join("\n");
}

document.getElementById("btnCopy").addEventListener("click", () => {
  navigator.clipboard.writeText(buildCopySummary()).then(() => showToast("✅ Copied!"));
});
document.getElementById("btnPrint").addEventListener("click", () => {
  const win = window.open("", "_blank");
  win.document.write(buildPrintHtml());
  win.document.close();
  setTimeout(() => win.print(), 400);
});

// ── Labour editor controls ─────────────────────────────────────────────────────
document.getElementById("labourSearch").addEventListener("input", (e) => renderLabourEditor(e.target.value));

document.getElementById("btnOpenAddForm").addEventListener("click", () => {
  document.getElementById("addDeviceForm").classList.add("open");
  document.getElementById("newDeviceName").focus();
});
document.getElementById("btnCancelAdd").addEventListener("click", () => {
  document.getElementById("addDeviceForm").classList.remove("open");
  document.getElementById("newDeviceName").value = "";
  document.getElementById("newDeviceRate").value = "";
});
document.getElementById("btnSaveDevice").addEventListener("click", () => {
  const name = document.getElementById("newDeviceName").value.trim();
  const rate = parseFloat(document.getElementById("newDeviceRate").value) || 0;
  if (!name) { showToast("Enter a device name"); return; }
  labourRates[name] = rate;
  chrome.storage.local.set({ labourRates });
  document.getElementById("newDeviceName").value = "";
  document.getElementById("newDeviceRate").value = "";
  document.getElementById("addDeviceForm").classList.remove("open");
  renderLabourEditor(document.getElementById("labourSearch").value);
  showToast(`✅ Added: ${name} ($${rate.toFixed(0)})`);
});
document.getElementById("newDeviceRate").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btnSaveDevice").click();
});

// ── Live sync ──────────────────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.estimateParts) {
    parts = changes.estimateParts.newValue || [];
    renderEstimate();
    renderLabourEditor(document.getElementById("labourSearch").value);
  }
  if (changes.labourRates) {
    labourRates = changes.labourRates.newValue || {};
    renderLabourEditor(document.getElementById("labourSearch").value);
  }
  if (changes.currentJob) {
    const job = changes.currentJob.newValue || {};
    const el  = document.getElementById("customerName");
    if (el && document.activeElement !== el) el.value = job.customerName || "";
  }
});

// ── Auth overlay ──────────────────────────────────────────────────────────────
let _authMode = "signin";

document.querySelectorAll(".auth-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    _authMode = btn.dataset.mode;
    document.querySelectorAll(".auth-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("btnAuthSubmit").textContent =
      _authMode === "signin" ? "Sign In" : "Create Account";
    _setAuthErr(null);
  });
});

function _setAuthErr(msg) {
  const el = document.getElementById("authError");
  if (msg) { el.textContent = msg; el.style.display = "block"; }
  else      { el.style.display = "none"; }
}

document.getElementById("btnShowPw").addEventListener("click", () => {
  const inp = document.getElementById("authPassword");
  inp.type  = inp.type === "password" ? "text" : "password";
});

document.getElementById("btnAuthSubmit").addEventListener("click", async () => {
  const email    = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const btn      = document.getElementById("btnAuthSubmit");
  if (!email || !password) { _setAuthErr("Please enter your email and password."); return; }
  btn.disabled = true; btn.textContent = "Please wait…";
  try {
    if (_authMode === "signin") await fqSignIn(email, password);
    else                        await fqSignUp(email, password);
    await _onAuthSuccess();
  } catch (e) {
    _setAuthErr(e.message);
    btn.disabled = false;
    btn.textContent = _authMode === "signin" ? "Sign In" : "Create Account";
  }
});

document.getElementById("authEmail").addEventListener("keydown",    e => { if (e.key === "Enter") document.getElementById("authPassword").focus(); });
document.getElementById("authPassword").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btnAuthSubmit").click(); });

document.getElementById("btnGoogleSignIn").addEventListener("click", async () => {
  const btn = document.getElementById("btnGoogleSignIn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    await fqGoogleSignIn();
    await _onAuthSuccess();
  } catch (e) {
    _setAuthErr(e.message);
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 48 48" style="width:20px;height:20px"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.5 2.7 13.5l7.8 6.1C12.4 13.2 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17z"/><path fill="#FBBC05" d="M10.5 28.4A14.8 14.8 0 0 1 9.5 24c0-1.5.3-3 .7-4.4L2.4 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.2 0-11.5-4.2-13.4-9.8l-7.9 6.1C6.5 42.4 14.6 48 24 48z"/></svg> Continue with Google`;
  }
});

async function _onAuthSuccess() {
  const sess = await fqGetSession();
  document.getElementById("authOverlay").classList.add("hidden");
  _addSignOutBtn(sess);
  _showAdminLinkIfPublisher(sess);
  await fqSyncFromCloud();
  loadAll();
}

function _showAdminLinkIfPublisher(sess) {
  if (sess?.email === FQ_ADMIN_EMAIL) {
    document.getElementById("btnAdminLink").style.display = "";
  }
}

function _addSignOutBtn(sess) {
  if (document.getElementById("btnSignOut")) return;
  const btn = document.createElement("button");
  btn.id = "btnSignOut"; btn.className = "btn-hdr";
  btn.title = sess?.email || "Sign out"; btn.textContent = `↩ ${sess?.displayName || "Sign out"}`;
  btn.addEventListener("click", async () => {
    if (!confirm("Sign out?")) return;
    await fqSignOut();
    document.getElementById("authOverlay").classList.remove("hidden");
  });
  document.querySelector(".hdr-actions").prepend(btn);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  fqInitAuthUI();
  const sess = await fqGetSession();
  if (!sess) {
    document.getElementById("authOverlay").classList.remove("hidden");
  } else {
    document.getElementById("authOverlay").classList.add("hidden");
    _addSignOutBtn(sess);
    _showAdminLinkIfPublisher(sess);
    await fqSyncFromCloud();
    loadAll();
  }

  // Handle ?tab=<name> URL param (e.g. from sidebar 💬 button)
  const urlTab = new URLSearchParams(location.search).get("tab");
  if (urlTab && document.getElementById(`tab-${urlTab}`)) {
    document.querySelectorAll(".tab-btn,.tab-panel").forEach(el => el.classList.remove("active"));
    const btn = document.querySelector(`[data-tab="${urlTab}"]`);
    if (btn) btn.classList.add("active");
    document.getElementById(`tab-${urlTab}`).classList.add("active");
    if (urlTab === "feedback") _initFeedbackTab(sess);
  }
})();

// ── Support & Feedback Tab ────────────────────────────────────────────────────

const FQ_CAT_ICONS   = { bug:"🐛", feature:"✨", question:"❓", feedback:"📣" };
const FQ_CAT_LABELS  = { bug:"Bug Report", feature:"Feature Request", question:"Question", feedback:"Feedback" };
let _userTickets  = [];
let _pollInterval = null;

function _fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" })
    : d.toLocaleDateString(undefined, { month:"short", day:"numeric" }) + " " +
      d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
}

function _threadHtml(ticket) {
  const msgs = ticket.messages || [];
  if (!msgs.length) return `<div style="text-align:center;color:var(--muted);padding:16px;font-size:13px">No messages yet</div>`;
  return msgs.map(m => {
    const isAdmin = m.type === "admin";
    return `<div class="utc-msg ${isAdmin ? "admin" : "user"}">
      ${isAdmin ? `<div class="utc-by">Admin</div>` : ""}
      <div class="utc-bubble">${esc(m.text).replace(/\n/g,"<br>")}</div>
      <div class="utc-time">${_fmtTs(m.ts)}</div>
    </div>`;
  }).join("");
}

function _ticketCardHtml(t) {
  const status  = t.status || "open";
  const icon    = FQ_CAT_ICONS[t.category]  || "💬";
  const label   = FQ_CAT_LABELS[t.category] || t.category;
  const hasReply = (t.messages || []).some(m => m.type === "admin");
  const statusText = { open:"Open", in_progress:"In Progress", resolved:"Resolved" }[status] || status;

  const replyArea = status === "resolved"
    ? `<div class="utc-resolved-note">✓ Resolved — <button class="btn-utc-reopen" data-id="${esc(t.id)}">Reopen</button></div>`
    : `<div class="utc-reply-bar">
        <textarea class="utc-reply-input" data-id="${esc(t.id)}" placeholder="Reply…" rows="1"></textarea>
        <button class="btn-utc-send" data-id="${esc(t.id)}">Send</button>
      </div>`;

  return `<div class="utc" data-id="${esc(t.id)}">
    <div class="utc-header">
      <div class="utc-cat-icon">${icon}</div>
      <div class="utc-info">
        <div class="utc-subject">${esc(t.subject || "(no subject)")}</div>
        <div class="utc-meta">${esc(label)} · ${_fmtTs(t.createdAt)}${hasReply ? " · <strong>Admin replied</strong>" : ""}</div>
      </div>
      <span class="utc-badge ${status}">${statusText}</span>
      <span class="utc-chevron">▼</span>
    </div>
    <div class="utc-body">
      <div class="utc-thread" id="thread-${esc(t.id)}">${_threadHtml(t)}</div>
      ${replyArea}
    </div>
  </div>`;
}

function _renderTicketList() {
  const el = document.getElementById("fqTicketList");
  const tickets = _userTickets.filter(t => t.category !== "feedback");

  if (!tickets.length) {
    el.innerHTML = `<div class="fqs-empty">
      <div class="icon">🎫</div>
      <h3>No tickets yet</h3>
      <p>Click <strong>+ New Ticket</strong> to report a bug, ask a question, or request a feature. We'll reply right here.</p>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="fq-ticket-list-label">My Tickets (${tickets.length})</div>` +
    tickets.map(_ticketCardHtml).join("");

  _bindTicketEvents(el);
}

function _bindTicketEvents(container) {
  // Toggle expand/collapse
  container.querySelectorAll(".utc-header").forEach(h => {
    h.addEventListener("click", () => {
      const card = h.closest(".utc");
      const opening = !card.classList.contains("expanded");
      container.querySelectorAll(".utc.expanded").forEach(c => c.classList.remove("expanded"));
      if (opening) {
        card.classList.add("expanded");
        const thread = card.querySelector(".utc-thread");
        if (thread) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
      }
    });
  });

  // Send reply
  container.querySelectorAll(".btn-utc-send").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id   = btn.dataset.id;
      const ta   = container.querySelector(`.utc-reply-input[data-id="${id}"]`);
      const text = ta?.value?.trim();
      if (!text) return;
      btn.disabled = true; btn.textContent = "…";
      try {
        await fqUserReply(id, text);
        ta.value = ""; ta.style.height = "";
        _userTickets = await fqGetUserTickets();
        // Patch just this card's thread without full re-render to keep expand state
        const thread = document.getElementById(`thread-${id}`);
        const t = _userTickets.find(x => x.id === id);
        if (thread && t) { thread.innerHTML = _threadHtml(t); thread.scrollTop = thread.scrollHeight; }
      } catch (e) { showToast("Error sending reply: " + e.message); }
      btn.disabled = false; btn.textContent = "Send";
    });
  });

  // Reopen resolved ticket
  container.querySelectorAll(".btn-utc-reopen").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await fqUserReply(btn.dataset.id, "Reopening this ticket.");
        _userTickets = await fqGetUserTickets();
        _renderTicketList();
      } catch {}
    });
  });

  // Auto-resize + Enter-to-send on reply textareas
  container.querySelectorAll(".utc-reply-input").forEach(ta => {
    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
    });
    ta.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        container.querySelector(`.btn-utc-send[data-id="${ta.dataset.id}"]`)?.click();
      }
    });
  });
}

// ── New ticket form ────────────────────────────────────────────────────────────
let _feedbackInitDone = false;

async function _initFeedbackTab(sess) {
  if (_feedbackInitDone) {
    // Already wired; just refresh tickets
    if (sess) { _userTickets = await fqGetUserTickets(); _renderTicketList(); }
    return;
  }
  _feedbackInitDone = true;

  // Show guest note if not signed in
  if (!sess) {
    document.getElementById("btnNewTicket").disabled = true;
    document.getElementById("btnNewTicket").title = "Sign in to submit tickets";
    document.getElementById("fqTicketList").innerHTML = `
      <div class="fqs-guest-note">
        <p>🔒 Sign in to submit support tickets and chat with us.<br>
        You can still use the quick feedback box below.</p>
      </div>`;
  }

  // + New Ticket toggle
  document.getElementById("btnNewTicket").addEventListener("click", () => {
    const form = document.getElementById("newTicketForm");
    const opening = form.style.display === "none";
    form.style.display = opening ? "" : "none";
    if (opening) document.getElementById("ntfMessage").focus();
  });

  // Cancel new ticket
  document.getElementById("btnNtfCancel").addEventListener("click", () => {
    document.getElementById("newTicketForm").style.display = "none";
    document.getElementById("ntfMessage").value = "";
    document.getElementById("ntfError").style.display = "none";
  });

  // Submit new ticket
  document.getElementById("btnNtfSubmit").addEventListener("click", async () => {
    const category = document.getElementById("ntfCategory").value;
    const message  = document.getElementById("ntfMessage").value.trim();
    const errEl    = document.getElementById("ntfError");
    errEl.style.display = "none";
    if (!message) { errEl.textContent = "Please describe the issue."; errEl.style.display = ""; return; }

    const btn = document.getElementById("btnNtfSubmit");
    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      await fqCreateTicket(category, null, message);
      _userTickets = await fqGetUserTickets();
      _renderTicketList();
      document.getElementById("newTicketForm").style.display = "none";
      document.getElementById("ntfMessage").value = "";
      showToast("✅ Ticket submitted!");
    } catch (e) {
      errEl.textContent = "Failed to submit. " + (e.message || "Try again.");
      errEl.style.display = "";
    }
    btn.disabled = false; btn.textContent = "Submit Ticket";
  });

  // Feedback section toggle
  document.getElementById("btnToggleFeedback").addEventListener("click", () => {
    const body  = document.getElementById("fqsfBody");
    const arrow = document.querySelector(".fqsf-arrow");
    const open  = body.style.display !== "none";
    body.style.display     = open ? "none" : "";
    arrow.style.transform  = open ? "" : "rotate(180deg)";
  });

  // One-way feedback submit
  document.getElementById("btnSubmitFeedback").addEventListener("click", async () => {
    const text  = document.getElementById("fqsfMessage").value.trim();
    const errEl = document.getElementById("fqsfError");
    errEl.style.display = "none";
    if (!text) { errEl.textContent = "Please enter your feedback."; errEl.style.display = ""; return; }
    const btn = document.getElementById("btnSubmitFeedback");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      if (sess) await fqCreateTicket("feedback", "Quick Feedback", text);
      const { feedbackItems } = await chrome.storage.local.get(["feedbackItems"]);
      await chrome.storage.local.set({ feedbackItems: [...(feedbackItems || []),
        { text, ts: Date.now(), email: sess?.email }] });
      document.getElementById("fqsfMessage").value = "";
      const ok = document.getElementById("fqsfSuccess");
      ok.style.display = "";
      btn.style.display = "none";
      setTimeout(() => { ok.style.display = "none"; btn.style.display = ""; }, 3000);
    } catch (e) {
      errEl.textContent = "Failed to send. Please try again."; errEl.style.display = "";
    }
    btn.disabled = false; btn.textContent = "Send Feedback";
  });

  // Initial load
  if (sess) { _userTickets = await fqGetUserTickets(); }
  _renderTicketList();

  // Poll for admin replies every 20s while this tab is visible
  if (_pollInterval) clearInterval(_pollInterval);
  if (sess) {
    _pollInterval = setInterval(async () => {
      const fresh = await fqGetUserTickets();
      if (JSON.stringify(fresh) !== JSON.stringify(_userTickets)) {
        _userTickets = fresh;
        _renderTicketList();
      }
    }, 20000);
  }
}

// Stop polling when leaving the feedback tab
document.querySelectorAll(".tab-btn:not([data-tab='feedback'])").forEach(btn => {
  btn.addEventListener("click", () => { if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; } });
});

// Click tab manually
document.querySelector('[data-tab="feedback"]').addEventListener("click", async () => {
  const sess = await fqGetSession().catch(() => null);
  _initFeedbackTab(sess);
});
