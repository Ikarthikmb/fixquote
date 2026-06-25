// ── FixQuote – Auth + Firestore (Firebase REST API, no SDK required) ──────────

const _AUTH = "https://identitytoolkit.googleapis.com/v1";
const _TOK  = "https://securetoken.googleapis.com/v1/token";
const _FS   = () =>
  `https://firestore.googleapis.com/v1/projects/${window.FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// ── Session management ────────────────────────────────────────────────────────

function _checkConfig() {
  if (!window.FIREBASE_CONFIG?.apiKey || window.FIREBASE_CONFIG.apiKey.includes("YOUR_API_KEY")) {
    throw new Error("Firebase not configured yet. Open firebase-config.js and add your apiKey and projectId.");
  }
}

// Hide Google button if OAuth client ID isn't configured yet
function fqInitAuthUI() {
  const googleBtn = document.getElementById("btnGoogleSignIn");
  const divider   = document.querySelector(".auth-divider");
  if (!googleBtn) return;
  const configured = window.GOOGLE_CLIENT_ID &&
    !window.GOOGLE_CLIENT_ID.includes("YOUR_CLIENT_ID");
  if (!configured) {
    googleBtn.style.display = "none";
    if (divider) divider.style.display = "none";
  }
}

async function fqSignIn(email, password) {
  _checkConfig();
  const res = await fetch(`${_AUTH}/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const d = await res.json();
  if (d.error) throw new Error(_friendlyErr(d.error.message));
  return _storeSession(d);
}

async function fqSignUp(email, password) {
  _checkConfig();
  const res = await fetch(`${_AUTH}/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const d = await res.json();
  if (d.error) throw new Error(_friendlyErr(d.error.message));
  return _storeSession(d);
}

async function fqGoogleSignIn() {
  // Guard: catch unconfigured placeholders before hitting Chrome's OAuth
  if (!window.GOOGLE_CLIENT_ID || window.GOOGLE_CLIENT_ID.includes("YOUR_CLIENT_ID")) {
    throw new Error(
      "Google Sign-In needs a one-time setup. Open firebase-config.js and add your Google OAuth Client ID, then reload the extension."
    );
  }
  if (!window.FIREBASE_CONFIG?.apiKey || window.FIREBASE_CONFIG.apiKey.includes("YOUR_API_KEY")) {
    throw new Error("Firebase not configured yet. Fill in firebase-config.js first.");
  }

  return new Promise((resolve, reject) => {
    if (!chrome.identity) { reject(new Error("Google sign-in not available in this context.")); return; }
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Google sign-in failed: " + chrome.runtime.lastError.message));
        return;
      }
      try {
        const res = await fetch(`${_AUTH}/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestUri: "https://localhost",
            postBody: `access_token=${token}&providerId=google.com`,
            returnSecureToken: true
          })
        });
        const d = await res.json();
        if (d.error) throw new Error(_friendlyErr(d.error.message));
        resolve(await _storeSession(d));
      } catch (e) { reject(e); }
    });
  });
}

async function fqSignOut() {
  await chrome.storage.local.remove(["fqSession"]);
}

async function fqGetSession() {
  const { fqSession: s } = await chrome.storage.local.get(["fqSession"]);
  if (!s) return null;
  if (Date.now() > s.expiresAt - 120_000) return _refreshSession(s.refreshToken, s);
  return s;
}

async function _storeSession(d) {
  const s = {
    uid:          d.localId,
    email:        d.email,
    displayName:  d.displayName || d.email?.split("@")[0] || "User",
    idToken:      d.idToken,
    refreshToken: d.refreshToken,
    expiresAt:    Date.now() + (parseInt(d.expiresIn || "3600") * 1000)
  };
  await chrome.storage.local.set({ fqSession: s });
  return s;
}

