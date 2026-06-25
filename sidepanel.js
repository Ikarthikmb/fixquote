// ── Repair Estimator – Side Panel ────────────────────────────────────────────

// ── Device list for manual-add dropdown ──────────────────────────────────────
const KNOWN_DEVICES = [
  "iPhone", "iPad Pro", "iPad", "MacBook",
  "Samsung", "Google Pixel",
  "OnePlus", "Motorola", "LG", "Huawei", "Sony", "Nokia", "Other / Unknown"
];

// ── State ─────────────────────────────────────────────────────────────────────
let parts       = [];
let labourRates = {};
let dragSrcIdx  = null;
let isGuestMode = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const groupedEl     = document.getElementById("groupedParts");
const rateListEl    = document.getElementById("rateList");
const subtotalEl    = document.getElementById("subtotal");
const labourTotalEl = document.getElementById("labourTotal");
const pretaxEl      = document.getElementById("pretaxTotal");
const taxAmtEl      = document.getElementById("taxAmount");
const grandEl       = document.getElementById("grandTotal");
const shippingInput = document.getElementById("shippingInput");
const taxRateInput  = document.getElementById("taxRate");
const customerInput = document.getElementById("customerName");
const manualForm    = document.getElementById("manualForm");
const grabStatus    = document.getElementById("grabStatus");
const mfName        = document.getElementById("mfName");
const mfPrice       = document.getElementById("mfPrice");
const mfDevice      = document.getElementById("mfDevice");

// ── Populate device dropdown ──────────────────────────────────────────────────
KNOWN_DEVICES.forEach(d => {
  const opt = document.createElement("option");
  opt.value = d; opt.textContent = d;
  mfDevice.appendChild(opt);
});

// ── Load initial state ────────────────────────────────────────────────────────
function loadAll() {
  chrome.storage.local.get(
    ["estimateParts", "labourRates", "currentJob", "taxRate", "shippingCost"],
    (result) => {
      parts       = result.estimateParts || [];
      labourRates = result.labourRates   || {};
      const job   = result.currentJob    || {};
      customerInput.value = job.customerName || "";
      if (result.taxRate      !== undefined) taxRateInput.value  = result.taxRate;
      if (result.shippingCost !== undefined) shippingInput.value = result.shippingCost;
      renderGroups();
      renderRates();
      recalc();
    }
  );
}

// ── Storage change listener (sync with fullpage tab) ──────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.estimateParts) {
    parts = changes.estimateParts.newValue || [];
    renderGroups(); recalc();
  }
  if (changes.labourRates) {
    labourRates = changes.labourRates.newValue || {};
    renderRates();
  }
});

// ── Build groups map ──────────────────────────────────────────────────────────
function buildGroups() {
  const map = {};
  parts.forEach((p, i) => {
    const key = p.detectedDevice || "Other / Unknown";
    if (!map[key]) map[key] = [];
    map[key].push({ ...p, origIdx: i });
  });
  return map;
}

// ── Device icons ──────────────────────────────────────────────────────────────
function deviceIcon(name) {
  if (!name) return "🔧";
  const n = name.toLowerCase();
  if (n.includes("iphone"))                  return "📱";
  if (n.includes("ipad"))                    return "💻";
  if (n.includes("macbook"))                 return "💻";
  if (n.includes("samsung")||n.includes("galaxy")) return "📱";
  if (n.includes("pixel"))                   return "📱";
  if (n.includes("oneplus")||n.includes("motorola")||n.includes("lg")||n.includes("sony")||n.includes("huawei")||n.includes("nokia")) return "📱";
  return "🔧";
}

