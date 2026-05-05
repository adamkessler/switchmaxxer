import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalHttpUrl,
  formatHostForUrl,
  isLoopbackHostname,
  isWildcardBindHostname,
  normalizeHealthProbeHost,
  normalizeHostname
} from "./net-utils";

void test("normalizeHostname trims, lowercases, and unwraps bracketed IPv6 literals", () => {
  assert.equal(normalizeHostname("  LOCALHOST "), "localhost");
  assert.equal(normalizeHostname("[::1]"), "::1");
});

void test("isLoopbackHostname recognizes canonical loopback host forms", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("::1"), true);
  assert.equal(isLoopbackHostname("0:0:0:0:0:0:0:1"), true);
  assert.equal(isLoopbackHostname("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackHostname("10.0.0.5"), false);
});

void test("isLoopbackHostname only accepts localhost subdomains when explicitly enabled", () => {
  assert.equal(isLoopbackHostname("sub.localhost"), false);
  assert.equal(isLoopbackHostname("sub.localhost", { allowLocalhostSubdomains: true }), true);
});

void test("isWildcardBindHostname recognizes IPv4 and IPv6 wildcard bind forms", () => {
  assert.equal(isWildcardBindHostname("0.0.0.0"), true);
  assert.equal(isWildcardBindHostname("::"), true);
  assert.equal(isWildcardBindHostname("[::]"), true);
  assert.equal(isWildcardBindHostname("0:0:0:0:0:0:0:0"), true);
  assert.equal(isWildcardBindHostname("::ffff:0.0.0.0"), true);
  assert.equal(isWildcardBindHostname("127.0.0.1"), false);
  assert.equal(isWildcardBindHostname("192.0.2.10"), false);
});

void test("normalizeHealthProbeHost maps wildcard listeners to loopback probes", () => {
  assert.equal(normalizeHealthProbeHost("0.0.0.0"), "127.0.0.1");
  assert.equal(normalizeHealthProbeHost("[::]"), "127.0.0.1");
  assert.equal(normalizeHealthProbeHost("127.0.0.2"), "127.0.0.2");
});

void test("formatHostForUrl brackets IPv6 literals without changing socket bind host semantics", () => {
  assert.equal(formatHostForUrl("127.0.0.1"), "127.0.0.1");
  assert.equal(formatHostForUrl("localhost"), "localhost");
  assert.equal(formatHostForUrl("::1"), "[::1]");
  assert.equal(formatHostForUrl("[::1]"), "[::1]");
});

void test("buildLocalHttpUrl produces valid local URLs for IPv4, DNS, and IPv6 hosts", () => {
  assert.equal(buildLocalHttpUrl("127.0.0.1", 4080, "/health"), "http://127.0.0.1:4080/health");
  assert.equal(buildLocalHttpUrl("localhost", 4080, "/health"), "http://localhost:4080/health");
  assert.equal(buildLocalHttpUrl("::1", 4080, "/health"), "http://[::1]:4080/health");
  assert.equal(
    buildLocalHttpUrl("::1", 4080, "/__switchmaxxer/runtime/config"),
    "http://[::1]:4080/__switchmaxxer/runtime/config"
  );
});
