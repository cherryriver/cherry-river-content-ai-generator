import { extractAccessToken } from "./auth-token.js";

const DEFAULT_CORE_URL = "https://cherry-river-media-os-core.vercel.app";

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim().replace(/\/+$/, "");
}

export function mediaOsCoreUrl(env = process.env) {
  return normalizeBaseUrl(env.MEDIAOS_CORE_URL)
    ?? normalizeBaseUrl(env.MEDIAOS_CORE_AUTH_URL)
    ?? DEFAULT_CORE_URL;
}

export async function validateUserWithMediaOsCore(token, {
  coreUrl = mediaOsCoreUrl(),
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  if (typeof token !== "string" || token.trim().length === 0) return null;
  if (!coreUrl) return null;

  const bearer = `Bearer ${token.trim()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(new URL("/api/auth/validate", coreUrl), {
      method: "GET",
      headers: {
        Authorization: bearer,
        "x-mediaos-user-token": bearer,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    const user = body?.authenticated === true ? body.user : null;
    if (!user?.id) return null;

    return {
      id: user.id,
      email: user.email ?? null,
      source: "mediaos_core",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveAuthenticatedUser(req, {
  localAuth,
  fetchImpl = fetch,
  coreUrl = mediaOsCoreUrl(),
} = {}) {
  const token = extractAccessToken(req.headers);
  if (!token) return null;

  if (typeof localAuth === "function") {
    const localUser = await localAuth(token);
    if (localUser?.id) return { ...localUser, source: "local_supabase" };
  }

  return validateUserWithMediaOsCore(token, { coreUrl, fetchImpl });
}