// ── Render all groups ─────────────────────────────────────────────────────────
function renderGroups() {
  if (!parts.length) {
    groupedEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">📦</div>
        <p>No parts yet.<br>Browse a product or use the buttons above.</p>
      </div>`;
    return;
  }

  const groups = buildGroups();
  let html = "";
  for (const [device, items] of Object.entries(groups)) {
    const groupPartsTotal  = items.reduce((s, p) => s + p.price * (p.qty || 1), 0);
    const groupLabourTotal = items.reduce((s, p) => s + (p.labour || 0), 0);
    const groupTotal = groupPartsTotal + groupLabourTotal;

    html += `<div class="group-card" data-device="${esc(device)}">
      <div class="group-header" data-device="${esc(device)}">
        <span class="group-icon">${deviceIcon(device)}</span>
        <span class="group-name">${esc(device)}</span>
        <span class="group-count">${items.length} part${items.length !== 1 ? "s" : ""}</span>
        <span class="group-badge">$${groupTotal.toFixed(2)}</span>
      </div>`;

    items.forEach(p => { html += partHtml(p); });
    html += `</div>`;
  }

  groupedEl.innerHTML = html;
  bindPartEvents();
  bindDragDrop();
}

// ── Single part HTML ──────────────────────────────────────────────────────────
function partHtml(p) {
  const qty      = p.qty    || 1;
  const labour   = p.labour || 0;
  const lineTotal = p.price * qty;
  const srcHtml  = p.url
    ? `<a href="${esc(p.url)}" target="_blank">${esc(p.source || "link")}</a>`
    : (p.source && p.source !== "manual" ? esc(p.source) : "");

  return `<div class="part-item" draggable="true" data-orig="${p.origIdx}">
    <span class="drag-handle">⠿</span>
    <div class="part-info">
      <div class="part-name">${esc(p.name)}</div>
      ${srcHtml ? `<div class="part-source">${srcHtml}</div>` : ""}
      <div class="part-price-row">
        <div class="part-price-edit">
          <span class="part-price-sym">$</span>
          <input class="part-price-input" type="number" min="0" step="0.01"
            value="${p.price.toFixed(2)}" data-orig="${p.origIdx}"
            title="Click to edit price" />
        </div>
        <span class="part-unit">ea</span>
        <span class="part-unit">·</span>
        <div class="part-qty">
          <button class="qty-btn" data-orig="${p.origIdx}" data-delta="-1">−</button>
          <span class="qty-val">${qty}</span>
          <button class="qty-btn" data-orig="${p.origIdx}" data-delta="1">+</button>
        </div>
        <span class="part-unit">= <b>$${lineTotal.toFixed(2)}</b></span>
      </div>
      <div class="part-labour-row">
        <span class="part-labour-label">🔧 Labour</span>
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

// ── Bind part-level events ────────────────────────────────────────────────────
function bindPartEvents() {
  groupedEl.querySelectorAll(".btn-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      parts.splice(parseInt(btn.dataset.orig), 1);
      saveParts();
    });
  });

  groupedEl.querySelectorAll(".qty-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx   = parseInt(btn.dataset.orig);
      const delta = parseInt(btn.dataset.delta);
      parts[idx].qty = Math.max(1, (parts[idx].qty || 1) + delta);
      saveParts();
    });
  });

  // Labour: update on blur only — prevents cursor escape during typing
  groupedEl.querySelectorAll(".part-labour-input").forEach(input => {
    // Track value changes while typing without re-rendering
    input.addEventListener("input", () => {
      parts[parseInt(input.dataset.orig)].labour = parseFloat(input.value) || 0;
    });
    // Only save + re-render when user leaves the field
    input.addEventListener("blur", () => {
      parts[parseInt(input.dataset.orig)].labour = parseFloat(input.value) || 0;
      saveParts();
    });
    // Prevent the default form submission / re-render on Enter; just blur instead
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });

  // Price: editable, save on blur
  groupedEl.querySelectorAll(".part-price-input").forEach(input => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("input", () => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val >= 0) parts[parseInt(input.dataset.orig)].price = val;
    });
    input.addEventListener("blur", () => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val >= 0) {
        parts[parseInt(input.dataset.orig)].price = val;
        saveParts();
      } else {
        // Restore previous valid value
        input.value = parts[parseInt(input.dataset.orig)].price.toFixed(2);
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
  });
}