async function _refreshSession(refreshToken, existing) {
  try {
    const res = await fetch(`${_TOK}?key=${FIREBASE_CONFIG.apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken })
    });
    const d = await res.json();
    if (d.error) { await fqSignOut(); return null; }
    const s = { ...existing, idToken: d.id_token, refreshToken: d.refresh_token,
      expiresAt: Date.now() + (parseInt(d.expires_in) * 1000) };
    await chrome.storage.local.set({ fqSession: s });
    return s;
  } catch { await fqSignOut(); return null; }
}

function _friendlyErr(msg = "") {
  const MAP = {
    "EMAIL_NOT_FOUND":             "No account found with this email.",
    "INVALID_PASSWORD":            "Incorrect password.",
    "INVALID_LOGIN_CREDENTIALS":   "Incorrect email or password.",
    "USER_DISABLED":               "This account has been disabled.",
    "EMAIL_EXISTS":                "An account already exists with this email.",
    "WEAK_PASSWORD":               "Password must be at least 6 characters.",
    "INVALID_EMAIL":               "Please enter a valid email address.",
    "TOO_MANY_ATTEMPTS_TRY_LATER": "Too many attempts. Try again later.",
    "CONFIGURATION_NOT_FOUND":     "Firebase not configured. Fill in firebase-config.js.",
  };
  for (const [k, v] of Object.entries(MAP)) { if (msg.includes(k)) return v; }
  if (msg.includes("YOUR_API_KEY")) return "Firebase not configured. Fill in firebase-config.js.";
  return msg;
}

// ── Firestore REST helpers ─────────────────────────────────────────────────────

function _toV(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")  return { doubleValue: v };
  if (typeof v === "string")  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(_toV) } };
  if (typeof v === "object")  return { mapValue: { fields: _toF(v) } };
  return { stringValue: String(v) };
}
function _toF(obj)   { const f = {}; for (const [k,v] of Object.entries(obj)) f[k] = _toV(v); return f; }
function _fromV(v)   {
  if ("nullValue"    in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue"  in v) return v.doubleValue;
  if ("stringValue"  in v) return v.stringValue;
  if ("arrayValue"   in v) return (v.arrayValue.values || []).map(_fromV);
  if ("mapValue"     in v) return _fromF(v.mapValue.fields || {});
  return null;
}
function _fromF(fields) { const o = {}; for (const [k,v] of Object.entries(fields)) o[k] = _fromV(v); return o; }

async function _fsHeaders() {
  const s = await fqGetSession();
  if (!s) return null;
  return { Authorization: `Bearer ${s.idToken}`, "Content-Type": "application/json", _uid: s.uid };
}

async function fsGet(relPath) {
  const h = await _fsHeaders(); if (!h) return null;
  const { _uid, ...headers } = h;
  const res = await fetch(`${_FS()}/users/${_uid}/${relPath}`, { headers });
  if (!res.ok) return null;
  const doc = await res.json();
  return doc.fields ? _fromF(doc.fields) : null;
}

async function fsSet(relPath, data) {
  const h = await _fsHeaders(); if (!h) return;
  const { _uid, ...headers } = h;
  await fetch(`${_FS()}/users/${_uid}/${relPath}`, {
    method: "PATCH", headers,
    body: JSON.stringify({ fields: _toF(data) })
  });
}

// ── Data sync: one document per user ──────────────────────────────────────────
// Path: users/{uid}/data/main

async function fqSyncFromCloud() {
  try {
    const cloud = await fsGet("data/main");
    if (!cloud) return;
    const local = {};
    if (cloud.labourRates)  local.labourRates   = cloud.labourRates;
    if (cloud.estimateParts !== undefined) local.estimateParts = cloud.estimateParts;
    if (cloud.jobHistory    !== undefined) local.jobHistory    = cloud.jobHistory;
    if (cloud.currentJob    !== undefined) local.currentJob    = cloud.currentJob;
    if (cloud.taxRate       !== undefined) local.taxRate       = cloud.taxRate;
    if (cloud.shippingCost  !== undefined) local.shippingCost  = cloud.shippingCost;
    if (cloud.markupPct     !== undefined) local.markupPct     = cloud.markupPct;
    if (Object.keys(local).length) await chrome.storage.local.set(local);
  } catch (e) { console.warn("FixQuote cloud sync failed:", e); }
}

async function fqPushToCloud(updates) {
  try { await fsSet("data/main", updates); }
  catch (e) { console.warn("FixQuote cloud push failed:", e); }
}

// Push the keys that changed to Firestore
async function fqPushKeys(...keys) {
  const data = await chrome.storage.local.get(keys);
  const payload = {};
  for (const k of keys) { if (data[k] !== undefined) payload[k] = data[k]; }
  if (Object.keys(payload).length) await fqPushToCloud(payload);
}

// ── Admin / global Firestore helpers ──────────────────────────────────────────
// These operate on arbitrary paths (not user-scoped) — for admin use

// List all documents in a top-level collection
async function fsListCollection(collPath) {
  const h = await _fsHeaders();
  if (!h) return [];
  const { _uid, ...headers } = h;
  try {
    const res = await fetch(`${_FS()}/${collPath}?pageSize=200`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`[fsListCollection] ${res.status} on ${collPath}:`, err);
      return [];
    }
    const data = await res.json();
    return (data.documents || []).map(doc => ({
      id: doc.name.split("/").pop(),
      ...(doc.fields ? _fromF(doc.fields) : {})
    }));
  } catch { return []; }
}

// Get a document by absolute Firestore path (e.g. "supportTickets/uid123")
async function fsAbsGet(path) {
  const h = await _fsHeaders();
  if (!h) return null;
  const { _uid, ...headers } = h;
  try {
    const res = await fetch(`${_FS()}/${path}`, { headers });
    if (!res.ok) return null;
    const doc = await res.json();
    return doc.fields ? _fromF(doc.fields) : null;
  } catch { return null; }
}

// Set / merge a document by absolute path — throws on HTTP error
async function fsAbsSet(path, data) {
  const h = await _fsHeaders();
  if (!h) throw new Error("Not authenticated");
  const { _uid, ...headers } = h;
  const res = await fetch(`${_FS()}/${path}`, {
    method: "PATCH", headers,
    body: JSON.stringify({ fields: _toF(data) })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || res.status;
    console.warn(`[fsAbsSet] ${res.status} on ${path}:`, err);
    throw new Error(`Write failed (${msg}) — check Firestore rules`);
  }
}

// ── Per-ticket support system ──────────────────────────────────────────────────
// Path: supportTickets/{uid}  — one Firestore doc per user, contains tickets[]
// Each ticket: { id, category, subject, status, messages[], createdAt, updatedAt }

function _genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Create a new ticket and append to the user's doc; returns ticketId
async function fqCreateTicket(category, subject, messageText) {
  const sess = await fqGetSession();
  if (!sess) throw new Error("Not signed in");
  const existing = await fsAbsGet(`supportTickets/${sess.uid}`) || {};
  const tickets  = existing.tickets || [];
  const now      = Date.now();
  const ticketId = _genId();
  tickets.push({
    id:        ticketId,
    category,
    subject:   subject || messageText.slice(0, 72),
    status:    "open",
    messages:  [{ type: "user", text: messageText, ts: now, by: sess.email }],
    createdAt: now,
    updatedAt: now
  });
  await fsAbsSet(`supportTickets/${sess.uid}`, {
    uid: sess.uid, email: sess.email,
    displayName: sess.displayName || sess.email,
    tickets, updatedAt: now
  });
  return ticketId;
}

// Return the signed-in user's own tickets sorted newest-first
async function fqGetUserTickets() {
  const sess = await fqGetSession();
  if (!sess) return [];
  const doc = await fsAbsGet(`supportTickets/${sess.uid}`);
  return (doc?.tickets || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// User adds a follow-up message to one of their tickets
async function fqUserReply(ticketId, text) {
  const sess = await fqGetSession();
  if (!sess) throw new Error("Not signed in");
  const existing = await fsAbsGet(`supportTickets/${sess.uid}`);
  if (!existing) throw new Error("Ticket doc not found");
  const tickets = existing.tickets || [];
  const idx = tickets.findIndex(t => t.id === ticketId);
  if (idx === -1) throw new Error("Ticket not found");
  const now = Date.now();
  tickets[idx].messages = [...(tickets[idx].messages || []),
    { type: "user", text, ts: now, by: sess.email }];
  tickets[idx].updatedAt = now;
  if (tickets[idx].status === "resolved") tickets[idx].status = "open";
  await fsAbsSet(`supportTickets/${sess.uid}`, { ...existing, tickets, updatedAt: now });
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

// Flatten all tickets from all user docs into one sorted array (admin use)
async function fsListAllTickets() {
  const userDocs = await fsListCollection("supportTickets");
  const flat = [];
  for (const doc of userDocs) {
    for (const t of (doc.tickets || [])) {
      flat.push({ ...t, uid: doc.uid, email: doc.email,
        displayName: doc.displayName || doc.email });
    }
  }
  console.log(`[Admin] ${flat.length} tickets across ${userDocs.length} user(s)`);
  return flat.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Admin replies to a specific ticket
async function fqAdminReply(uid, ticketId, text, adminEmail) {
  const existing = await fsAbsGet(`supportTickets/${uid}`);
  if (!existing) throw new Error("User document not found");
  const tickets = existing.tickets || [];
  const idx = tickets.findIndex(t => t.id === ticketId);
  if (idx === -1) throw new Error("Ticket not found");
  const now = Date.now();
  tickets[idx].messages = [...(tickets[idx].messages || []),
    { type: "admin", text, ts: now, by: adminEmail }];
  tickets[idx].status    = "in_progress";
  tickets[idx].updatedAt = now;
  await fsAbsSet(`supportTickets/${uid}`, { ...existing, tickets, updatedAt: now });
}

// Admin sets ticket status (open / in_progress / resolved)
async function fqAdminSetStatus(uid, ticketId, status) {
  const existing = await fsAbsGet(`supportTickets/${uid}`);
  if (!existing) return;
  const tickets = existing.tickets || [];
  const idx = tickets.findIndex(t => t.id === ticketId);
  if (idx === -1) return;
  tickets[idx].status    = status;
  tickets[idx].updatedAt = Date.now();
  await fsAbsSet(`supportTickets/${uid}`, { ...existing, tickets, updatedAt: Date.now() });
}

// Publisher / admin email — used as a gate for the admin panel
const FQ_ADMIN_EMAIL = "karthikmble@gmail.com";
