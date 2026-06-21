// ── Repair Estimator – Content Script ─────────────────────────────────────────

(function () {
  "use strict";

  // ── Universal helpers (work across all sites) ──────────────────────────────

  /** Read Open Graph / meta price tags – most reliable on JS-heavy stores */
  function metaPrice() {
    const amount = document.querySelector('meta[property="product:price:amount"]')?.content
      || document.querySelector('meta[property="og:price:amount"]')?.content
      || document.querySelector('meta[itemprop="price"]')?.content
      || document.querySelector('meta[name="twitter:data1"]')?.content;
    return parsePrice(amount);
  }

  /** Read JSON-LD structured data for price */
  function jsonLdPrice() {
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(el.textContent);
        const offers = data.offers || (Array.isArray(data) && data[0]?.offers);
        if (offers) {
          const price = Array.isArray(offers) ? offers[0]?.price : offers.price;
          if (price) return parseFloat(price);
        }
      } catch (_) {}
    }
    return null;
  }

  /** Read Open Graph / meta title tags */
  function metaName() {
    return document.querySelector('meta[property="og:title"]')?.content?.trim()
      || document.querySelector('meta[name="twitter:title"]')?.content?.trim()
      || null;
  }

  // ── Site-specific scrapers ─────────────────────────────────────────────────

  const SCRAPERS = {
    "phonelcdparts.com": {
      // Hyva/Magento — price rendered via Alpine.js, meta tag is the ground truth
      name: () =>
        qs("h1.page-title span.base, h1[data-ui-id], h1")?.innerText?.trim()
        || metaName(),
      price: () =>
        metaPrice()
        ?? jsonLdPrice()
        ?? parsePrice(qs("[data-price-type='finalPrice'] [data-price-amount], .price-final_price .price, .product-info-price .price, [class*='price-box'] .price")?.innerText)
    },
    "mobilesentrix.com": {
      // Also Magento — same strategy
      name: () =>
        qs("h1.page-title span, h1[itemprop='name'], h1")?.innerText?.trim()
        || metaName(),
      price: () =>
        metaPrice()
        ?? jsonLdPrice()
        ?? parsePrice(qs("[data-price-type='finalPrice'] .price, .price-final_price .price, .price-wrapper .price")?.innerText)
    },
    "ebay.com": {
      name: () =>
        qs("h1.x-item-title__mainTitle span, .x-item-title__mainTitle, h1")
          ?.innerText?.trim()?.replace(/^Details about\s*/i, "")
        || metaName(),
      price: () => {
        // eBay renders price in multiple ways depending on listing type
        const el = qs(".x-price-primary [itemprop='price'], .x-price-primary span[aria-hidden='true'], .x-price-primary, #prcIsum, #mm-saleDscPrc, .vi-price .notranslate");
        return parsePrice(el?.getAttribute("content") || el?.innerText)
          ?? metaPrice()
          ?? jsonLdPrice();
      }
    }
  };

  function getScraper() {
    const host = location.hostname.replace("www.", "");
    for (const [domain, scraper] of Object.entries(SCRAPERS)) {
      if (host.includes(domain)) return scraper;
    }
    return null;
  }

  function qs(selector) {
    const els = selector.split(",").map(s => document.querySelector(s.trim())).filter(Boolean);
    return els[0] || null;
  }

  function parsePrice(text) {
    if (text == null || text === "") return null;
    // Handle plain numbers from meta[content] attributes
    const n = parseFloat(String(text).replace(/[^0-9.]/g, ""));
    return isNaN(n) || n === 0 ? null : n;
  }

  function detectPart() {
    const scraper = getScraper();
    if (!scraper) return null;
    const name = scraper.name();
    const price = scraper.price();
    if (!name || price == null || isNaN(price)) return null;
    return {
      name: name.substring(0, 120),
      price,
      source: location.hostname.replace("www.", ""),
      url: location.href
    };
  }

  // ── Floating "Add to Estimate" button ─────────────────────────────────────

  let floatingBtn = null;
  let feedbackTimer = null;

  function createFloatingButton() {
    if (floatingBtn) return;
    const scraper = getScraper();
    if (!scraper) return;

    floatingBtn = document.createElement("div");
    floatingBtn.id = "re-float-btn";
    floatingBtn.innerHTML = `
      <span class="re-icon">🛒</span>
      <span class="re-label">Add to Estimate</span>
    `;
    floatingBtn.title = "Add this part to your repair estimate";
    document.body.appendChild(floatingBtn);

    floatingBtn.addEventListener("click", () => addCurrentPart());

    // Drag support
    makeDraggable(floatingBtn);
  }

  function makeDraggable(el) {
    let startX, startY, startLeft, startTop, dragging = false;

    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      el.style.transition = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startLeft + dx)) + "px";
      el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, startTop + dy)) + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });

    document.addEventListener("mouseup", () => { dragging = false; });
  }

  // ── Extension context guard ────────────────────────────────────────────────
  // Returns false (and cleans up) if the extension has been reloaded/invalidated.

  function contextAlive() {
    try {
      // Accessing chrome.runtime.id throws if the context is gone
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  function teardown() {
    if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }
    if (observer)    { observer.disconnect(); observer = null; }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function addCurrentPart() {
    if (!contextAlive()) { teardown(); return; }
    const part = detectPart();
    if (!part) {
      showFeedback("⚠️ Couldn't detect part/price", "error");
      return;
    }
    try {
      chrome.runtime.sendMessage({ action: "addPart", part }, () => {
        if (chrome.runtime.lastError) return; // panel not open yet — silent
        showFeedback(`✅ Added: $${part.price.toFixed(2)}`, "success");
      });
    } catch (_) {
      teardown();
    }
  }

  function showFeedback(msg, type) {
    if (!floatingBtn) return;
    clearTimeout(feedbackTimer);
    floatingBtn.querySelector(".re-label").textContent = msg;
    floatingBtn.classList.toggle("re-success", type === "success");
    floatingBtn.classList.toggle("re-error", type === "error");
    feedbackTimer = setTimeout(() => {
      if (floatingBtn) {
        floatingBtn.querySelector(".re-label").textContent = "Add to Estimate";
        floatingBtn.classList.remove("re-success", "re-error");
      }
    }, 2500);
  }

  // ── Listen for context menu "detect and add" ───────────────────────────────

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "detectAndAdd") {
        const part = detectPart();
        sendResponse({ part });
      }
    });
  } catch (_) { /* context already gone at inject time — very unlikely */ }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    if (!contextAlive()) { teardown(); return; }
    createFloatingButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Re-run on SPA navigation (eBay/Sentrix use client-side routing)
  let lastUrl = location.href;
  let observer = new MutationObserver(() => {
    if (!contextAlive()) { teardown(); return; }
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }
      setTimeout(init, 800);
    }
  });
  observer.observe(document, { subtree: true, childList: true });
})();