// ── Drag & drop (regroup parts) ───────────────────────────────────────────────
function bindDragDrop() {
  groupedEl.querySelectorAll(".part-item").forEach(item => {
    item.addEventListener("dragstart", (e) => {
      dragSrcIdx = parseInt(item.dataset.orig);
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      groupedEl.querySelectorAll(".group-card").forEach(c => c.classList.remove("drag-over"));
    });
  });

  groupedEl.querySelectorAll(".group-card").forEach(card => {
    card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drag-over"); });
    card.addEventListener("dragleave",  () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (e) => {
      e.preventDefault(); card.classList.remove("drag-over");
      if (dragSrcIdx === null) return;
      const newDevice = card.dataset.device;
      const p = parts[dragSrcIdx];
      if (!p) return;
      const oldDevice = p.detectedDevice || "Other / Unknown";
      if (oldDevice === newDevice) return;
      p.detectedDevice = newDevice === "Other / Unknown" ? null : newDevice;
      if (!(p.labour > 0) && p.detectedDevice && labourRates[p.detectedDevice]) {
        p.labour = labourRates[p.detectedDevice];
      }
      dragSrcIdx = null;
      saveParts();
    });
  });
}

// ── Render labour rate editor ─────────────────────────────────────────────────
function renderRates() {
  let html = "";
  Object.entries(labourRates).sort((a, b) => a[0].localeCompare(b[0])).forEach(([device, rate]) => {
    html += `<div class="rate-row">
      <span class="rate-name">${esc(device)}</span>
      <span>$</span>
      <input class="rate-input" type="number" min="0" value="${rate}" data-device="${esc(device)}" />
      <button class="btn-del-rate" data-device="${esc(device)}" title="Remove">✕</button>
    </div>`;
  });
  rateListEl.innerHTML = html;

  rateListEl.querySelectorAll(".rate-input").forEach(input => {
    input.addEventListener("change", () => {
      labourRates[input.dataset.device] = parseFloat(input.value) || 0;
      chrome.storage.local.set({ labourRates });
    });
  });
  rateListEl.querySelectorAll(".btn-del-rate").forEach(btn => {
    btn.addEventListener("click", () => {
      delete labourRates[btn.dataset.device];
      chrome.storage.local.set({ labourRates }, renderRates);
    });
  });
}

// ── Rates toggle ──────────────────────────────────────────────────────────────
document.getElementById("btnToggleRates").addEventListener("click", function () {
  const body = document.getElementById("ratesBody");
  const open = body.classList.toggle("open");
  this.classList.toggle("open", open);
});

document.getElementById("btnAddRate").addEventListener("click", () => {
  const name = document.getElementById("newRateName").value.trim();
  const val  = parseFloat(document.getElementById("newRateVal").value) || 0;
  if (!name) return;
  labourRates[name] = val;
  chrome.storage.local.set({ labourRates }, () => {
    document.getElementById("newRateName").value = "";
    document.getElementById("newRateVal").value  = "";
    renderRates();
  });
});

// ── Recalculate totals ────────────────────────────────────────────────────────
function recalc() {
  const partsTotal  = parts.reduce((s, p) => s + p.price * (p.qty || 1), 0);
  const labourTotal = parts.reduce((s, p) => s + (p.labour || 0), 0);
  const shipping    = parseFloat(shippingInput.value) || 0;
  const taxRate     = parseFloat(taxRateInput.value)  || 0;
  const pretax      = partsTotal + labourTotal + shipping;
  const taxAmt      = pretax * (taxRate / 100);
  const grand       = pretax + taxAmt;

  subtotalEl.textContent    = "$" + partsTotal.toFixed(2);
  labourTotalEl.textContent = "$" + labourTotal.toFixed(2);
  pretaxEl.textContent      = "$" + pretax.toFixed(2);
  taxAmtEl.textContent      = "$" + taxAmt.toFixed(2);
  grandEl.textContent       = "$" + grand.toFixed(2);
}

shippingInput.addEventListener("input", () => {
  recalc();
  chrome.storage.local.set({ shippingCost: parseFloat(shippingInput.value) || 0 });
});

taxRateInput.addEventListener("input", () => {
  recalc();
  chrome.storage.local.set({ taxRate: parseFloat(taxRateInput.value) || 0 });
});

// Select all text on focus for easy replacement
taxRateInput.addEventListener("focus", () => taxRateInput.select());

// ── Save parts helper ─────────────────────────────────────────────────────────
function saveParts() {
  chrome.storage.local.set({ estimateParts: parts }, () => {
    renderGroups();
    recalc();
    fqPushKeys("estimateParts").catch(() => {});
  });
}

