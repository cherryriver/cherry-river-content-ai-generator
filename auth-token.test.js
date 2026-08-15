import test from "node:test";
import assert from "node:assert/strict";
import { extractAccessToken } from "./auth-token.js";

test("prefers the standard Authorization bearer", () => {
  assert.equal(extractAccessToken({
    authorization: "Bearer standard-token",
    "x-mediaos-user-token": "Bearer fallback-token",
  }), "standard-token");
});

test("accepts the MediaOS fallback bearer when Authorization is stripped", () => {
  assert.equal(extractAccessToken({
    "x-mediaos-user-token": "Bearer fallback-token",
  }), "fallback-token");
});

test("fails closed for missing or malformed credentials", () => {
  assert.equal(extractAccessToken({}), null);
  assert.equal(extractAccessToken({ authorization: "Basic abc" }), null);
  assert.equal(extractAccessToken({ "x-mediaos-user-token": "fallback-token" }), null);
});
