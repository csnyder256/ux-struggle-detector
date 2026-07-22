"use strict";
var ClarusHeal = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/sdk/index.ts
  var index_exports = {};
  __export(index_exports, {
    initSelfHealing: () => initSelfHealing,
    renderIntervention: () => renderIntervention
  });

  // src/lib/types/events.ts
  var EVENT_SCHEMA_VERSION = 2;
  var DEFAULT_STRUGGLE_RULES = {
    rageClick: { minClicks: 3, windowMs: 2e3 },
    deadClick: {
      /** Click on element with no handler and no role; must dwell here this long without nav. */
      dwellMs: 1500
    },
    misClick: {
      /** Two clicks <300ms apart with cursor moving N pixels = mis-click. */
      proximityPx: 80,
      intervalMs: 300
    },
    thrash: { minChanges: 5, windowMs: 4e3 },
    backtrack: {
      /** Net length grew then shrank then grew this many times. */
      cycles: 3,
      windowMs: 8e3
    },
    validationLoop: {
      /** Submit → validation_error → submit → validation_error pattern this many cycles. */
      cycles: 2
    },
    abandonedField: {
      /** Focused, typed at least one char, then went idle this long without blur+submit. */
      idleMs: 3e4
    },
    pasteRepeat: {
      /** Multiple pastes on the same field within window. */
      minPastes: 2,
      windowMs: 5e3
    },
    requiredMissed: {
      /* triggered by VALIDATION_ERROR meta */
    },
    formatError: {
      /* triggered by VALIDATION_ERROR meta with format issue */
    },
    passwordRetry: { minFailures: 2 },
    slowFill: {
      /** Single field receiving sparse keystrokes over a long span. */
      windowMs: 6e4,
      minDuration: 3e4
    },
    loop: { repeats: 3 },
    silentFail: { windowMs: 8e3 },
    backThrash: { minBackEvents: 3, windowMs: 5e3 },
    deadEnd: {
      /** Navigated to a route, no further events for this long. */
      idleMs: 2e4
    },
    quickBounce: { dwellMs: 1500 },
    circularNav: {
      /** A→B→A→B alternation count. */
      cycles: 2
    },
    hoverHunt: { minHovers: 6, windowMs: 4e3 },
    longDwell: { dwellMs: 3e4 },
    rapidScroll: { minScrolls: 5, windowMs: 2e3 },
    scrollOvershoot: { reversals: 3, windowMs: 6e3 },
    idleAfterLoad: { idleMs: 15e3 },
    emptySearch: {},
    repeatSearch: { minRepeats: 2 },
    zeroResults: {},
    failedFilter: {},
    menuThrash: { minToggles: 3, windowMs: 5e3 },
    tooltipHoverRepeat: { minHovers: 3 },
    tabHopping: { minSwitches: 3, windowMs: 8e3 },
    errorDismiss: { minDismisses: 2 },
    retryLoop: { minRetries: 2 },
    notFoundBounce: { dwellMs: 3e3 },
    jsError: {},
    loginFailure: {},
    lockedOut: { minFailures: 5 },
    keyboardLostFocus: {},
    copyBounce: {
      /** Copy event then nav within window. */
      windowMs: 5e3
    },
    helpHunt: {}
  };

  // src/lib/types/ui-map.ts
  async function hashElementId(inputs) {
    const canonical = `${inputs.orgId}:${inputs.filePath}:${inputs.nodeDescriptor}`;
    const data = new TextEncoder().encode(canonical);
    const buf = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(buf).slice(0, 16);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `sh_${hex}`;
  }
  function isElementId(value) {
    return /^sh_[0-9a-f]{32}$/.test(value);
  }

  // src/sdk/element-id.ts
  var MAX_DEPTH = 20;
  function describeNode(el) {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.parentElement && depth < MAX_DEPTH) {
      const tag = cur.tagName.toLowerCase();
      let idx = 0;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${tag}[${idx}]`);
      cur = cur.parentElement;
      if (cur === document.body) break;
      depth++;
    }
    return parts.join(">");
  }
  async function resolveElementId(orgId, el) {
    const attr = el.getAttribute("data-sh-id");
    if (attr && isElementId(attr)) return attr;
    const filePath = window.location.pathname;
    const nodeDescriptor = describeNode(el);
    return hashElementId({ orgId, filePath, nodeDescriptor });
  }

  // src/sdk/scrubber.ts
  var DEFAULT_PATTERNS = [
    // email
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    // 13–19 digit credit-card-shaped runs (allowing spaces or dashes)
    /\b(?:\d[ -]?){13,19}\b/g,
    // SSN
    /\b\d{3}-\d{2}-\d{4}\b/g
  ];
  function scrubText(text, extra = []) {
    let out = text;
    for (const re of [...DEFAULT_PATTERNS, ...extra]) {
      out = out.replace(re, "[redacted]");
    }
    return out;
  }

  // src/sdk/event-buffer.ts
  var STORAGE_KEY = "__sh_buf_v1__";
  var MAX_BUFFERED = 200;
  var EventBuffer = class {
    constructor() {
      __publicField(this, "inMem", []);
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) this.inMem = parsed;
        }
      } catch {
        this.inMem = [];
      }
    }
    push(e) {
      this.inMem.push(e);
      if (this.inMem.length > MAX_BUFFERED) {
        this.inMem = this.inMem.slice(-MAX_BUFFERED);
      }
      this.persist();
    }
    drain() {
      const out = this.inMem;
      this.inMem = [];
      this.persist();
      return out;
    }
    size() {
      return this.inMem.length;
    }
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.inMem));
      } catch {
      }
    }
  };

  // src/sdk/transport.ts
  var Transport = class {
    constructor(orgId, endpoint, buffer, clockOffsetMs = 0, onInterventions) {
      this.orgId = orgId;
      this.endpoint = endpoint;
      this.buffer = buffer;
      this.clockOffsetMs = clockOffsetMs;
      this.onInterventions = onInterventions;
    }
    async flush() {
      const events = this.buffer.drain();
      if (events.length === 0) return { sent: 0 };
      const body = {
        schemaVersion: EVENT_SCHEMA_VERSION,
        clockOffsetMs: this.clockOffsetMs,
        events
      };
      if (this.endpoint === "console") {
        console.log("[clarus-heal] flush", body);
        return { sent: events.length };
      }
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Org-Id": this.orgId
          },
          body: JSON.stringify(body),
          keepalive: true
        });
        if (!res.ok) {
          for (const e of events) this.buffer.push(e);
          return { sent: 0, error: `HTTP ${res.status}` };
        }
        let response = null;
        try {
          response = await res.json();
        } catch {
        }
        const interventions = response?.interventions ?? [];
        if (interventions.length > 0 && this.onInterventions) {
          try {
            this.onInterventions(interventions);
          } catch {
          }
        }
        return { sent: events.length, interventions };
      } catch (err) {
        for (const e of events) this.buffer.push(e);
        return { sent: 0, error: err.message };
      }
    }
  };

  // src/sdk/struggle-detector.ts
  var RageClickDetector = class {
    constructor() {
      __publicField(this, "clicks", []);
    }
    observe(elementId) {
      const now = Date.now();
      const cutoff = now - DEFAULT_STRUGGLE_RULES.rageClick.windowMs;
      this.clicks = this.clicks.filter((c) => c.ts >= cutoff);
      this.clicks.push({ elementId, ts: now });
      const onSame = this.clicks.filter((c) => c.elementId === elementId);
      if (onSame.length >= DEFAULT_STRUGGLE_RULES.rageClick.minClicks) {
        this.clicks = [];
        return { detected: true, type: "RAGE_CLICK", elementId };
      }
      return { detected: false };
    }
  };

  // src/sdk/renderers.ts
  var ROOT_ID = "__sh_root__";
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  var Z = {
    spotlight: 999990,
    ring: 999992,
    card: 999995,
    banner: 999996,
    modal: 999998,
    arrow: 999993
  };
  var REDUCED = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var shown = /* @__PURE__ */ new Set();
  var outcomeCallback = null;
  function setOutcomeCallback(cb) {
    outcomeCallback = cb;
  }
  function reportOutcome(id, outcome) {
    try {
      outcomeCallback?.(id, outcome);
    } catch {
    }
  }
  function root() {
    let el = document.getElementById(ROOT_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = ROOT_ID;
      Object.assign(el.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: String(Z.spotlight)
      });
      const style = document.createElement("style");
      style.textContent = `
      @keyframes __sh_pulse__ {
        0%   { box-shadow: 0 0 0 0 rgba(59,130,246,.55), 0 0 0 0 rgba(59,130,246,.4); }
        70%  { box-shadow: 0 0 0 14px rgba(59,130,246,0),  0 0 0 24px rgba(59,130,246,0); }
        100% { box-shadow: 0 0 0 0 rgba(59,130,246,0),    0 0 0 0 rgba(59,130,246,0); }
      }
      @keyframes __sh_in__   { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes __sh_flash__ { 0%,100% { background:transparent } 50% { background: rgba(250,204,21,.35) } }
      .__sh_card__ { animation: __sh_in__ 180ms ease-out both; }
      .__sh_pulse__ { animation: __sh_pulse__ 1.6s cubic-bezier(.66,0,0,1) infinite; }
      .__sh_flash__ { animation: __sh_flash__ 1.2s ease-in-out 2; }
    `;
      document.head.appendChild(style);
      document.body.appendChild(el);
    }
    return el;
  }
  function renderIntervention(d) {
    if (shown.has(d.id)) return;
    shown.add(d.id);
    reportOutcome(d.id, "shown");
    const target = d.targetElementId ? findElement(d.targetElementId) : null;
    if (target) {
      const handler = () => {
        reportOutcome(d.id, "success");
        target.removeEventListener("click", handler, true);
      };
      target.addEventListener("click", handler, { capture: true, once: true });
      window.setTimeout(() => target.removeEventListener("click", handler, true), 3e4);
    }
    const ttl = typeof d.autoDismissMs === "number" && d.autoDismissMs > 0 ? d.autoDismissMs : 8e3;
    switch (d.type) {
      case "OVERLAY":
        return renderOverlay(d, ttl);
      case "HIGHLIGHT":
        return renderHighlight(target, d, ttl);
      case "SPOTLIGHT":
        return renderSpotlight(target, d, ttl);
      case "TOOLTIP":
        return renderTooltip(target, d, ttl);
      case "MODAL":
        return renderModal(d);
      case "BANNER":
        return renderBanner(d, ttl);
      case "INLINE_HINT":
        return renderInlineHint(target, d, ttl);
      case "TOUR":
        return renderTour(d);
      case "ICON_FLASH":
        return renderIconFlash(target, ttl);
      case "ARROW":
        return renderArrow(target, d, ttl);
      case "CONFIRM":
        return renderConfirm(d);
      case "ANNOUNCE":
        return renderAnnounce(d);
      default:
        console.warn("[clarus-heal] unknown intervention render type:", d.type);
    }
  }
  function findElement(id) {
    return document.querySelector(`[data-sh-id="${id}"]`);
  }
  function makeDismissBtn(onDismiss, interventionId) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", "Dismiss");
    Object.assign(b.style, {
      flexShrink: "0",
      border: "0",
      background: "transparent",
      cursor: "pointer",
      color: "#6b7280",
      fontSize: "18px",
      lineHeight: "1",
      padding: "0 4px"
    });
    b.textContent = "\xD7";
    b.addEventListener("click", () => {
      if (interventionId) reportOutcome(interventionId, "dismissed");
      onDismiss();
    });
    return b;
  }
  function autoCleanup(el, ms) {
    if (ms <= 0) return;
    window.setTimeout(() => el.remove(), ms);
  }
  function flashRing(target, kind) {
    const rect = target.getBoundingClientRect();
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "fixed",
      left: `${rect.left - 4}px`,
      top: `${rect.top - 4}px`,
      width: `${rect.width + 8}px`,
      height: `${rect.height + 8}px`,
      border: kind === "glow" ? "0" : "2px solid #3b82f6",
      borderRadius: "8px",
      pointerEvents: "none",
      zIndex: String(Z.ring),
      boxShadow: kind === "glow" ? "0 0 30px 4px rgba(59,130,246,0.55)" : "0 0 0 4px rgba(59,130,246,0.25)",
      transition: "opacity 200ms"
    });
    if (kind === "pulse" && !REDUCED) ring.className = "__sh_pulse__";
    return ring;
  }
  function renderOverlay(d, ttl) {
    const card = document.createElement("div");
    card.className = "__sh_card__";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    Object.assign(card.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      maxWidth: "360px",
      background: "white",
      color: "#111827",
      border: "1px solid #e5e7eb",
      borderRadius: "10px",
      padding: "14px 14px 14px 16px",
      boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
      fontFamily: FONT,
      fontSize: "14px",
      lineHeight: "1.5",
      zIndex: String(Z.card),
      pointerEvents: "auto"
    });
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", alignItems: "flex-start", gap: "8px" });
    const text = document.createElement("div");
    text.style.flex = "1";
    text.innerHTML = decodeHtml(d.copy);
    const dismiss = makeDismissBtn(() => card.remove(), d.id);
    row.appendChild(text);
    row.appendChild(dismiss);
    card.appendChild(row);
    root().appendChild(card);
    autoCleanup(card, ttl);
  }
  function renderHighlight(target, d, ttl) {
    if (!target) return;
    const style = typeof d.options?.style === "string" && (d.options.style === "glow" || d.options.style === "spotlight") ? d.options.style : "pulse";
    const ring = flashRing(target, style);
    root().appendChild(ring);
    if (d.copy) {
      renderOverlay({ ...d, autoDismissMs: ttl }, ttl);
    }
    autoCleanup(ring, ttl);
  }
  function renderSpotlight(target, d, ttl) {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15,23,42,0.55)",
      pointerEvents: "none",
      zIndex: String(Z.spotlight + 1),
      clipPath: `polygon(
      0 0, 100% 0, 100% 100%, 0 100%, 0 0,
      ${rect.left - 6}px ${rect.top - 6}px,
      ${rect.left - 6}px ${rect.bottom + 6}px,
      ${rect.right + 6}px ${rect.bottom + 6}px,
      ${rect.right + 6}px ${rect.top - 6}px,
      ${rect.left - 6}px ${rect.top - 6}px
    )`
    });
    root().appendChild(overlay);
    const ring = flashRing(target, "pulse");
    root().appendChild(ring);
    if (d.copy) renderOverlay({ ...d, autoDismissMs: ttl }, ttl);
    autoCleanup(overlay, ttl);
    autoCleanup(ring, ttl);
  }
  function renderTooltip(target, d, ttl) {
    if (!target) {
      renderOverlay(d, ttl);
      return;
    }
    const rect = target.getBoundingClientRect();
    const tip = document.createElement("div");
    tip.className = "__sh_card__";
    tip.setAttribute("role", "tooltip");
    tip.innerHTML = decodeHtml(d.copy);
    Object.assign(tip.style, {
      position: "fixed",
      background: "#111827",
      color: "white",
      padding: "8px 12px",
      borderRadius: "6px",
      fontFamily: FONT,
      fontSize: "13px",
      maxWidth: "280px",
      zIndex: String(Z.card),
      pointerEvents: "auto",
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)"
    });
    const tipTop = rect.bottom + 8;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, rect.left))}px`;
    tip.style.top = `${tipTop > window.innerHeight - 60 ? rect.top - 50 : tipTop}px`;
    root().appendChild(tip);
    const ring = flashRing(target, "pulse");
    root().appendChild(ring);
    autoCleanup(tip, ttl);
    autoCleanup(ring, ttl);
  }
  function renderModal(d) {
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15,23,42,0.55)",
      zIndex: String(Z.modal),
      pointerEvents: "auto",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      fontFamily: FONT
    });
    const card = document.createElement("div");
    card.className = "__sh_card__";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    Object.assign(card.style, {
      background: "white",
      color: "#111827",
      borderRadius: "12px",
      padding: "24px",
      maxWidth: "440px",
      width: "100%",
      boxShadow: "0 24px 64px rgba(0,0,0,0.35)"
    });
    if (d.title) {
      const h = document.createElement("h2");
      h.textContent = d.title;
      Object.assign(h.style, { fontSize: "18px", fontWeight: "600", margin: "0 0 8px" });
      card.appendChild(h);
    }
    const body = document.createElement("div");
    body.innerHTML = decodeHtml(d.copy);
    body.style.fontSize = "14px";
    body.style.lineHeight = "1.5";
    card.appendChild(body);
    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "8px",
      justifyContent: "flex-end",
      marginTop: "16px"
    });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Got it";
    Object.assign(close.style, {
      padding: "8px 14px",
      borderRadius: "6px",
      border: "0",
      background: "#111827",
      color: "white",
      fontSize: "14px",
      fontWeight: "500",
      cursor: "pointer"
    });
    close.addEventListener("click", () => backdrop.remove());
    actions.appendChild(close);
    card.appendChild(actions);
    backdrop.appendChild(card);
    root().appendChild(backdrop);
  }
  function renderBanner(d, ttl) {
    const bg = d.options?.severity === "error" ? "#fee2e2" : d.options?.severity === "warning" ? "#fef3c7" : "#dbeafe";
    const fg = d.options?.severity === "error" ? "#991b1b" : d.options?.severity === "warning" ? "#854d0e" : "#1e3a8a";
    const banner = document.createElement("div");
    banner.className = "__sh_card__";
    banner.setAttribute("role", "status");
    Object.assign(banner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      background: bg,
      color: fg,
      padding: "10px 16px",
      fontFamily: FONT,
      fontSize: "14px",
      zIndex: String(Z.banner),
      pointerEvents: "auto",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      borderBottom: "1px solid rgba(0,0,0,0.08)"
    });
    const text = document.createElement("div");
    text.style.flex = "1";
    text.innerHTML = decodeHtml(d.copy);
    banner.appendChild(text);
    banner.appendChild(makeDismissBtn(() => banner.remove(), d.id));
    root().appendChild(banner);
    autoCleanup(banner, ttl);
  }
  function renderInlineHint(target, d, ttl) {
    if (!target) {
      renderOverlay(d, ttl);
      return;
    }
    const rect = target.getBoundingClientRect();
    const hint = document.createElement("div");
    hint.className = "__sh_card__";
    hint.innerHTML = decodeHtml(d.copy);
    Object.assign(hint.style, {
      position: "fixed",
      background: "#fef3c7",
      color: "#854d0e",
      padding: "4px 8px",
      borderRadius: "4px",
      fontFamily: FONT,
      fontSize: "12px",
      fontWeight: "500",
      maxWidth: "300px",
      left: `${rect.left}px`,
      top: `${rect.bottom + 4}px`,
      zIndex: String(Z.card),
      pointerEvents: "auto",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
    });
    root().appendChild(hint);
    autoCleanup(hint, ttl);
  }
  function renderTour(d) {
    renderModal({ ...d, type: "MODAL" });
  }
  function renderIconFlash(target, ttl) {
    if (!target) return;
    const original = target.style.transition;
    target.style.transition = "background 200ms";
    target.classList.add("__sh_flash__");
    window.setTimeout(() => {
      target.classList.remove("__sh_flash__");
      target.style.transition = original;
    }, ttl > 0 ? ttl : 2400);
  }
  function renderArrow(target, d, ttl) {
    if (!target) {
      renderOverlay(d, ttl);
      return;
    }
    const rect = target.getBoundingClientRect();
    const arrow = document.createElement("div");
    arrow.textContent = "\u2193";
    Object.assign(arrow.style, {
      position: "fixed",
      left: `${rect.left + rect.width / 2 - 12}px`,
      top: `${rect.top - 36}px`,
      fontSize: "28px",
      color: "#3b82f6",
      fontWeight: "bold",
      zIndex: String(Z.arrow),
      pointerEvents: "none",
      textShadow: "0 2px 6px rgba(59,130,246,0.5)"
    });
    if (!REDUCED) {
      arrow.style.transition = "transform 600ms ease-in-out";
      let up = false;
      const interval = window.setInterval(() => {
        arrow.style.transform = up ? "translateY(0)" : "translateY(-6px)";
        up = !up;
      }, 600);
      window.setTimeout(() => window.clearInterval(interval), ttl > 0 ? ttl : 6e3);
    }
    root().appendChild(arrow);
    if (d.copy) renderOverlay(d, ttl);
    autoCleanup(arrow, ttl > 0 ? ttl : 6e3);
  }
  function renderConfirm(d) {
    renderOverlay(d, 0);
  }
  function renderAnnounce(d) {
    const region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute(
      "aria-live",
      d.options?.level === "assertive" ? "assertive" : "polite"
    );
    region.style.position = "absolute";
    region.style.left = "-9999px";
    region.textContent = stripHtml(d.copy);
    root().appendChild(region);
    window.setTimeout(() => region.remove(), 4e3);
  }
  function decodeHtml(s) {
    return s.replace(/&rsquo;/g, "\u2019").replace(/&lsquo;/g, "\u2018").replace(/&ldquo;/g, "\u201C").replace(/&rdquo;/g, "\u201D").replace(/&hellip;/g, "\u2026").replace(/&amp;/g, "&").replace(/&nbsp;/g, "\xA0");
  }
  function stripHtml(s) {
    return decodeHtml(s).replace(/<[^>]+>/g, "");
  }

  // src/sdk/index.ts
  var initialized = false;
  function initSelfHealing(opts) {
    if (initialized) return;
    initialized = true;
    try {
      initInner(opts);
    } catch (err) {
      console.warn("[clarus-heal] init failed:", err);
    }
  }
  function initInner(opts) {
    const endpoint = opts.endpoint ?? "/api/events";
    const flushIntervalMs = opts.flushIntervalMs ?? 4e3;
    const sessionId = ensureSessionId();
    const disabled = new Set(opts.disableEventTypes ?? []);
    const buffer = new EventBuffer();
    const transport = new Transport(opts.orgId, endpoint, buffer, 0, (interventions) => {
      for (const interv of interventions) renderIntervention(interv);
    });
    const rage = new RageClickDetector();
    setOutcomeCallback((interventionId, outcome) => {
      void emit("CUSTOM", null, {
        kind: `intervention_${outcome}`,
        iid: interventionId
      });
    });
    function makeIdempotencyKey() {
      const rand = Math.random().toString(36).slice(2, 10);
      return `${sessionId}_${Date.now()}_${rand}`;
    }
    async function emit(eventType, el, meta) {
      if (disabled.has(eventType)) return null;
      let elementId = null;
      if (el) {
        try {
          elementId = await resolveElementId(opts.orgId, el);
        } catch {
          elementId = null;
        }
      }
      const event = {
        schemaVersion: EVENT_SCHEMA_VERSION,
        idempotencyKey: makeIdempotencyKey(),
        sessionId,
        userIdHash: null,
        elementId,
        route: location.pathname,
        eventType,
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        meta
      };
      buffer.push(event);
      return event;
    }
    document.addEventListener(
      "click",
      (e) => {
        const target = e.target;
        if (!target) return;
        const interactive = target.closest(
          'button, a, input, select, textarea, [role="button"], [data-sh-id]'
        ) ?? target;
        const meta = {};
        if (interactive.disabled) meta.disabled = true;
        if (!hasHandler(interactive)) meta.dead = true;
        const role = inferRole(interactive);
        if (role) meta.role = role;
        void emit("CLICK", interactive, meta).then((ev) => {
          if (!ev) return;
          const result = rage.observe(ev.elementId);
          if (result.detected && opts.enableLocalDemoOverlays) {
            renderIntervention({
              id: `local_${Date.now()}`,
              type: "HIGHLIGHT",
              targetElementId: ev.elementId,
              copy: "Looks like you&rsquo;re having trouble with this. Take a breath \u2014 we&rsquo;re working on it.",
              options: { style: "pulse" },
              autoDismissMs: 6e3
            });
          }
        });
      },
      { capture: true, passive: true }
    );
    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target;
        const meta = {};
        if (form) {
          const kind = form.getAttribute("data-sh-form-kind");
          if (kind) meta.kind = kind;
          const empty = formIsEmpty(form);
          if (empty) meta.empty = true;
        }
        void emit("SUBMIT", form, meta);
      },
      { capture: true, passive: true }
    );
    let inputDebounce;
    const inputElementMeta = /* @__PURE__ */ new Map();
    document.addEventListener(
      "input",
      (e) => {
        const target = e.target;
        if (!target) return;
        window.clearTimeout(inputDebounce);
        inputDebounce = window.setTimeout(() => {
          const value = scrubText(target.value ?? "", opts.piiPatterns);
          const length = value.length;
          const prev = inputElementMeta.get(target)?.lastLength ?? 0;
          inputElementMeta.set(target, { lastLength: length });
          void emit("INPUT_CHANGE", target, { length, delta: length - prev });
        }, 300);
      },
      { capture: true, passive: true }
    );
    document.addEventListener(
      "focus",
      (e) => {
        const target = e.target;
        if (!target || !(target instanceof Element)) return;
        void emit("FOCUS", target);
      },
      { capture: true, passive: true }
    );
    document.addEventListener(
      "blur",
      (e) => {
        const target = e.target;
        if (!target || !(target instanceof Element)) return;
        void emit("BLUR", target);
      },
      { capture: true, passive: true }
    );
    document.addEventListener("paste", (e) => {
      void emit("PASTE", e.target);
    }, { capture: true, passive: true });
    document.addEventListener("copy", (e) => {
      void emit("COPY", e.target);
    }, { capture: true, passive: true });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Tab" && e.key !== "Escape" && e.key !== "Enter") return;
        void emit("KEY_DOWN", e.target, { key: e.key });
      },
      { capture: true, passive: true }
    );
    let hoverTimer;
    let lastHoverEl = null;
    document.addEventListener(
      "mouseover",
      (e) => {
        const target = e.target;
        if (!target) return;
        const interactive = target.closest('button, a, input, select, [role="button"], [title], [data-sh-id]');
        if (!interactive || interactive === lastHoverEl) return;
        lastHoverEl = interactive;
        window.clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => {
          const meta = {};
          if (interactive.hasAttribute("title")) meta.tooltip = true;
          void emit("HOVER", interactive, meta);
        }, 250);
      },
      { capture: true, passive: true }
    );
    let scrollLastTs = 0;
    let scrollLastY = window.scrollY;
    window.addEventListener(
      "scroll",
      () => {
        const now = Date.now();
        if (now - scrollLastTs < 200) return;
        scrollLastTs = now;
        const dy = window.scrollY - scrollLastY;
        scrollLastY = window.scrollY;
        void emit("SCROLL", null, { dy });
      },
      { capture: false, passive: true }
    );
    let lastInteractEl = null;
    let lastInteractTs = Date.now();
    document.addEventListener(
      "mousemove",
      () => {
        lastInteractTs = Date.now();
      },
      { capture: false, passive: true }
    );
    window.setInterval(() => {
      const dwellMs = Date.now() - lastInteractTs;
      if (dwellMs >= 3e4) {
        void emit("DWELL", lastInteractEl, { ms: dwellMs });
      }
    }, 3e4);
    document.addEventListener(
      "mousemove",
      (e) => {
        const t = e.target;
        if (t) lastInteractEl = t;
      },
      { capture: false, passive: true }
    );
    window.addEventListener("error", (e) => {
      void emit("JS_ERROR", null, {
        message: e.message ?? "unknown",
        filename: e.filename ?? "",
        lineno: e.lineno ?? 0
      });
    });
    window.addEventListener("unhandledrejection", (e) => {
      void emit("JS_ERROR", null, {
        message: String(e.reason ?? "unhandled rejection")
      });
    });
    document.addEventListener("clarus-heal:validation", (e) => {
      const detail = e.detail ?? {};
      void emit("VALIDATION_ERROR", detail.element ?? null, {
        kind: detail.kind ?? "format",
        field: detail.field ?? ""
      });
    });
    window.addEventListener("blur", () => {
      void emit("BLUR", null, { target: "window" });
    });
    window.addEventListener("focus", () => {
      void emit("FOCUS", null, { target: "window" });
    });
    void emit("NAVIGATION", null, { trigger: "initial" });
    window.addEventListener("popstate", () => {
      void emit("NAVIGATION", null, { trigger: "popstate" });
    });
    const _pushState = history.pushState.bind(history);
    history.pushState = function(data, unused, url) {
      _pushState(data, unused, url);
      void emit("NAVIGATION", null, { trigger: "pushstate" });
    };
    window.setInterval(() => void transport.flush(), flushIntervalMs);
    window.addEventListener("beforeunload", () => {
      void transport.flush();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void transport.flush();
    });
  }
  function ensureSessionId() {
    const KEY = "__sh_sid_v1__";
    try {
      const existing = sessionStorage.getItem(KEY);
      if (existing) return existing;
    } catch {
    }
    const id = `sh_sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      sessionStorage.setItem(KEY, id);
    } catch {
    }
    return id;
  }
  function hasHandler(el) {
    const tag = el.tagName.toLowerCase();
    if (["button", "a", "input", "select", "textarea", "form"].includes(tag)) return true;
    if (el.hasAttribute("onclick") || el.hasAttribute("role")) return true;
    if (el.hasAttribute("data-sh-id")) return true;
    return false;
  }
  function inferRole(el) {
    const cls = (el.getAttribute("class") ?? "").toLowerCase();
    const label = (el.textContent ?? "").toLowerCase();
    if (cls.includes("dismiss") || cls.includes("close") || /×|✕/.test(label)) return "dismiss";
    if (cls.includes("retry") || /retry|try again/.test(label)) return "retry";
    if (/^help|support|contact/.test(label) || cls.includes("help")) return "help";
    if (cls.includes("menu") || el.hasAttribute("aria-haspopup")) return "menu";
    return null;
  }
  function formIsEmpty(form) {
    for (const el of Array.from(form.elements)) {
      const e = el;
      if (!e.name) continue;
      if (e.type === "submit" || e.type === "button" || e.type === "hidden") continue;
      if (e.value && e.value.trim().length > 0) return false;
    }
    return true;
  }
  return __toCommonJS(index_exports);
})();