// ── Customer name auto-save ───────────────────────────────────────────────────
customerInput.addEventListener("input", () => {
  chrome.storage.local.get(["currentJob"], (r) => {
    const job = r.currentJob || {};
    job.customerName = customerInput.value.trim();
    chrome.storage.local.set({ currentJob: job });
  });
});

// ── Save Job → archive to jobHistory ─────────────────────────────────────────
document.getElementById("btnSaveJob").addEventListener("click", () => {
  chrome.storage.local.get(["currentJob", "jobHistory", "estimateParts"], (r) => {
    const job     = r.currentJob    || {};
    const history = r.jobHistory    || [];
    const pts     = r.estimateParts || [];

    if (!pts.length) { toast("Nothing to save — estimate is empty"); return; }

    const partsTotal  = pts.reduce((s, p) => s + p.price * (p.qty || 1), 0);
    const labourTotal = pts.reduce((s, p) => s + (p.labour || 0), 0);
    const shipping    = parseFloat(shippingInput.value) || 0;
    const taxRate     = parseFloat(taxRateInput.value)  || 0;
    const pretax      = partsTotal + labourTotal + shipping;
    const taxAmt      = pretax * (taxRate / 100);

    const record = {
      id:           job.id || Date.now(),
      customerName: job.customerName || "Unnamed",
      createdAt:    job.createdAt    || Date.now(),
      savedAt:      Date.now(),
      parts:        JSON.parse(JSON.stringify(pts)),
      shipping, taxRate,
      totals:       { partsTotal, labourTotal, shipping, pretax, taxAmt, grand: pretax + taxAmt }
    };

    const existingIdx = history.findIndex(h => h.id === job.id);
    if (existingIdx >= 0) history[existingIdx] = record;
    else { job.id = record.id; history.unshift(record); }

    chrome.storage.local.set({ jobHistory: history, currentJob: job }, () => {
      toast("✅ Job saved");
      fqPushKeys("jobHistory", "currentJob").catch(() => {});
    });
  });
});

// ── New Job (Clear) ───────────────────────────────────────────────────────────
document.getElementById("btnClear").addEventListener("click", () => {
  if (!confirm("Start a new job? Unsaved changes will be lost.")) return;
  const newJob = { id: Date.now(), customerName: "", createdAt: Date.now() };
  chrome.storage.local.set({ estimateParts: [], currentJob: newJob }, () => {
    parts = []; customerInput.value = "";
    renderGroups(); recalc();
    toast("New job started");
  });
});

// ── Open full tab ─────────────────────────────────────────────────────────────
document.getElementById("btnOpenTab").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("fullpage.html") });
});

// ── Grab from active tab ──────────────────────────────────────────────────────
document.getElementById("btnGrabPage").addEventListener("click", () => {
  openManualForm();
  showGrabStatus("⏳ Reading page…");
  chrome.runtime.sendMessage({ action: "grabFromPage" }, (resp) => {
    if (chrome.runtime.lastError || resp?.error || !resp?.data) {
      showGrabStatus("⚠️ Could not read product info. Fill in manually.");
      return;
    }
    const d = resp.data;
    mfName.value  = d.name  || "";
    mfPrice.value = parseFloat(d.price) > 0 ? parseFloat(d.price).toFixed(2) : "";
    if (d.name) {
      const detected = detectDeviceClient(d.name);
      if (detected) {
        [...mfDevice.options].forEach((o, i) => { if (o.value === detected) mfDevice.selectedIndex = i; });
      }
    }
    showGrabStatus("✅ Grabbed! Review and click Add.");
    mfName.focus();
  });
});

// ── Manual Add toggle ─────────────────────────────────────────────────────────
const btnManualAdd = document.getElementById("btnManualAdd");
btnManualAdd.addEventListener("click", () => {
  if (manualForm.classList.contains("open")) closeManualForm();
  else { openManualForm(); mfName.focus(); }
});

function openManualForm() {
  manualForm.classList.add("open");
  btnManualAdd.textContent = "✕ Cancel";
}
function closeManualForm() {
  manualForm.classList.remove("open");
  btnManualAdd.textContent = "✏️ Add Manually";
  grabStatus.style.display = "none";
  mfName.value = ""; mfPrice.value = ""; mfDevice.selectedIndex = 0;
}
function showGrabStatus(msg) {
  grabStatus.textContent   = msg;
  grabStatus.style.display = "block";
}

