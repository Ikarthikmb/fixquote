// ── FixQuote Admin Panel ───────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────
let _allTickets = [];
let _adminSession = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDatetime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
    new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

function avatarLetter(str) {
  return (str || "?").trim()[0].toUpperCase();
}

function statusBadge(status) {
  const labels = { open: "Open", in_progress: "In Progress", resolved: "Resolved" };
  const label = labels[status] || status || "Open";
  return `<span class="badge ${status || "open"}">${label}</span>`;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`).classList.add("active");
    // Lazy-load tab content
    if (tab === "tickets") renderTickets();
    if (tab === "users")   renderUsers();
  });
});

// ── Load all support tickets ───────────────────────────────────────────────────
async function loadTickets() {
  try {
    _allTickets = await fsListAllTickets();
  } catch (e) {
    console.warn("[Admin] Failed to load tickets:", e);
    _allTickets = [];
  }
}

// ── Overview tab ──────────────────────────────────────────────────────────────
async function renderOverview() {
  document.getElementById("overviewRefreshTime").textContent =
    "Last updated: " + fmtDatetime(Date.now());
  await loadTickets();

  const open       = _allTickets.filter(t => (t.status || "open") === "open").length;
  const inProgress = _allTickets.filter(t => t.status === "in_progress").length;
  const resolved   = _allTickets.filter(t => t.status === "resolved").length;
  const total      = _allTickets.length;

  document.getElementById("statOpen").textContent       = open;
  document.getElementById("statInProgress").textContent = inProgress;
  document.getElementById("statResolved").textContent   = resolved;
  document.getElementById("statUsers").textContent      = total;

  // Show 5 most recent tickets
  const recent = _allTickets.slice(0, 5);
  const el = document.getElementById("recentTickets");
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📭</div><h3>No tickets yet</h3><p>Support messages from users will appear here once they submit them via the extension.</p></div>`;
    return;
  }
  el.innerHTML = recent.map(t => ticketCardHtml(t, false)).join("");
  bindTicketCardEvents(el);
}

