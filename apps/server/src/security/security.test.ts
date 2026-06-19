/**
 * Security-invariant tests — the guarantees SECURITY.md stakes the threat model
 * on, which previously had zero automated coverage. Pure functions only (no DB,
 * no network), run with the built-in node:test runner via tsx.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { FastifyRequest } from "fastify";

import { safeResolveUnderRoot, assertInsideAriadne } from "./pathGuard.js";
import { accessContext } from "../auth/context.js";
import { scriptEnv } from "../services/scriptEnv.js";

describe("accessContext — the local/remote trust boundary", () => {
  const req = (remoteAddress: string, headers: Record<string, string> = {}) =>
    ({ headers, socket: { remoteAddress } }) as unknown as FastifyRequest;

  test("loopback IPv4 is local", () => {
    assert.equal(accessContext(req("127.0.0.1")), "local");
  });
  test("loopback IPv6 (::1) is local", () => {
    assert.equal(accessContext(req("::1")), "local");
  });
  test("IPv4-mapped IPv6 loopback is local", () => {
    assert.equal(accessContext(req("::ffff:127.0.0.1")), "local");
  });
  test("a LAN peer is remote even claiming loopback Host", () => {
    assert.equal(accessContext(req("192.168.1.50", { host: "localhost" })), "remote");
  });
  test("a cloudflared hop over loopback is remote (cf-* headers win)", () => {
    assert.equal(accessContext(req("127.0.0.1", { "cf-connecting-ip": "8.8.8.8" })), "remote");
    assert.equal(accessContext(req("127.0.0.1", { "cf-ray": "abc-DFW" })), "remote");
  });
  test("a missing peer address is treated as remote, not local", () => {
    assert.equal(accessContext(req("")), "remote");
  });
});

describe("safeResolveUnderRoot — workspace path containment", () => {
  const root = "/srv/ws";
  test("a normal relative path resolves under root", () => {
    assert.equal(safeResolveUnderRoot(root, "src/a.ts"), path.resolve(root, "src/a.ts"));
  });
  test("the root itself is allowed", () => {
    assert.equal(safeResolveUnderRoot(root, "."), path.resolve(root));
  });
  test("../ traversal is rejected (null)", () => {
    assert.equal(safeResolveUnderRoot(root, "../etc/passwd"), null);
    assert.equal(safeResolveUnderRoot(root, "../../root/.ssh/id_rsa"), null);
  });
  test("an absolute path escaping root is rejected", () => {
    assert.equal(safeResolveUnderRoot(root, "/etc/passwd"), null);
  });
  test("a sibling dir sharing a name prefix is NOT treated as inside", () => {
    // /srv/ws-evil must not pass as under /srv/ws
    assert.equal(safeResolveUnderRoot(root, "../ws-evil/x"), null);
  });
});

describe("assertInsideAriadne — .ariadne write guard", () => {
  const root = "/srv/ws";
  test("a path inside .ariadne/ is allowed", () => {
    assert.doesNotThrow(() => assertInsideAriadne(root, path.join(root, ".ariadne", "hooks.yaml")));
  });
  test("the .ariadne dir itself is allowed", () => {
    assert.doesNotThrow(() => assertInsideAriadne(root, path.join(root, ".ariadne")));
  });
  test("a workspace file OUTSIDE .ariadne is rejected", () => {
    assert.throws(() => assertInsideAriadne(root, path.join(root, "src", "a.ts")));
  });
  test("traversal out of .ariadne is rejected", () => {
    assert.throws(() => assertInsideAriadne(root, path.join(root, ".ariadne", "..", "..", "etc")));
  });
});

describe("scriptEnv — secret stripping for spawned commands", () => {
  test("strips secret-looking vars, keeps plain ones", () => {
    process.env.ARIADNE_TEST_PLAIN = "keepme";
    process.env.ARIADNE_TEST_API_KEY = "sk-secret";
    process.env.ARIADNE_TEST_TOKEN = "tok-secret";
    process.env.ARIADNE_TEST_DB_PASSWORD = "pw";
    try {
      const env = scriptEnv();
      assert.equal(env.ARIADNE_TEST_PLAIN, "keepme");
      assert.equal(env.ARIADNE_TEST_API_KEY, undefined);
      assert.equal(env.ARIADNE_TEST_TOKEN, undefined);
      assert.equal(env.ARIADNE_TEST_DB_PASSWORD, undefined);
    } finally {
      delete process.env.ARIADNE_TEST_PLAIN;
      delete process.env.ARIADNE_TEST_API_KEY;
      delete process.env.ARIADNE_TEST_TOKEN;
      delete process.env.ARIADNE_TEST_DB_PASSWORD;
    }
  });
});