document.getElementById("btnMfCancel").addEventListener("click", closeManualForm);

// ── Manual form submit ────────────────────────────────────────────────────────
document.getElementById("btnMfAdd").addEventListener("click", () => {
  const name  = mfName.value.trim();
  const price = parseFloat(mfPrice.value);
  if (!name)                  { mfName.focus();  toast("Enter a part name");   return; }
  if (isNaN(price)||price < 0){ mfPrice.focus(); toast("Enter a valid price"); return; }

  const device = mfDevice.value === "Other / Unknown" ? null : mfDevice.value;
  chrome.runtime.sendMessage({
    action: "addPart",
    part: { name, price, source: "manual", url: null, detectedDevice: device }
  }, () => {
    toast(`Added: ${name}`);
    closeManualForm();
  });
});

// ── Client-side device detection ──────────────────────────────────────────────
function detectDeviceClient(name) {
  if (!name) return null;
  const RULES = [
    [/iphone/i,          "iPhone"       ],
    [/ipad\s*pro/i,      "iPad Pro"     ],
    [/ipad/i,            "iPad"         ],
    [/macbook/i,         "MacBook"      ],
    [/samsung|galaxy/i,  "Samsung"      ],
    [/pixel/i,           "Google Pixel" ],
    [/oneplus/i,         "OnePlus"      ],
    [/motorola|moto\s/i, "Motorola"     ],
    [/\blg\b/i,          "LG"           ],
    [/huawei/i,          "Huawei"       ],
    [/sony/i,            "Sony"         ],
    [/nokia/i,           "Nokia"        ],
  ];
  for (const [rx, dev] of RULES) { if (rx.test(name)) return dev; }
  return null;
}

// ── Copy estimate ─────────────────────────────────────────────────────────────
document.getElementById("btnCopy").addEventListener("click", () => {
  if (!parts.length) { toast("Nothing to copy"); return; }
  const customer = customerInput.value.trim();
  let text = customer ? `Estimate for: ${customer}\n\n` : "Repair Estimate\n\n";
  const groups = buildGroups();
  for (const [device, items] of Object.entries(groups)) {
    text += `${device}\n`;
    items.forEach(p => {
      const qty = p.qty || 1;
      text += `  ${p.name} — $${(p.price * qty).toFixed(2)}`;
      if (qty > 1) text += ` (x${qty})`;
      if (p.labour > 0) text += ` + Labour $${p.labour.toFixed(2)}`;
      text += "\n";
    });
    text += "\n";
  }
  const partsTotal  = parts.reduce((s, p) => s + p.price * (p.qty || 1), 0);
  const labourTotal = parts.reduce((s, p) => s + (p.labour || 0), 0);
  const shipping    = parseFloat(shippingInput.value) || 0;
  const taxRate     = parseFloat(taxRateInput.value)  || 0;
  const pretax      = partsTotal + labourTotal + shipping;
  const taxAmt      = pretax * taxRate / 100;
  text += `Parts:    $${partsTotal.toFixed(2)}\n`;
  text += `Labour:   $${labourTotal.toFixed(2)}\n`;
  if (shipping > 0) text += `Shipping: $${shipping.toFixed(2)}\n`;
  text += `Tax (${taxRate}%): $${taxAmt.toFixed(2)}\n`;
  text += `TOTAL:    $${(pretax + taxAmt).toFixed(2)}`;
  navigator.clipboard.writeText(text).then(() => toast("Copied!")).catch(() => toast("Copy failed"));
});

// ── Print → open fullpage ─────────────────────────────────────────────────────
document.getElementById("btnPrint").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("fullpage.html") + "?print=1" });
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Auth overlay ──────────────────────────────────────────────────────────────
let _authMode = "signin";

function showAuthOverlay() {
  document.getElementById("authOverlay").classList.remove("hidden");
}
function hideAuthOverlay() {
  document.getElementById("authOverlay").classList.add("hidden");
}
function setAuthError(msg) {
  const el = document.getElementById("authError");
  if (msg) { el.textContent = msg; el.style.display = "block"; }
  else      { el.style.display = "none"; }
}

