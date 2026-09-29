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

  // src/sdk/script-entry.ts
  var script_entry_exports = {};
  __export(script_entry_exports, {
    destroySelfHealing: () => destroySelfHealing,
    flush: () => flush,
    identify: () => identify,
    initSelfHealing: () => initSelfHealing,
    readAutoInitOptions: () => readAutoInitOptions,
    renderIntervention: () => renderIntervention,
    startTour: () => startTour,
    track: () => track
  });

  // src/lib/types/events.ts
  var EVENT_SCHEMA_VERSION = 3;
  var MAX_ROUTE_LENGTH = 2048;
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

  // src/sdk/route.ts
  function routeFromLocation(loc) {
    const hash = loc.hash;
    const hashRoute = hash.startsWith("#!/") ? hash.slice(2) : hash.startsWith("#/") ? hash.slice(1) : null;
    if (hashRoute === null) return clamp(loc.pathname || "/");
    const end = hashRoute.search(/[?#]/);
    const route = end === -1 ? hashRoute : hashRoute.slice(0, end);
    return clamp(route || "/");
  }
  function clamp(route) {
    return route.length > MAX_ROUTE_LENGTH ? route.slice(0, MAX_ROUTE_LENGTH) : route;
  }
  var NavigationTracker = class {
    constructor(initial) {
      __publicField(this, "lastRoute");
      this.lastRoute = routeFromLocation(initial);
    }
    shouldRecord(trigger, loc) {
      const route = routeFromLocation(loc);
      const changed = route !== this.lastRoute;
      this.lastRoute = route;
      if (trigger === "replacestate" || trigger === "hashchange") return changed;
      return true;
    }
  };
  function classifyPopstate(lastNavigationType) {
    return lastNavigationType === "push" || lastNavigationType === "replace" ? "hashchange" : "popstate";
  }

  // src/sdk/element-id.ts
  var MAX_DEPTH = 20;
  var runtimeBindings = /* @__PURE__ */ new WeakMap();
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
    const route = routeFromLocation(window.location);
    const prior = runtimeBindings.get(el);
    if (attr && isElementId(attr) && (!prior || prior.id !== attr || prior.route === route && prior.orgId === orgId)) return attr;
    const nodeDescriptor = describeNode(el);
    const id = await hashElementId({ orgId, filePath: route, nodeDescriptor });
    el.setAttribute("data-sh-id", id);
    runtimeBindings.set(el, { id, route, orgId });
    return id;
  }

  // src/sdk/scrubber.ts
  var DEFAULT_PATTERNS = [
    // email
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    // 13–19 digit credit-card-shaped runs (allowing spaces or dashes)
    /\b(?:\d[ -]?){13,19}\b/g,
    // US SSN
    /\b\d{3}-\d{2}-\d{4}\b/g,
    // US phone (xxx) xxx-xxxx / xxx-xxx-xxxx / +1 xxx xxx xxxx etc.
    //
    // Every separator here is optional, which is what makes the loose form
    // below match inside a longer token: `(?<![0-9A-Za-z])` / `(?![0-9])` pin
    // the match to a standalone run so the tail of a longer digit run - the
    // trailing ten digits of a tracking number or SKU - is not swallowed.
    // `length` on the INPUT_CHANGE event is computed from this scrubbed value
    // (src/sdk/index.ts:405-409), so over-matching here corrupts the
    // field-length signal that SLOW_FILL and THRASH run on.
    /(?<![0-9A-Za-z])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![0-9])/g,
    // International phone with country code (8+ digits, common formats)
    /\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}\b/g,
    // IBAN (rough - country letters + 2 check digits + up to 30 chars)
    /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    // IPv4
    /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}\b/g,
    // IPv6 (full + compressed forms - best-effort)
    /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    /\b(?:[0-9a-fA-F]{1,4}:){1,7}:[0-9a-fA-F]{0,4}\b/g,
    // JWT (three base64url segments separated by dots)
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    // AWS access key id (AKIA / ASIA prefixed; 20 char total)
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    // GitHub fine-grained / classic personal access tokens
    /\bgh[pousr]_[A-Za-z0-9]{36,251}\b/g,
    // Stripe test/live secret keys
    /\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{20,}\b/g,
    // Anthropic / OpenAI keys (rough - key shape, not exact)
    /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    /\bsk-[A-Za-z0-9]{20,}\b/g
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
    constructor(orgId, endpoint, buffer, clockOffsetMs = 0, onInterventions, ingestKey, signal) {
      __publicField(this, "orgId", orgId);
      __publicField(this, "endpoint", endpoint);
      __publicField(this, "buffer", buffer);
      __publicField(this, "clockOffsetMs", clockOffsetMs);
      __publicField(this, "onInterventions", onInterventions);
      __publicField(this, "ingestKey", ingestKey);
      __publicField(this, "signal", signal);
    }
    async flush() {
      if (this.signal?.aborted) return { sent: 0 };
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
      const headers = {
        "Content-Type": "application/json",
        "X-Org-Id": this.orgId
      };
      if (this.ingestKey) headers["Authorization"] = `Bearer ${this.ingestKey}`;
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          keepalive: true,
          signal: this.signal
        });
        if (this.signal?.aborted) return { sent: 0 };
        if (!res.ok) {
          for (const e of events) this.buffer.push(e);
          return { sent: 0, error: `HTTP ${res.status}` };
        }
        let response = null;
        try {
          response = await res.json();
        } catch {
        }
        if (this.signal?.aborted) return { sent: 0 };
        const interventions = response?.interventions ?? [];
        if (interventions.length > 0 && this.onInterventions) {
          try {
            this.onInterventions(interventions);
          } catch {
          }
        }
        return { sent: events.length, interventions };
      } catch (err) {
        if (!this.signal?.aborted) for (const e of events) this.buffer.push(e);
        return { sent: 0, error: this.signal?.aborted ? "Stopped" : err.message };
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

  // src/sdk/tours.ts
  var activeTours = /* @__PURE__ */ new Set();
  var sequence = 0;
  function closeTours() {
    for (const close of [...activeTours]) close();
  }
  function startTour(options) {
    if (typeof document === "undefined" || typeof window === "undefined") return null;
    if (!options || !Array.isArray(options.steps) || options.steps.length < 1 || options.steps.length > 20) throw new TypeError("A tour needs 1\u201320 steps");
    const steps = options.steps.map((s) => {
      if (!s || typeof s.title !== "string" || !s.title.trim() || s.title.length > 160 || typeof s.copy !== "string" || s.copy.length > 4e3 || s.selector !== void 0 && (typeof s.selector !== "string" || s.selector.length > 256) || s.targetElementId !== void 0 && (typeof s.targetElementId !== "string" || s.targetElementId.length > 128)) throw new TypeError("Invalid tour step");
      return { ...s };
    });
    closeTours();
    let index = 0;
    let closed = false;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const uid = "__sh_tour_" + ++sequence;
    const backdrop = document.createElement("div");
    backdrop.dataset.shTour = "true";
    backdrop.style.cssText = "position:fixed;inset:0;z-index:2147483645;background:rgba(9,16,31,.55);display:flex;align-items:flex-end;justify-content:center;padding:24px;box-sizing:border-box;pointer-events:auto;font-family:system-ui,sans-serif;";
    const panel = document.createElement("section");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", uid + "_title");
    panel.setAttribute("aria-describedby", uid + "_body");
    panel.style.cssText = "position:relative;z-index:2;background:#fff;color:#172033;border:1px solid #dbe4ee;border-radius:18px;padding:24px;width:520px;max-width:100%;max-height:calc(100dvh - 48px);overflow:auto;box-sizing:border-box;box-shadow:0 24px 80px #0005;";
    const progress = document.createElement("p");
    progress.style.cssText = "margin:0 0 10px;color:#52677f;font-size:12px;font-weight:700;letter-spacing:.06em;";
    progress.setAttribute("aria-live", "polite");
    const title = document.createElement("h2");
    title.id = uid + "_title";
    title.style.cssText = "font-size:23px;line-height:1.3;margin:0 0 12px;";
    const body = document.createElement("p");
    body.id = uid + "_body";
    body.style.cssText = "margin:0;white-space:pre-line;font-size:15px;line-height:1.7;";
    const context = document.createElement("p");
    context.setAttribute("role", "status");
    context.style.cssText = "color:#596d80;font-size:12px;line-height:1.5;";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:20px;";
    function button(label, primary = false) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "font:600 14px system-ui;padding:11px 18px;border-radius:9px;cursor:pointer;border:1px solid #ccd8e5;background:" + (primary ? "#183dba;color:#fff;" : "#fff;color:#172033;");
      return b;
    }
    const dismiss = button("Close tour");
    const previous = button("Back");
    const next = button("Next", true);
    actions.append(dismiss, previous, next);
    panel.append(progress, title, body, context, actions);
    const ring = document.createElement("div");
    ring.setAttribute("aria-hidden", "true");
    ring.style.cssText = "position:fixed;border:3px solid #75e9c5;border-radius:8px;box-shadow:0 0 0 4px #75e9c533;pointer-events:none;box-sizing:border-box;";
    backdrop.append(ring, panel);
    document.body.append(backdrop);
    let target = null;
    function positionRing() {
      if (!target?.isConnected) {
        ring.hidden = true;
        return;
      }
      const r = target.getBoundingClientRect();
      ring.hidden = r.width === 0 || r.height === 0;
      Object.assign(ring.style, { left: r.left - 5 + "px", top: r.top - 5 + "px", width: r.width + 10 + "px", height: r.height + 10 + "px" });
    }
    function render() {
      const step = steps[index];
      progress.textContent = "STEP " + (index + 1) + " OF " + steps.length;
      title.textContent = step.title;
      body.textContent = step.copy;
      previous.disabled = index === 0;
      previous.style.opacity = index === 0 ? ".45" : "1";
      next.textContent = index === steps.length - 1 ? "Finish tour" : "Next";
      target = null;
      try {
        if (step.selector) target = document.querySelector(step.selector);
        else if (step.targetElementId) target = Array.from(document.querySelectorAll("[data-sh-id]")).find((e) => e.getAttribute("data-sh-id") === step.targetElementId) ?? null;
      } catch {
      }
      context.textContent = (step.selector || step.targetElementId) && !target ? "This target is not on the current page. You can continue or return when it is available." : "";
      target?.scrollIntoView?.({ block: "center", behavior: "instant" });
      positionRing();
      next.focus();
    }
    function close(completed = false) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", positionRing);
      window.removeEventListener("scroll", positionRing, true);
      activeTours.delete(cancel);
      backdrop.remove();
      if (priorFocus?.isConnected) priorFocus.focus();
      try {
        if (completed) options.onFinish?.();
        else options.onDismiss?.();
      } catch {
      }
    }
    const cancel = () => close(false);
    function forward() {
      if (closed) return;
      if (index === steps.length - 1) close(true);
      else {
        index++;
        render();
      }
    }
    function back() {
      if (!closed && index > 0) {
        index--;
        render();
      }
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== "Tab") return;
      const buttons = [dismiss, previous, next].filter((b) => !b.disabled);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
    dismiss.addEventListener("click", cancel);
    previous.addEventListener("click", back);
    next.addEventListener("click", forward);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", positionRing);
    window.addEventListener("scroll", positionRing, true);
    activeTours.add(cancel);
    render();
    return { next: forward, back, close: cancel, get step() {
      return index;
    } };
  }

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
  var pending = /* @__PURE__ */ new Map();
  var detachments = /* @__PURE__ */ new Set();
  function later(fn, ms) {
    const id = window.setTimeout(() => {
      pending.delete(id);
      fn();
    }, ms);
    pending.set(id, fn);
    return id;
  }
  function resetRenderers() {
    closeTours();
    for (const [id, finish] of pending) {
      window.clearTimeout(id);
      finish();
    }
    pending.clear();
    for (const detach of [...detachments]) detach();
    detachments.clear();
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById("__sh_styles__")?.remove();
    shown.clear();
    outcomeCallback = null;
  }
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
      style.id = "__sh_styles__";
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
    const outcomeId = d.rowId ?? d.id;
    if (shown.has(d.id)) return;
    shown.add(d.id);
    reportOutcome(outcomeId, "shown");
    const target = d.targetElementId ? findElement(d.targetElementId) : null;
    if (target && d.type !== "TOUR") {
      const handler = () => {
        reportOutcome(outcomeId, "success");
        target.removeEventListener("click", handler, true);
      };
      const detach = () => {
        target.removeEventListener("click", handler, true);
        detachments.delete(detach);
      };
      detachments.add(detach);
      target.addEventListener("click", handler, { capture: true, once: true });
      later(detach, 3e4);
    }
    const ttl = typeof d.autoDismissMs === "number" && d.autoDismissMs >= 0 ? d.autoDismissMs : 8e3;
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
        return renderModal(d, outcomeId);
      case "BANNER":
        return renderBanner(d, ttl, outcomeId);
      case "INLINE_HINT":
        return renderInlineHint(target, d, ttl);
      case "TOUR":
        return renderTour(d, outcomeId);
      case "ICON_FLASH":
        return renderIconFlash(target, ttl);
      case "ARROW":
        return renderArrow(target, d, ttl);
      case "CONFIRM":
        return renderConfirm(d, outcomeId);
      case "ANNOUNCE":
        return renderAnnounce(d);
      default:
        console.warn("[clarus-heal] unknown intervention render type:", d.type);
    }
  }
  function findElement(id) {
    return Array.from(document.querySelectorAll("[data-sh-id]")).find((el) => el.getAttribute("data-sh-id") === id) ?? null;
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
  function autoCleanup(el, ms, onRemove) {
    if (ms <= 0) return;
    later(() => {
      onRemove?.();
      el.remove();
    }, ms);
  }
  function attachEscDismiss(el, interventionId, onRemove) {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (!document.body.contains(el)) {
        document.removeEventListener("keydown", onKey, true);
        return;
      }
      if (interventionId) reportOutcome(interventionId, "dismissed");
      onRemove?.();
      el.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    document.addEventListener("keydown", onKey, true);
    const detach = () => {
      document.removeEventListener("keydown", onKey, true);
      detachments.delete(detach);
    };
    detachments.add(detach);
    return detach;
  }
  function removeWith(el, detach) {
    detach();
    el.remove();
  }
  function trapFocus(el) {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const focusable = el.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const detach = () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
      detachments.delete(detach);
    };
    detachments.add(detach);
    return detach;
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
  function renderOverlay(d, ttl, outcomeId = d.rowId ?? d.id) {
    const card = document.createElement("div");
    card.className = "__sh_card__";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    const conf = d.confidence ?? 0.6;
    const accent = conf >= 0.85 ? "#3b82f6" : conf >= 0.6 ? "#a78bfa" : "#cbd5e1";
    Object.assign(card.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      maxWidth: "380px",
      background: "white",
      color: "#111827",
      border: "1px solid #e5e7eb",
      borderLeft: `4px solid ${accent}`,
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
    const body = document.createElement("div");
    body.style.flex = "1";
    const text = document.createElement("div");
    text.textContent = decodeHtml(d.copy);
    body.appendChild(text);
    if (d.helpCopy) {
      const help = document.createElement("div");
      help.style.cssText = "margin-top:6px;font-size:12px;color:#6b7280;";
      help.textContent = stripHtml(d.helpCopy);
      body.appendChild(help);
    }
    if (d.relatedElementIds && d.relatedElementIds.length > 0) {
      const links = document.createElement("div");
      links.style.cssText = "margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;";
      for (const rid of d.relatedElementIds.slice(0, 3)) {
        const el = document.querySelector(`[data-sh-id="${rid}"]`);
        if (!el) continue;
        const lbl = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40);
        if (!lbl) continue;
        const a = document.createElement("a");
        a.textContent = `Try \u201C${lbl}\u201D`;
        a.style.cssText = "font-size:11px;color:#1d4ed8;text-decoration:underline;cursor:pointer;";
        a.addEventListener("click", (e) => {
          e.preventDefault();
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus?.();
        });
        links.appendChild(a);
      }
      if (links.children.length > 0) body.appendChild(links);
    }
    if (d.diagnostic && window.__CLARUS_DEBUG__) {
      const diag = document.createElement("div");
      diag.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px dashed #e5e7eb;font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;color:#6b7280;";
      diag.textContent = `${d.diagnostic.struggleType} \xB7 sev ${d.diagnostic.severity.toFixed(2)} \xB7 v${d.diagnostic.variantIndex ?? 0} \xB7 conf ${conf.toFixed(2)}`;
      body.appendChild(diag);
    }
    const detachEsc = attachEscDismiss(card, outcomeId);
    const dismiss = makeDismissBtn(() => removeWith(card, detachEsc), outcomeId);
    row.appendChild(body);
    row.appendChild(dismiss);
    card.appendChild(row);
    root().appendChild(card);
    const adjustedTtl = ttl === 0 ? 0 : conf >= 0.85 ? ttl : conf >= 0.5 ? Math.max(4e3, ttl * 0.75) : Math.max(3e3, ttl * 0.5);
    autoCleanup(card, adjustedTtl, detachEsc);
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
    const pct = (px, extent) => `${extent > 0 ? round(px / extent * 100) : 0}%`;
    const { innerWidth: vw, innerHeight: vh } = window;
    const x0 = pct(rect.left - 6, vw);
    const x1 = pct(rect.right + 6, vw);
    const y0 = pct(rect.top - 6, vh);
    const y1 = pct(rect.bottom + 6, vh);
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15,23,42,0.55)",
      pointerEvents: "none",
      zIndex: String(Z.spotlight + 1),
      clipPath: `polygon(
      evenodd,
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${x0} ${y0},
      ${x0} ${y1},
      ${x1} ${y1},
      ${x1} ${y0},
      ${x0} ${y0}
    )`
    });
    root().appendChild(overlay);
    const ring = flashRing(target, "pulse");
    root().appendChild(ring);
    if (d.copy) renderOverlay({ ...d, autoDismissMs: ttl }, ttl);
    autoCleanup(overlay, ttl);
    autoCleanup(ring, ttl);
  }
  function round(n) {
    return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
  }
  function clamp2(n, lo, hi) {
    return Math.min(Math.max(n, lo), hi);
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
    tip.textContent = decodeHtml(d.copy);
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
  function renderModal(d, outcomeId = d.id) {
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
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    if (d.title) card.setAttribute("aria-labelledby", "__sh_modal_title__");
    card.setAttribute("aria-describedby", "__sh_modal_body__");
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
      h.id = "__sh_modal_title__";
      h.textContent = d.title;
      Object.assign(h.style, { fontSize: "18px", fontWeight: "600", margin: "0 0 8px" });
      card.appendChild(h);
    }
    const body = document.createElement("div");
    body.id = "__sh_modal_body__";
    body.textContent = decodeHtml(d.copy);
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
    let teardownFocus = null;
    let teardownEsc = null;
    const dismiss = () => {
      teardownFocus?.();
      reportOutcome(outcomeId, "dismissed");
      removeWith(backdrop, () => teardownEsc?.());
    };
    close.addEventListener("click", dismiss);
    actions.appendChild(close);
    card.appendChild(actions);
    backdrop.appendChild(card);
    root().appendChild(backdrop);
    teardownFocus = trapFocus(card);
    close.focus();
    teardownEsc = attachEscDismiss(backdrop, outcomeId, () => teardownFocus?.());
  }
  function renderBanner(d, ttl, outcomeId = d.id) {
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
    text.textContent = decodeHtml(d.copy);
    banner.appendChild(text);
    const detachEsc = attachEscDismiss(banner, outcomeId);
    banner.appendChild(makeDismissBtn(() => removeWith(banner, detachEsc), outcomeId));
    root().appendChild(banner);
    autoCleanup(banner, ttl, detachEsc);
  }
  function renderInlineHint(target, d, ttl) {
    if (!target) {
      renderOverlay(d, ttl);
      return;
    }
    const rect = target.getBoundingClientRect();
    const hint = document.createElement("div");
    hint.className = "__sh_card__";
    hint.textContent = decodeHtml(d.copy);
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
  function renderTour(d, outcomeId = d.id) {
    let steps = [{ title: d.title || "A little guidance", copy: d.copy, targetElementId: d.targetElementId ?? void 0 }];
    if (typeof d.options?.steps === "string") {
      try {
        if (d.options.steps.length > 1e5) return;
        steps = JSON.parse(d.options.steps);
      } catch {
        return;
      }
    }
    try {
      startTour({ steps, onFinish: () => reportOutcome(outcomeId, "success"), onDismiss: () => reportOutcome(outcomeId, "dismissed") });
    } catch {
    }
  }
  function renderIconFlash(target, ttl) {
    if (!target) return;
    const original = target.style.transition;
    target.style.transition = "background 200ms";
    target.classList.add("__sh_flash__");
    later(() => {
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
    const GUTTER = 36;
    const above = rect.top - GUTTER;
    const below = rect.bottom + 4;
    const top = above >= 0 ? above : Math.min(below, Math.max(0, window.innerHeight - GUTTER));
    Object.assign(arrow.style, {
      position: "fixed",
      left: `${clamp2(rect.left + rect.width / 2 - 12, 0, window.innerWidth - 24)}px`,
      top: `${top}px`,
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
      later(() => window.clearInterval(interval), ttl > 0 ? ttl : 6e3);
    }
    root().appendChild(arrow);
    if (d.copy) renderOverlay(d, ttl);
    autoCleanup(arrow, ttl > 0 ? ttl : 6e3);
  }
  function renderConfirm(d, outcomeId = d.id) {
    renderOverlay(d, 0, outcomeId);
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
    later(() => region.remove(), 4e3);
  }
  function decodeHtml(s) {
    return s.replace(/&rsquo;/g, "\u2019").replace(/&lsquo;/g, "\u2018").replace(/&ldquo;/g, "\u201C").replace(/&rdquo;/g, "\u201D").replace(/&hellip;/g, "\u2026").replace(/&amp;/g, "&").replace(/&nbsp;/g, "\xA0");
  }
  function stripHtml(s) {
    return decodeHtml(s).replace(/<[^>]+>/g, "");
  }

  // src/sdk/index.ts
  var initialized = false;
  var cleanup = null;
  var _state = null;
  function track(name, props) {
    if (!_state) {
      if (typeof console !== "undefined") {
        console.warn("[clarus-heal] track() called before initSelfHealing()");
      }
      return;
    }
    const meta = { kind: "track", name };
    if (props) for (const k of Object.keys(props)) meta[k] = props[k] ?? null;
    void _state.emit("CUSTOM", null, meta);
  }
  function identify(userId) {
    if (!_state) return;
    const current = _state;
    void hashUserIdentifier(userId).then((hash) => {
      if (_state === current) current.setUserIdHash(hash);
    }).catch(() => void 0);
  }
  async function hashUserIdentifier(userId) {
    const data = new TextEncoder().encode(userId);
    const buf = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex.slice(0, 32);
  }
  function initSelfHealing(opts) {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (initialized) return;
    if (!opts.orgId?.trim()) return;
    if (opts.flushIntervalMs !== void 0 && (!Number.isFinite(opts.flushIntervalMs) || opts.flushIntervalMs <= 0)) return;
    initialized = true;
    try {
      initInner(opts);
    } catch (err) {
      console.warn("[clarus-heal] init failed:", err);
      destroySelfHealing();
    }
  }
  function destroySelfHealing() {
    cleanup?.();
    cleanup = null;
    _state = null;
    initialized = false;
    if (typeof document !== "undefined") resetRenderers();
  }
  async function flush() {
    return _state ? _state.flush() : { sent: 0 };
  }
  function initInner(opts) {
    let active = true;
    const controller = new window.AbortController();
    const timers = /* @__PURE__ */ new Set();
    const intervals = /* @__PURE__ */ new Set();
    const restorers = [];
    cleanup = () => {
      active = false;
      controller.abort();
      for (const id of timers) window.clearTimeout(id);
      for (const id of intervals) window.clearInterval(id);
      for (const restore of restorers) restore();
      setOutcomeCallback(null);
    };
    const doc = { addEventListener: ((type, listener, options) => {
      document.addEventListener(type, listener, { ...typeof options === "boolean" ? { capture: options } : options, signal: controller.signal });
    }) };
    const win = { addEventListener: ((type, listener, options) => {
      window.addEventListener(type, listener, { ...typeof options === "boolean" ? { capture: options } : options, signal: controller.signal });
    }) };
    function after(fn, ms) {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (active) fn();
      }, ms);
      timers.add(id);
      return id;
    }
    function every(fn, ms) {
      const id = window.setInterval(() => {
        if (active) fn();
      }, ms);
      intervals.add(id);
      return id;
    }
    const endpoint = opts.endpoint ?? "/api/events";
    const flushIntervalMs = opts.flushIntervalMs ?? 4e3;
    const sessionId = ensureSessionId();
    const disabled = new Set(opts.disableEventTypes ?? []);
    const buffer = new EventBuffer();
    const transport = new Transport(
      opts.orgId,
      endpoint,
      buffer,
      0,
      (interventions) => {
        if (active) for (const interv of interventions) renderIntervention(interv);
      },
      opts.ingestKey,
      controller.signal
    );
    const rage = new RageClickDetector();
    const pageMountedAt = Date.now();
    const initialReferrer = document.referrer;
    function snapshotPageContext() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const formFactor = w <= 640 ? "mobile" : w <= 1024 ? "tablet" : "desktop";
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? void 0;
      return {
        title: document.title || void 0,
        h1: h1 ? h1.slice(0, 200) : void 0,
        viewportW: w,
        viewportH: h,
        formFactor,
        referrer: initialReferrer || void 0,
        ageMs: Date.now() - pageMountedAt
      };
    }
    function elementContextFor(el) {
      if (!el) return void 0;
      const ctx = {};
      const text = (el.textContent ?? "").trim();
      if (text && text.length < 80) ctx.label = text;
      const aria = el.getAttribute("aria-label");
      if (aria) ctx.label = aria;
      const role = inferRole(el);
      if (role) ctx.role = role;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        ctx.touched = true;
        const defaultVal = el instanceof HTMLSelectElement ? Array.from(el.options).find((o) => o.defaultSelected)?.value ?? "" : el.defaultValue;
        ctx.dirty = el.value !== defaultVal;
        if ("value" in el && typeof el.value === "string") ctx.valueLength = el.value.length;
        if (el.disabled) ctx.disabled = true;
        if (typeof el.checkValidity === "function" && !el.checkValidity()) {
          const v = el.validity;
          const byFlag = /* @__PURE__ */ new Map([
            ["valueMissing", Boolean(v?.valueMissing)],
            ["typeMismatch", Boolean(v?.typeMismatch)],
            ["patternMismatch", Boolean(v?.patternMismatch)],
            ["tooShort", Boolean(v?.tooShort)],
            ["tooLong", Boolean(v?.tooLong)],
            ["rangeUnderflow", Boolean(v?.rangeUnderflow)],
            ["rangeOverflow", Boolean(v?.rangeOverflow)],
            ["stepMismatch", Boolean(v?.stepMismatch)],
            // Only a real browser has `badInput` and lets a page set a custom
            // message; both are worth sending because a page's own message is
            // better copy than anything reconstructed from attributes.
            ["badInput", Boolean(v?.badInput)],
            ["customError", Boolean(v?.customError)]
          ]);
          const flags = Array.from(byFlag).filter(([, on]) => on).map(([name]) => name);
          if (flags.length > 0) ctx.validity = flags.join(",");
          if (v?.customError) {
            const message = el.validationMessage?.trim();
            if (message) {
              const value = el.value ?? "";
              const withoutValue = value ? message.split(value).join("[redacted]") : message;
              ctx.validationMessage = scrubText(withoutValue, opts.piiPatterns).slice(0, 200);
            }
          }
        }
      }
      if (el instanceof HTMLButtonElement && el.disabled) ctx.disabled = true;
      const form = el.form ?? el.closest("form");
      if (form) {
        ctx.formId = form.id || form.getAttribute("name") || "(unnamed-form)";
        try {
          ctx.formValid = form.checkValidity();
        } catch {
        }
      }
      if (!hasHandler(el)) ctx.dead = true;
      return Object.keys(ctx).length > 0 ? ctx : void 0;
    }
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
    let userIdHash = null;
    const samplingExempt = /* @__PURE__ */ new Set(["JS_ERROR", "VALIDATION_ERROR"]);
    function shouldSample(eventType, el) {
      const cfg = opts.sampling;
      if (cfg === void 0) return true;
      if (samplingExempt.has(eventType)) return true;
      if (typeof cfg === "number") {
        return cfg >= 1 ? true : cfg <= 0 ? false : Math.random() < cfg;
      }
      if (typeof cfg === "function") {
        try {
          return cfg(eventType, el) !== false;
        } catch {
          return true;
        }
      }
      const perType = cfg.byType?.[eventType];
      const rate = typeof perType === "number" ? perType : cfg.default ?? 1;
      return rate >= 1 ? true : rate <= 0 ? false : Math.random() < rate;
    }
    let emitChain = Promise.resolve();
    function emit(eventType, el, meta) {
      if (!disabled.has(eventType) && interactEventTypes.has(eventType)) {
        noteInteractElement(eventType, el);
        if (eventType !== "HOVER") markActivity();
      }
      const run = emitChain.then(() => emitNow(eventType, el, meta));
      emitChain = run.catch(() => void 0);
      return run;
    }
    async function emitNow(eventType, el, meta) {
      if (!active || disabled.has(eventType)) return null;
      const isOutcome = eventType === "CUSTOM" && typeof meta?.kind === "string" && meta.kind.startsWith("intervention_");
      if (!isOutcome && !shouldSample(eventType, el)) return null;
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
        userIdHash,
        elementId,
        route: routeFromLocation(location),
        eventType,
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        meta,
        page: snapshotPageContext(),
        element: elementContextFor(el)
      };
      if (!active) return null;
      buffer.push(event);
      try {
        opts.onEvent?.(JSON.parse(JSON.stringify(event)));
      } catch {
      }
      return event;
    }
    doc.addEventListener(
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
          if (result.detected) {
            try {
              opts.onLocalStruggle?.(result);
            } catch {
            }
          }
          if (result.detected && opts.enableLocalDemoOverlays) {
            renderIntervention({
              id: `local_${Date.now()}`,
              type: "HIGHLIGHT",
              targetElementId: ev.elementId,
              copy: "Looks like you&rsquo;re having trouble with this. Take a breath - we&rsquo;re working on it.",
              options: { style: "pulse" },
              autoDismissMs: 6e3
            });
          }
        });
      },
      { capture: true, passive: true }
    );
    doc.addEventListener(
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
    doc.addEventListener(
      "input",
      (e) => {
        const target = e.target;
        if (!target) return;
        window.clearTimeout(inputDebounce);
        inputDebounce = after(() => {
          const value = scrubText(target.value ?? "", opts.piiPatterns);
          const length = value.length;
          const prev = inputElementMeta.get(target)?.lastLength ?? 0;
          inputElementMeta.set(target, { lastLength: length });
          void emit("INPUT_CHANGE", target, { length, delta: length - prev });
        }, 300);
      },
      { capture: true, passive: true }
    );
    doc.addEventListener(
      "focus",
      (e) => {
        const target = e.target;
        if (!target || !(target instanceof Element)) return;
        void emit("FOCUS", target);
      },
      { capture: true, passive: true }
    );
    doc.addEventListener(
      "blur",
      (e) => {
        const target = e.target;
        if (!target || !(target instanceof Element)) return;
        void emit("BLUR", target);
      },
      { capture: true, passive: true }
    );
    doc.addEventListener("paste", (e) => {
      void emit("PASTE", e.target);
    }, { capture: true, passive: true });
    doc.addEventListener("copy", (e) => {
      void emit("COPY", e.target);
    }, { capture: true, passive: true });
    doc.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Tab" && e.key !== "Escape" && e.key !== "Enter") return;
        void emit("KEY_DOWN", e.target, { key: e.key });
      },
      { capture: true, passive: true }
    );
    let hoverTimer;
    let lastHoverEl = null;
    doc.addEventListener(
      "mouseover",
      (e) => {
        const target = e.target;
        if (!target) return;
        const interactive = target.closest('button, a, input, select, [role="button"], [title], [data-sh-id]');
        if (!interactive || interactive === lastHoverEl) return;
        lastHoverEl = interactive;
        window.clearTimeout(hoverTimer);
        hoverTimer = after(() => {
          const meta = {};
          if (interactive.hasAttribute("title")) meta.tooltip = true;
          pendingHoverEl = interactive;
          void emit("HOVER", null, meta);
        }, 250);
      },
      { capture: true, passive: true }
    );
    let scrollLastTs = 0;
    let scrollLastY = window.scrollY;
    win.addEventListener(
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
    let lastStrongInteractEl = null;
    let pendingHoverEl = null;
    let lastInteractTs = Date.now();
    const DWELL_REPORT_MS = 1e4;
    let reportedThisStretch = false;
    let lastReportedMs = 0;
    let stretchSeq = 0;
    let stretchId = `st_${Date.now().toString(36)}_0`;
    function markActivity() {
      lastInteractTs = Date.now();
      reportedThisStretch = false;
      stretchSeq += 1;
      lastReportedMs = 0;
      stretchId = `st_${Date.now().toString(36)}_${stretchSeq}`;
    }
    const interactEventTypes = /* @__PURE__ */ new Set([
      "CLICK",
      "INPUT_CHANGE",
      "SUBMIT",
      "PASTE",
      "FOCUS",
      "HOVER"
    ]);
    doc.addEventListener(
      "mousemove",
      (e) => {
        pendingHoverEl = e.target;
        markActivity();
      },
      { capture: false, passive: true }
    );
    function noteInteractElement(eventType, el) {
      if (el) {
        lastStrongInteractEl = el;
        lastInteractEl = el;
        return;
      }
      if (eventType === "HOVER" && !lastStrongInteractEl && pendingHoverEl) lastInteractEl = pendingHoverEl;
    }
    every(() => {
      const quietMs = Date.now() - lastInteractTs;
      const stretchMs = reportedThisStretch ? lastReportedMs + quietMs : quietMs;
      if (stretchMs >= DWELL_REPORT_MS) {
        noteInteractElement("HOVER", null);
        void emit("DWELL", lastInteractEl, { ms: stretchMs, stretch: stretchId });
        lastReportedMs = stretchMs;
        lastInteractTs = Date.now();
        reportedThisStretch = true;
      }
    }, 1e3);
    win.addEventListener("error", (e) => {
      void emit("JS_ERROR", null, {
        message: e.message ?? "unknown",
        filename: e.filename ?? "",
        lineno: e.lineno ?? 0
      });
    });
    win.addEventListener("unhandledrejection", (e) => {
      void emit("JS_ERROR", null, {
        message: String(e.reason ?? "unhandled rejection")
      });
    });
    doc.addEventListener("clarus-heal:validation", ((e) => {
      const detail = e.detail ?? {};
      void emit("VALIDATION_ERROR", detail.element ?? null, {
        kind: detail.kind ?? "format",
        field: detail.field ?? ""
      });
    }));
    win.addEventListener("blur", () => {
      void emit("BLUR", null, { target: "window" });
    });
    win.addEventListener("focus", () => {
      void emit("FOCUS", null, { target: "window" });
    });
    const navigation = new NavigationTracker(location);
    function navigated(trigger) {
      if (navigation.shouldRecord(trigger, location)) {
        lastStrongInteractEl = null;
        lastInteractEl = null;
        pendingHoverEl = null;
        markActivity();
        void emit("NAVIGATION", null, { trigger });
      }
    }
    void emit("NAVIGATION", null, { trigger: "initial" });
    let lastNavigationType = null;
    const navigationApi = window.navigation;
    navigationApi?.addEventListener("navigate", ((e) => {
      lastNavigationType = e.navigationType ?? null;
    }), { signal: controller.signal });
    win.addEventListener("popstate", () => {
      const trigger = classifyPopstate(lastNavigationType);
      lastNavigationType = null;
      navigated(trigger);
    });
    win.addEventListener("hashchange", () => navigated("hashchange"));
    const originalPush = history.pushState;
    const _pushState = originalPush.bind(history);
    history.pushState = function(data, unused, url) {
      _pushState(data, unused, url);
      navigated("pushstate");
    };
    const patchedPush = history.pushState;
    const originalReplace = history.replaceState;
    const _replaceState = originalReplace.bind(history);
    history.replaceState = function(data, unused, url) {
      _replaceState(data, unused, url);
      navigated("replacestate");
    };
    const patchedReplace = history.replaceState;
    restorers.push(() => {
      if (history.pushState === patchedPush) history.pushState = originalPush;
      if (history.replaceState === patchedReplace) history.replaceState = originalReplace;
    });
    _state = {
      emit,
      flush: async () => {
        await emitChain;
        return active ? transport.flush() : { sent: 0 };
      },
      setUserIdHash: (h) => {
        userIdHash = h;
      }
    };
    every(() => void transport.flush(), flushIntervalMs);
    win.addEventListener("beforeunload", () => {
      void transport.flush();
    });
    doc.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void transport.flush();
    });
  }
  function readAutoInitOptions(doc) {
    let source = doc ?? null;
    if (!source) {
      if (typeof document === "undefined") return null;
      source = {
        currentScript: document.currentScript,
        scripts: Array.from(
          document.querySelectorAll("script[data-org-id]")
        )
      };
    }
    let candidate = null;
    if (source.currentScript && source.currentScript.dataset.orgId) {
      candidate = source.currentScript;
    } else if (source.scripts.length > 0) {
      candidate = source.scripts[source.scripts.length - 1] ?? null;
    }
    if (!candidate) return null;
    const orgId = candidate.dataset.orgId;
    if (!orgId) return null;
    const ingestKey = candidate.dataset.ingestKey || void 0;
    const endpoint = candidate.dataset.endpoint || void 0;
    const flushIntervalMsRaw = candidate.dataset.flushIntervalMs;
    const flushIntervalMs = flushIntervalMsRaw ? Number(flushIntervalMsRaw) : void 0;
    return {
      orgId,
      ingestKey,
      endpoint,
      flushIntervalMs: Number.isFinite(flushIntervalMs) ? flushIntervalMs : void 0
    };
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

  // src/sdk/script-entry.ts
  try {
    const options = readAutoInitOptions();
    if (options) initSelfHealing(options);
  } catch {
  }
  return __toCommonJS(script_entry_exports);
})();
