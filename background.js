// ── Repair Estimator – Background Service Worker ──────────────────────────────

// ── Device detection rules (ordered: most specific first) ─────────────────────
const DEVICE_RULES = [
  { pattern: /iphone/i,          device: "iPhone"       },
  { pattern: /ipad\s*pro/i,      device: "iPad Pro"     },
  { pattern: /ipad/i,            device: "iPad"         },
  { pattern: /macbook/i,         device: "MacBook"      },
  { pattern: /samsung|galaxy/i,  device: "Samsung"      },
  { pattern: /pixel/i,           device: "Google Pixel" },
  { pattern: /oneplus/i,         device: "OnePlus"      },
  { pattern: /motorola|moto\s/i, device: "Motorola"     },
  { pattern: /\blg\b/i,          device: "LG"           },
  { pattern: /huawei/i,          device: "Huawei"       },
  { pattern: /sony/i,            device: "Sony"         },
  { pattern: /nokia/i,           device: "Nokia"        },
];

function detectDevice(partName) {
  if (!partName) return null;
  for (const rule of DEVICE_RULES) {
    if (rule.pattern.test(partName)) return rule.device;
  }
  return null;
}

// ── Default labour rates ───────────────────────────────────────────────────────
const DEFAULT_LABOUR = {
  "iPhone":        100,
  "iPad":          100,
  "iPad Pro":      130,
  "MacBook":       150,
  "Samsung":        85,
  "Google Pixel":   80,
  "OnePlus":        75,
  "Motorola":       65,
  "LG":             70,
  "Huawei":         70,
  "Sony":           70,
  "Nokia":          60,
};

// ── Open side panel on icon click ─────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── On install: register context menu + seed storage ──────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-estimate",
    title: "Add to Repair Estimate",
    contexts: ["selection", "page"]
  });

  chrome.storage.local.get(["labourRates"], (result) => {
    if (!result.labourRates) {
      chrome.storage.local.set({ labourRates: DEFAULT_LABOUR });
    }
  });
});

// ── Context menu: add from selection or page detection ────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "add-to-estimate") return;

  const selectedText = info.selectionText || "";
  const priceMatch = selectedText.match(/\$?\s*([\d,]+\.?\d*)/);

  if (priceMatch) {
    const price = parseFloat(priceMatch[1].replace(/,/g, ""));
    const name = selectedText.replace(/\$?\s*[\d,]+\.?\d*/, "").trim() || "Part (selected)";
    addPart({ name, price, source: new URL(tab.url).hostname }, tab.id);
  } else {
    chrome.tabs.sendMessage(tab.id, { action: "detectAndAdd" }, (response) => {
      if (chrome.runtime.lastError || !response?.part) return;
      addPart(response.part, tab.id);
    });
  }
});

// ── Message handler ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "addPart") {
    addPart(message.part, sender.tab?.id);
    sendResponse({ success: true });
    return;
  }

  // Grab product name + price from whatever tab is currently active
  if (message.action === "grabFromPage") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) { sendResponse({ error: "No active tab" }); return; }
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content
            || document.querySelector('meta[property="og:price:amount"]')?.content
            || document.querySelector('meta[itemprop="price"]')?.content;
          const metaName = document.querySelector('meta[property="og:title"]')?.content
            || document.querySelector('meta[name="twitter:title"]')?.content;
          let jPrice = null, jName = null;
          for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const d = JSON.parse(el.textContent);
              const offers = d.offers || (Array.isArray(d) && d[0]?.offers);
              if (offers) {
                jPrice = (Array.isArray(offers) ? offers[0] : offers).price;
                jName  = d.name || d[0]?.name;
              }
            } catch (_) {}
          }
          const domPrice = document.querySelector('[itemprop="price"]')?.getAttribute("content")
            || document.querySelector('[itemprop="price"]')?.innerText;
          const h1 = document.querySelector('h1')?.innerText?.trim().substring(0, 120);
          return {
            name:  metaName || jName || h1 || document.title.substring(0, 120),
            price: metaPrice || jPrice || domPrice,
            url:   location.href,
            source: location.hostname.replace("www.", "")
          };
        }
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]?.result) {
          sendResponse({ error: "Could not read page" }); return;
        }
        sendResponse({ data: results[0].result });
      });
    });
    return true; // async
  }

  if (message.action === "saveLabourRate") {
    chrome.storage.local.get(["labourRates"], (result) => {
      const rates = result.labourRates || {};
      rates[message.device] = message.rate;
      chrome.storage.local.set({ labourRates: rates }, () => sendResponse({ success: true }));
    });
    return true;
  }

  if (message.action === "clearEstimate") {
    chrome.storage.local.set({ estimateParts: [] }, () => sendResponse({ success: true }));
    return true;
  }

  if (message.action === "removePart") {
    chrome.storage.local.get(["estimateParts"], (result) => {
      const parts = result.estimateParts || [];
      parts.splice(message.index, 1);
      chrome.storage.local.set({ estimateParts: parts }, () => sendResponse({ success: true }));
    });
    return true;
  }
});

// ── Core: add a part with auto device detection + per-part default labour ──────
function addPart(part, tabId) {
  const detectedDevice = detectDevice(part.name);

  chrome.storage.local.get(["estimateParts", "labourRates"], (result) => {
    const parts = result.estimateParts || [];
    const rates = result.labourRates   || {};

    // Learn a new device+rate if this device isn't known yet
    if (detectedDevice && !(detectedDevice in rates)) {
      rates[detectedDevice] = DEFAULT_LABOUR[detectedDevice] || 80;
      chrome.storage.local.set({ labourRates: rates });
    }

    // Default labour: full device rate for the FIRST part of this device,
    // 0 for any additional parts (same device already has labour covered).
    const alreadyHaveDevice = detectedDevice &&
      parts.some(p => p.detectedDevice === detectedDevice);
    const defaultLabour = (!alreadyHaveDevice && detectedDevice)
      ? (rates[detectedDevice] || 0)
      : 0;

    parts.push({ ...part, detectedDevice, labour: defaultLabour, addedAt: Date.now() });
    chrome.storage.local.set({ estimateParts: parts }, () => {
      chrome.runtime.sendMessage({
        action: "partsUpdated",
        detectedDevice
      }).catch(() => {});
    });
  });
}