document.querySelectorAll(".auth-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    _authMode = btn.dataset.mode;
    document.querySelectorAll(".auth-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("btnAuthSubmit").textContent =
      _authMode === "signin" ? "Sign In" : "Create Account";
    // Update autocomplete so password managers know whether to save or fill
    document.getElementById("authPassword").autocomplete =
      _authMode === "signin" ? "current-password" : "new-password";
    setAuthError(null);
  });
});

document.getElementById("btnShowPw").addEventListener("click", () => {
  const inp = document.getElementById("authPassword");
  inp.type  = inp.type === "password" ? "text" : "password";
});

// Form submit handles both keyboard Enter and button click
document.getElementById("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const btn      = document.getElementById("btnAuthSubmit");
  if (!email || !password) { setAuthError("Please enter your email and password."); return; }
  btn.disabled = true; btn.textContent = "Please wait…";
  try {
    if (_authMode === "signin") await fqSignIn(email, password);
    else                        await fqSignUp(email, password);
    await onAuthSuccess();
  } catch (err) {
    setAuthError(err.message);
    btn.disabled = false;
    btn.textContent = _authMode === "signin" ? "Sign In" : "Create Account";
  }
});

document.getElementById("btnGoogleSignIn").addEventListener("click", async () => {
  const btn = document.getElementById("btnGoogleSignIn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    await fqGoogleSignIn();
    await onAuthSuccess();
  } catch (e) {
    setAuthError(e.message);
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 48 48" style="width:18px;height:18px"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.5 2.7 13.5l7.8 6.1C12.4 13.2 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17z"/><path fill="#FBBC05" d="M10.5 28.4A14.8 14.8 0 0 1 9.5 24c0-1.5.3-3 .7-4.4L2.4 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.2 0-11.5-4.2-13.4-9.8l-7.9 6.1C6.5 42.4 14.6 48 24 48z"/></svg> Continue with Google`;
  }
});

// ── Continue as Guest ─────────────────────────────────────────────────────────
document.getElementById("btnContinueGuest").addEventListener("click", () => {
  chrome.storage.local.set({ fqGuestMode: true }, () => {
    isGuestMode = true;
    hideAuthOverlay();
    document.getElementById("guestBanner").style.display = "flex";
    loadAll();
    toast("👤 Continuing as guest");
  });
});

// Sign In Now from guest banner
document.getElementById("btnSignInNow").addEventListener("click", () => {
  document.getElementById("guestBanner").style.display = "none";
  showAuthOverlay();
});

async function onAuthSuccess() {
  isGuestMode = false;
  await chrome.storage.local.remove(["fqGuestMode"]);
  const sess = await fqGetSession();
  if (!sess) return;
  document.getElementById("guestBanner").style.display = "none";
  customerInput.placeholder = `${sess.displayName} · Job #…`;
  await fqSyncFromCloud();
  hideAuthOverlay();
  addSignOutBtn(sess);
  loadAll();
}

// ── Sign out button (added dynamically to header) ─────────────────────────────
function addSignOutBtn(sess) {
  if (document.getElementById("btnSignOut")) return;
  const btn = document.createElement("button");
  btn.id = "btnSignOut";
  btn.className = "btn-hdr";
  btn.title = sess?.email || "Sign out";
  btn.textContent = "↩";
  btn.style.fontSize = "13px";
  btn.addEventListener("click", async () => {
    if (!confirm("Sign out?")) return;
    await fqSignOut();
    isGuestMode = false;
    showAuthOverlay();
  });
  document.querySelector(".header-top").appendChild(btn);
}

// ── Support button → opens Feedback tab in full page ─────────────────────────
document.getElementById("btnSupport").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("fullpage.html") + "?tab=feedback" });
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  fqInitAuthUI();

  // Check for existing session first
  const sess = await fqGetSession();
  if (sess) {
    customerInput.placeholder = `${sess.displayName} · Job #…`;
    addSignOutBtn(sess);
    await fqSyncFromCloud();
    loadAll();
    return;
  }

  // Check for guest mode
  const { fqGuestMode } = await chrome.storage.local.get(["fqGuestMode"]);
  if (fqGuestMode) {
    isGuestMode = true;
    document.getElementById("guestBanner").style.display = "flex";
    loadAll();
    return;
  }

  // Show auth
  showAuthOverlay();
})();
