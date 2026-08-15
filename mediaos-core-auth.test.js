import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaOsCoreUrl,
  resolveAuthenticatedUser,
  validateUserWithMediaOsCore,
} from "./mediaos-core-auth.js";

test("uses configured Core URL with production default fallback", () => {
  assert.equal(
    mediaOsCoreUrl({ MEDIAOS_CORE_URL: "https://core.example.com/" }),
    "https://core.example.com",
  );
  assert.equal(
    mediaOsCoreUrl({ MEDIAOS_CORE_AUTH_URL: "https://auth.example.com///" }),
    "https://auth.example.com",
  );
  assert.equal(
    mediaOsCoreUrl({}),
    "https://cherry-river-media-os-core.vercel.app",
  );
});

test("returns the locally validated user without calling Core", async () => {
  let coreCalled = false;
  const user = await resolveAuthenticatedUser(
    { headers: { authorization: "Bearer local-token" } },
    {
      localAuth: async () => ({ id: "user-local", email: "local@example.com" }),
      fetchImpl: async () => {
        coreCalled = true;
        throw new Error("should_not_call_core");
      },
      coreUrl: "https://core.example.com",
    },
  );

  assert.equal(user.id, "user-local");
  assert.equal(user.source, "local_supabase");
  assert.equal(coreCalled, false);
});

test("falls back to Core validation for a valid MediaOS token", async () => {
  const user = await resolveAuthenticatedUser(
    { headers: { "x-mediaos-user-token": "Bearer core-token" } },
    {
      localAuth: async () => null,
      coreUrl: "https://core.example.com",
      fetchImpl: async (url, options) => {
        assert.equal(String(url), "https://core.example.com/api/auth/validate");
        assert.equal(options.headers.Authorization, "Bearer core-token");
        assert.equal(options.headers["x-mediaos-user-token"], "Bearer core-token");
        return new Response(JSON.stringify({
          authenticated: true,
          user: { id: "user-core", email: "core@example.com" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  );

  assert.equal(user.id, "user-core");
  assert.equal(user.email, "core@example.com");
  assert.equal(user.source, "mediaos_core");
});

test("rejects absent or malformed credentials before server validation", async () => {
  let called = false;
  const user = await resolveAuthenticatedUser(
    { headers: { authorization: "Basic abc" } },
    {
      localAuth: async () => null,
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
      coreUrl: "https://core.example.com",
    },
  );

  assert.equal(user, null);
  assert.equal(called, false);
});

test("rejects wrong project, audience or invalid tokens when Core refuses them", async () => {
  const user = await validateUserWithMediaOsCore("wrong-project-token", {
    coreUrl: "https://core.example.com",
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_session" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.equal(user, null);
});

test("rejects direct calls that do not contain a user bearer", async () => {
  const user = await resolveAuthenticatedUser(
    { headers: {} },
    {
      localAuth: async () => ({ id: "should-not-happen" }),
      fetchImpl: async () => new Response("{}", { status: 200 }),
      coreUrl: "https://core.example.com",
    },
  );

  assert.equal(user, null);
});

test("fails closed on malformed Core validation payload", async () => {
  const user = await validateUserWithMediaOsCore("token", {
    coreUrl: "https://core.example.com",
    fetchImpl: async () => new Response(JSON.stringify({ authenticated: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.equal(user, null);
});