// ── Tickets tab ───────────────────────────────────────────────────────────────
function renderTickets(tickets) {
  const list = tickets || _allTickets;
  const el   = document.getElementById("ticketList");
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📭</div><h3>No tickets found</h3><p>No support tickets match the current filter.</p></div>`;
    return;
  }
  el.innerHTML = list.map(t => ticketCardHtml(t, true)).join("");
  bindTicketCardEvents(el);
  // Re-expand a specific card after an action
  if (arguments[1]) {
    const card = el.querySelector(`[data-tid="${arguments[1]}"]`);
    if (card) {
      card.classList.add("expanded");
      const thread = card.querySelector(".ticket-thread");
      if (thread) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
    }
  }
}

const CAT_ICONS = { bug: "🐛", feature: "✨", question: "❓", other: "💬", feedback: "📣" };

function ticketCardHtml(ticket, showReply) {
  const msgs      = ticket.messages || [];
  const status    = ticket.status || "open";
  const msgCount  = msgs.length;
  const catIcon   = CAT_ICONS[ticket.category] || "💬";
  const catLabel  = { bug:"Bug Report", feature:"Feature Request", question:"Question", feedback:"Feedback", other:"Other" }[ticket.category] || ticket.category;
  const preview   = ticket.subject || msgs[0]?.text?.replace(/\n/g," ")?.substring(0,80) || "No messages";
  const uid       = esc(ticket.uid || ticket.id);
  const tid       = esc(ticket.id);

  return `<div class="ticket-card status-${esc(status)}" data-uid="${uid}" data-tid="${tid}">
    <div class="ticket-header">
      <div class="ticket-avatar">${catIcon}</div>
      <div class="ticket-user">
        <div class="ticket-email">${esc(ticket.email || ticket.uid || "Unknown")}</div>
        <div class="ticket-preview">${esc(preview)}</div>
      </div>
      <div class="ticket-meta">
        ${statusBadge(status)}
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${catLabel}</div>
        <div class="ticket-date">${fmtDate(ticket.updatedAt || ticket.createdAt)}</div>
        <div class="ticket-msg-count">${msgCount} msg${msgCount !== 1 ? "s" : ""}</div>
      </div>
      <span class="ticket-expand">▼</span>
    </div>
    <div class="ticket-body">
      <div class="ticket-thread">
        ${msgs.length ? msgs.map(m => threadMsgHtml(m)).join("") : `<div style="text-align:center;color:var(--muted);padding:20px;font-size:12px">No messages</div>`}
      </div>
      ${showReply ? `<div class="ticket-actions">
        <input class="reply-input" type="text" placeholder="Write a reply…" data-uid="${uid}" data-tid="${tid}" />
        <button class="btn-reply" data-uid="${uid}" data-tid="${tid}">Reply</button>
        ${status !== "resolved"
          ? `<button class="btn-status resolve" data-uid="${uid}" data-tid="${tid}" data-status="resolved">✓ Resolve</button>`
          : `<button class="btn-status reopen"  data-uid="${uid}" data-tid="${tid}" data-status="open">↩ Reopen</button>`
        }
      </div>` : ""}
    </div>
  </div>`;
}

function threadMsgHtml(m) {
  const typeClass = m.type === "user" ? "user" : m.type === "admin" ? "admin" : "system";
  const who = m.type === "admin" ? `<span style="font-size:10px;font-weight:700;color:var(--orange)">Admin</span><br>` : "";
  return `<div class="thread-msg ${typeClass}">
    <div class="thread-bubble">${who}${esc(m.text).replace(/\n/g, "<br>")}</div>
    <div class="thread-time">${m.ts ? fmtDatetime(m.ts) : ""}</div>
  </div>`;
}

function bindTicketCardEvents(container) {
  // Toggle expand/collapse
  container.querySelectorAll(".ticket-header").forEach(header => {
    header.addEventListener("click", () => {
      const card = header.closest(".ticket-card");
      card.classList.toggle("expanded");
      if (card.classList.contains("expanded")) {
        const thread = card.querySelector(".ticket-thread");
        if (thread) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
      }
    });
  });

  // Reply
  container.querySelectorAll(".btn-reply").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const uid   = btn.dataset.uid;
      const tid   = btn.dataset.tid;
      const input = container.querySelector(`.reply-input[data-tid="${tid}"]`);
      const text  = input?.value?.trim();
      if (!text) return;
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        await fqAdminReply(uid, tid, text, _adminSession?.email || FQ_ADMIN_EMAIL);
        input.value = "";
        toast("✅ Reply sent");
        await loadTickets();
        renderTickets(null, tid); // keep this card expanded
      } catch (err) {
        toast("❌ " + err.message);
      }
      btn.disabled = false; btn.textContent = "Reply";
    });
  });

  // Status change
  container.querySelectorAll(".btn-status").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const uid    = btn.dataset.uid;
      const tid    = btn.dataset.tid;
      const status = btn.dataset.status;
      btn.disabled = true;
      try {
        await fqAdminSetStatus(uid, tid, status);
        toast(`Ticket marked as ${status.replace("_"," ")}`);
        await loadTickets();
        renderTickets(null, tid); // keep this card expanded
        renderOverview();
      } catch (err) {
        toast("❌ " + err.message);
      }
      btn.disabled = false;
    });
  });
}

// Filter/search
let _ticketFilterTimeout;
function setupTicketFilters() {
  const searchEl = document.getElementById("ticketSearch");
  const filterEl = document.getElementById("ticketFilter");

  function applyFilter() {
    const q      = searchEl.value.trim().toLowerCase();
    const status = filterEl.value;
    let filtered = _allTickets;
    if (status !== "all") filtered = filtered.filter(t => (t.status || "open") === status);
    if (q) filtered = filtered.filter(t =>
      (t.email || "").toLowerCase().includes(q) ||
      (t.subject || "").toLowerCase().includes(q) ||
      (t.messages || []).some(m => m.text?.toLowerCase().includes(q))
    );
    renderTickets(filtered);
  }

  searchEl.addEventListener("input", () => {
    clearTimeout(_ticketFilterTimeout);
    _ticketFilterTimeout = setTimeout(applyFilter, 250);
  });
  filterEl.addEventListener("change", applyFilter);
}

// ── Users tab ─────────────────────────────────────────────────────────────────
function renderUsers(filterTickets) {
  const flat = filterTickets || _allTickets;
  // Group flat tickets by uid
  const usersMap = new Map();
  for (const t of flat) {
    if (!usersMap.has(t.uid)) {
      usersMap.set(t.uid, { uid: t.uid, email: t.email, displayName: t.displayName, count: 0, lastActive: 0 });
    }
    const u = usersMap.get(t.uid);
    u.count++;
    if ((t.updatedAt || 0) > u.lastActive) u.lastActive = t.updatedAt || 0;
  }
  const users = [...usersMap.values()].sort((a, b) => (a.email || "").localeCompare(b.email || ""));
  const el = document.getElementById("userList");

  if (!users.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">👥</div><h3>No users yet</h3><p>Users appear here after submitting their first support ticket.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="user-table">
      <div class="user-table-header">
        <div>User</div><div>Email</div><div>Tickets</div><div>Last Active</div>
      </div>
      ${users.map(u => `<div class="user-row">
        <div class="user-name">${esc(u.displayName || u.email?.split("@")[0] || "Unknown")}</div>
        <div class="user-email-cell">${esc(u.email || u.uid || "—")}</div>
        <div>${u.count} ticket${u.count !== 1 ? "s" : ""}</div>
        <div style="color:var(--muted);font-size:12px">${fmtDate(u.lastActive)}</div>
      </div>`).join("")}
    </div>`;

  const searchEl = document.getElementById("userSearch");
  // Remove old listener by replacing element clone
  const fresh = searchEl.cloneNode(true);
  searchEl.replaceWith(fresh);
  fresh.addEventListener("input", () => {
    const q = fresh.value.trim().toLowerCase();
    renderUsers(!q ? null : _allTickets.filter(t =>
      (t.email || "").toLowerCase().includes(q) ||
      (t.displayName || "").toLowerCase().includes(q)
    ));
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await chrome.storage.local.get([
    "settingGuestMode", "settingCloudSync", "settingAutoDetect",
    "settingDefaultTax", "settingDefaultMarkup", "settingSupportEmail"
  ]);
  if (data.settingGuestMode  !== undefined) document.getElementById("settingGuestMode").checked  = data.settingGuestMode;
  if (data.settingCloudSync  !== undefined) document.getElementById("settingCloudSync").checked  = data.settingCloudSync;
  if (data.settingAutoDetect !== undefined) document.getElementById("settingAutoDetect").checked = data.settingAutoDetect;
  if (data.settingDefaultTax      !== undefined) document.getElementById("settingDefaultTax").value      = data.settingDefaultTax;
  if (data.settingDefaultMarkup   !== undefined) document.getElementById("settingDefaultMarkup").value   = data.settingDefaultMarkup;
  if (data.settingSupportEmail    !== undefined) document.getElementById("settingSupportEmail").value    = data.settingSupportEmail;

  // Show version + Firebase project
  const manifest = chrome.runtime.getManifest();
  document.getElementById("extVersion").textContent = manifest.version || "—";
  document.getElementById("fbProject").textContent  = window.FIREBASE_CONFIG?.projectId || "Not configured";
}

document.getElementById("btnSaveSettings").addEventListener("click", () => {
  const settings = {
    settingGuestMode:     document.getElementById("settingGuestMode").checked,
    settingCloudSync:     document.getElementById("settingCloudSync").checked,
    settingAutoDetect:    document.getElementById("settingAutoDetect").checked,
    settingDefaultTax:    parseFloat(document.getElementById("settingDefaultTax").value) || 7,
    settingDefaultMarkup: parseFloat(document.getElementById("settingDefaultMarkup").value) || 0,
    settingSupportEmail:  document.getElementById("settingSupportEmail").value.trim() || "support@fixquote.app",
  };
  chrome.storage.local.set(settings, () => toast("✅ Settings saved"));
});

document.getElementById("btnExportTickets").addEventListener("click", () => {
  if (!_allTickets.length) { toast("No tickets to export"); return; }
  const json = JSON.stringify(_allTickets, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `fixquote-tickets-${Date.now()}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast("Export downloaded");
});

document.getElementById("btnOpenFirebase").addEventListener("click", () => {
  const pid = window.FIREBASE_CONFIG?.projectId;
  if (!pid || pid.includes("YOUR_PROJECT")) { toast("Firebase not configured yet"); return; }
  chrome.tabs.create({ url: `https://console.firebase.google.com/project/${pid}/firestore` });
});

// ── Refresh buttons ───────────────────────────────────────────────────────────
document.getElementById("btnRefreshOverview").addEventListener("click", renderOverview);
document.getElementById("btnRefreshTickets").addEventListener("click", async () => {
  await loadTickets(); renderTickets();
  toast("Tickets refreshed");
});
document.getElementById("btnRefreshUsers").addEventListener("click", async () => {
  await loadTickets(); renderUsers();
  toast("Users refreshed");
});

// ── Auth overlay ──────────────────────────────────────────────────────────────
function showAuthOverlay() {
  document.getElementById("authOverlay").classList.remove("hidden");
  document.getElementById("authBox").style.display = "";
  document.getElementById("accessDenied").style.display = "none";
}
function hideAuthOverlay() {
  document.getElementById("authOverlay").classList.add("hidden");
}
function showAccessDenied() {
  document.getElementById("authOverlay").classList.remove("hidden");
  document.getElementById("authBox").style.display = "none";
  document.getElementById("accessDenied").style.display = "";
}
function setAuthError(msg) {
  const el = document.getElementById("authError");
  if (msg) { el.textContent = msg; el.style.display = "block"; }
  else      { el.style.display = "none"; }
}

document.getElementById("btnShowPw").addEventListener("click", () => {
  const inp = document.getElementById("authPassword");
  inp.type = inp.type === "password" ? "text" : "password";
});

document.getElementById("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const btn      = document.getElementById("btnAuthSubmit");
  if (!email || !password) { setAuthError("Enter your email and password."); return; }
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    await fqSignIn(email, password);
    const sess = await fqGetSession();
    if (!sess) throw new Error("Sign-in failed.");
    if (sess.email !== FQ_ADMIN_EMAIL) {
      await fqSignOut();
      showAccessDenied();
      return;
    }
    await onAdminReady(sess);
  } catch (err) {
    setAuthError(err.message);
    btn.disabled = false; btn.textContent = "Sign In to Admin";
  }
});

document.getElementById("btnBackToSignIn").addEventListener("click", () => {
  document.getElementById("authBox").style.display = "";
  document.getElementById("accessDenied").style.display = "none";
  document.getElementById("authEmail").value = "";
  document.getElementById("authPassword").value = "";
  setAuthError(null);
});

document.getElementById("btnAdminSignOut").addEventListener("click", async () => {
  if (!confirm("Sign out of admin?")) return;
  await fqSignOut();
  showAuthOverlay();
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function onAdminReady(sess) {
  _adminSession = sess;
  document.getElementById("adminEmailDisplay").textContent = sess.email;
  hideAuthOverlay();
  await Promise.all([loadSettings(), renderOverview()]);
  setupTicketFilters();
}

(async () => {
  fqInitAuthUI();
  const sess = await fqGetSession();

  if (!sess) {
    showAuthOverlay();
    // Pre-fill publisher email for convenience
    document.getElementById("authEmail").value = FQ_ADMIN_EMAIL;
    document.getElementById("authPassword").focus();
    return;
  }

  if (sess.email !== FQ_ADMIN_EMAIL) {
    showAccessDenied();
    return;
  }

  await onAdminReady(sess);
})();
