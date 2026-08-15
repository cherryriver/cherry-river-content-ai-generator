export function extractAccessToken(headers = {}) {
  const candidates = [
    headers.authorization,
    headers["x-mediaos-user-token"],
  ];

  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    if (typeof value !== "string") continue;
    const match = value.trim().match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}
