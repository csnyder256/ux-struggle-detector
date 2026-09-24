/**
 * Sign-in address normalization for the magic-link provider.
 *
 * Auth.js runs this on the address from the sign-in form before it looks the
 * user up or hands the address to nodemailer. The rules are Auth.js's own
 * default normalizer (NFKC, lowercase, trim, no quotes, exactly one "@",
 * domain cut at the first ",") plus the RFC 5321 length limit. The limit
 * matters because the address arrives in an unauthenticated POST and
 * nodemailer's address parser takes time in proportion to it: a
 * comma-stuffed 1 MB address blocks the event loop for about 7 s on
 * nodemailer 10, and nodemailer 8 was quadratic (70 s for 120 KB).
 */

/** RFC 5321 caps a path at 256 octets including its angle brackets. */
export const MAX_EMAIL_LENGTH = 254

export function normalizeSignInEmail(input?: string): string {
  if (!input) throw new Error('Missing email from request body.')
  const email = input.normalize('NFKC').toLowerCase().trim()
  if (email.length > MAX_EMAIL_LENGTH || email.includes('"')) {
    throw new Error('Invalid email address format.')
  }
  const parts = email.split('@')
  const local = parts[0]
  const domain = parts[1]?.split(',')[0]
  if (parts.length !== 2 || !local || !domain) {
    throw new Error('Invalid email address format.')
  }
  return `${local}@${domain}`
}
