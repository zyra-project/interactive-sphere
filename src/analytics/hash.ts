/**
 * Privacy-friendly hashing for free-text analytics signals.
 *
 * `browse_search` and any future Tier B event that wants to count
 * unique searches without ever transmitting the search string itself
 * uses this helper. Truncating the SHA-256 to 12 hex characters
 * (48 bits) keeps the value small enough that it can't be used as a
 * persistent identifier while still being collision-resistant for
 * realistic search-volume cardinalities (~10^7 distinct queries
 * before birthday-collision risk hits ~1%).
 *
 * The string is normalised before hashing so casing and surrounding
 * whitespace don't fracture the bucket — "Hurricane" and "hurricane "
 * collapse to the same hash.
 */

const HASH_LENGTH_HEX = 12

/**
 * Hash a free-text string for analytics. Returns 12 hex characters
 * of the lowercase-trimmed SHA-256.
 *
 * Falls back to a 12-char placeholder of zeros if `crypto.subtle` is
 * unavailable (e.g. insecure context, ancient browser). The fallback
 * is intentional: we'd rather log "unknown" than crash the call site.
 */
export async function hashQuery(input: string): Promise<string> {
  const normalized = input.trim().toLowerCase()
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return '0'.repeat(HASH_LENGTH_HEX)
  }
  const bytes = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, HASH_LENGTH_HEX)
}
