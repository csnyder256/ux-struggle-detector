/**
 * PII scrubber - client-side regex masks applied to anything captured from
 * input events before the value leaves the browser. Privacy-first default;
 * customers can configure additional patterns when they install the SDK.
 */

const DEFAULT_PATTERNS: RegExp[] = [
  // email
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // 13–19 digit credit-card-shaped runs (allowing spaces or dashes)
  /\b(?:\d[ -]?){13,19}\b/g,
  // US SSN
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // US phone (xxx) xxx-xxxx / xxx-xxx-xxxx / +1 xxx xxx xxxx etc.
  /(?:\+?1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
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
  /\bsk-[A-Za-z0-9]{20,}\b/g,
]

export function scrubText(text: string, extra: RegExp[] = []): string {
  let out = text
  for (const re of [...DEFAULT_PATTERNS, ...extra]) {
    out = out.replace(re, '[redacted]')
  }
  return out
}
