import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import { fetchWithSwitchmaxxerTransport } from "./http-transport";
import {
  assertResolvedProviderEndpointPolicy,
  isPrivateOrLocalHostname,
  ResolvedPrivateEndpointError,
  validateProviderEndpointPolicy
} from "./provider-endpoint-policy";

void test("provider endpoint policy enforces SSRF and insecure-http rules across representative endpoint cases", () => {
  const blockedCases: Array<{
    endpoint: string;
    options?: { allowPrivateEndpoints: boolean; allowInsecureHttp: boolean };
    expectedMessage: RegExp;
  }> = [
    { endpoint: "https://127.0.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://10.0.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://172.16.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://192.168.1.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://0.0.0.0/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://100.64.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://192.0.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://192.0.2.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://198.18.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://198.51.100.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://203.0.113.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://224.0.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://255.255.255.255/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[::]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[::ffff:127.0.0.1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[::ffff:10.0.0.1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[::ffff:169.254.169.254]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[::ffff:192.0.2.1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[::ffff:0:127.0.0.1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[fe80::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[fd00::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[ff02::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[64:ff9b::c000:201]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[100::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[2001::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[2001:db8::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://[2002::1]/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://localhost/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://sub.localhost/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://2130706433/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://127.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://0x7f.0.0.1/v1/chat/completions", expectedMessage: /targets a private or local endpoint/ },
    { endpoint: "https://user:pass@api.example.com/v1/chat/completions", expectedMessage: /must not include userinfo/ },
    { endpoint: "http://api.example.com/v1/chat/completions", expectedMessage: /uses insecure HTTP/ },
    {
      endpoint: "http://127.0.0.1/v1/chat/completions",
      options: { allowPrivateEndpoints: false, allowInsecureHttp: true },
      expectedMessage: /targets a private or local endpoint/
    },
    { endpoint: "not-a-url", expectedMessage: /must contain a valid URL 'endpoint'/ }
  ];

  for (const blockedCase of blockedCases) {
    assert.throws(
      () =>
        validateProviderEndpointPolicy(
          "test_provider",
          blockedCase.endpoint,
          blockedCase.options ?? {
            allowPrivateEndpoints: false,
            allowInsecureHttp: false
          }
        ),
      blockedCase.expectedMessage
    );
  }

  const allowedHttps = validateProviderEndpointPolicy("test_provider", "https://api.openai.com/v1/chat/completions", {
    allowPrivateEndpoints: false,
    allowInsecureHttp: false
  });
  assert.equal(allowedHttps.href, "https://api.openai.com/v1/chat/completions");

  const allowedPrivate = validateProviderEndpointPolicy("test_provider", "https://127.0.0.1/v1/chat/completions", {
    allowPrivateEndpoints: true,
    allowInsecureHttp: false
  });
  assert.equal(allowedPrivate.hostname, "127.0.0.1");

  const allowedInsecure = validateProviderEndpointPolicy("test_provider", "http://api.example.com/v1/chat/completions", {
    allowPrivateEndpoints: false,
    allowInsecureHttp: true
  });
  assert.equal(allowedInsecure.protocol, "http:");
});

void test("provider endpoint policy treats IPv6 special-use ranges as private only for validated literals", () => {
  assert.equal(isPrivateOrLocalHostname("::"), true);
  assert.equal(isPrivateOrLocalHostname("::1"), true);
  assert.equal(isPrivateOrLocalHostname("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrLocalHostname("::ffff:10.0.0.1"), true);
  assert.equal(isPrivateOrLocalHostname("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateOrLocalHostname("::ffff:192.0.2.1"), true);
  assert.equal(isPrivateOrLocalHostname("::ffff:0:127.0.0.1"), true);
  assert.equal(isPrivateOrLocalHostname("fe80::1"), true);
  assert.equal(isPrivateOrLocalHostname("fc00::1"), true);
  assert.equal(isPrivateOrLocalHostname("fd12:3456::1"), true);
  assert.equal(isPrivateOrLocalHostname("ff02::1"), true);
  assert.equal(isPrivateOrLocalHostname("64:ff9b::c000:201"), true);
  assert.equal(isPrivateOrLocalHostname("64:ff9b::192.0.2.1"), true);
  assert.equal(isPrivateOrLocalHostname("64:ff9b:1::1"), true);
  assert.equal(isPrivateOrLocalHostname("100::1"), true);
  assert.equal(isPrivateOrLocalHostname("2001::1"), true);
  assert.equal(isPrivateOrLocalHostname("2001:0:4136:e378:8000:63bf:3fff:fdd2"), true);
  assert.equal(isPrivateOrLocalHostname("2001:2::1"), true);
  assert.equal(isPrivateOrLocalHostname("2001:db8::1"), true);
  assert.equal(isPrivateOrLocalHostname("2002::1"), true);
  assert.equal(isPrivateOrLocalHostname("fe90::1"), true);

  assert.equal(isPrivateOrLocalHostname("2001:db9::1"), false);
  assert.equal(isPrivateOrLocalHostname("2001:4860:4860::8888"), false);
  assert.equal(isPrivateOrLocalHostname("2606:4700:4700::1111"), false);
  assert.equal(isPrivateOrLocalHostname("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateOrLocalHostname("fcrouter.internal"), false);
});

void test("provider endpoint policy treats reserved and non-global IPv4 ranges as private or local", () => {
  assert.equal(isPrivateOrLocalHostname("0.0.0.0"), true);
  assert.equal(isPrivateOrLocalHostname("100.64.0.1"), true);
  assert.equal(isPrivateOrLocalHostname("192.0.0.1"), true);
  assert.equal(isPrivateOrLocalHostname("192.0.2.1"), true);
  assert.equal(isPrivateOrLocalHostname("198.18.0.1"), true);
  assert.equal(isPrivateOrLocalHostname("198.51.100.1"), true);
  assert.equal(isPrivateOrLocalHostname("203.0.113.1"), true);
  assert.equal(isPrivateOrLocalHostname("224.0.0.1"), true);
  assert.equal(isPrivateOrLocalHostname("255.255.255.255"), true);

  assert.equal(isPrivateOrLocalHostname("8.8.8.8"), false);
  assert.equal(isPrivateOrLocalHostname("1.1.1.1"), false);
});

void test("provider endpoint policy still accepts canonical public hostnames and IP literals", () => {
  const allowedPublicDns = validateProviderEndpointPolicy("test_provider", "https://api.openai.com/v1/chat/completions", {
    allowPrivateEndpoints: false,
    allowInsecureHttp: false
  });
  assert.equal(allowedPublicDns.hostname, "api.openai.com");

  const allowedPublicIpv4 = validateProviderEndpointPolicy("test_provider", "https://8.8.8.8/v1/chat/completions", {
    allowPrivateEndpoints: false,
    allowInsecureHttp: false
  });
  assert.equal(allowedPublicIpv4.hostname, "8.8.8.8");

  const allowedPublicIpv6 = validateProviderEndpointPolicy(
    "test_provider",
    "https://[2001:4860:4860::8888]/v1/chat/completions",
    {
      allowPrivateEndpoints: false,
      allowInsecureHttp: false
    }
  );
  assert.equal(allowedPublicIpv6.hostname, "[2001:4860:4860::8888]");
});

void test("provider endpoint policy preserves required query parameters but strips URL fragments", () => {
  const azureLike = validateProviderEndpointPolicy(
    "azure_provider",
    "https://azure.example.test/openai/deployments/demo/chat/completions?api-version=2024-02-15-preview#ignored-fragment",
    {
      allowPrivateEndpoints: false,
      allowInsecureHttp: false
    }
  );

  assert.equal(
    azureLike.toString(),
    "https://azure.example.test/openai/deployments/demo/chat/completions?api-version=2024-02-15-preview"
  );
  assert.equal(azureLike.search, "?api-version=2024-02-15-preview");
  assert.equal(azureLike.hash, "");
});

void test("runtime provider endpoint policy rejects rebinding-style DNS answers to private or local addresses", async () => {
  const privateAddressCache = new Map();
  const loopbackCache = new Map();

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(new URL("https://api.example.com/v1/chat/completions"), {
        allowPrivateEndpoints: false
      }, {
        lookupAddresses: async () => [{ address: "0.0.0.0", family: 4 }],
        cache: privateAddressCache
      }),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.hostname, "api.example.com");
      assert.equal(error.address, "0.0.0.0");
      return true;
    }
  );

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(new URL("https://api.example.com/v1/chat/completions"), {
        allowPrivateEndpoints: false
      }, {
        lookupAddresses: async () => [{ address: "127.0.0.1", family: 4 }],
        cache: loopbackCache
      }),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.hostname, "api.example.com");
      assert.equal(error.address, "127.0.0.1");
      return true;
    }
  );

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(new URL("https://api.example.com/v1/chat/completions"), {
        allowPrivateEndpoints: false
      }, {
        lookupAddresses: async () => [{ address: "::ffff:127.0.0.1", family: 6 }],
        cache: new Map()
      }),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.hostname, "api.example.com");
      assert.equal(error.address, "::ffff:127.0.0.1");
      return true;
    }
  );

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(new URL("https://api.example.com/v1/chat/completions"), {
        allowPrivateEndpoints: false
      }, {
        lookupAddresses: async () => [{ address: "::ffff:169.254.169.254", family: 6 }],
        cache: new Map()
      }),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.hostname, "api.example.com");
      assert.equal(error.address, "::ffff:169.254.169.254");
      return true;
    }
  );

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(new URL("https://api.example.com/v1/chat/completions"), {
        allowPrivateEndpoints: false
      }, {
        lookupAddresses: async () => [{ address: "::ffff:0:127.0.0.1", family: 6 }],
        cache: new Map()
      }),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.hostname, "api.example.com");
      assert.equal(error.address, "::ffff:0:127.0.0.1");
      return true;
    }
  );

  const pinnedResolution = await assertResolvedProviderEndpointPolicy(
    new URL("https://api.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      lookupAddresses: async () => [{ address: "151.101.1.140", family: 4 }],
      cache: new Map()
    }
  );
  assert.deepEqual(pinnedResolution, {
    hostname: "api.example.com",
    address: "151.101.1.140",
    family: 4
  });

  const privateAllowedResolution = await assertResolvedProviderEndpointPolicy(
    new URL("https://api.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: true },
    {
      lookupAddresses: async () => [{ address: "127.0.0.1", family: 4 }],
      cache: new Map()
    }
  );
  assert.deepEqual(privateAllowedResolution, {
    hostname: "api.example.com",
    address: "127.0.0.1",
    family: 4
  });
});

void test("runtime provider endpoint policy defaults successful DNS pins to a 30-second TTL", async () => {
  const cache = new Map();
  let lookupCallCount = 0;

  const first = await assertResolvedProviderEndpointPolicy(
    new URL("https://default-ttl.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 1_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.140", family: 4 }];
      }
    }
  );

  const second = await assertResolvedProviderEndpointPolicy(
    new URL("https://default-ttl.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 30_999,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.141", family: 4 }];
      }
    }
  );

  const third = await assertResolvedProviderEndpointPolicy(
    new URL("https://default-ttl.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 31_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.141", family: 4 }];
      }
    }
  );

  assert.equal(lookupCallCount, 2);
  assert.deepEqual(second, first);
  assert.deepEqual(third, {
    hostname: "default-ttl.example.com",
    address: "151.101.1.141",
    family: 4
  });
});

void test("runtime provider endpoint policy pins allowed private DNS answers instead of re-resolving every request", async () => {
  const cache = new Map();
  let lookupCallCount = 0;

  const first = await assertResolvedProviderEndpointPolicy(
    new URL("https://private-gateway.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: true },
    {
      cache,
      nowMs: 1_000,
      cacheTtlMs: 60_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "10.0.0.10", family: 4 }];
      }
    }
  );

  const second = await assertResolvedProviderEndpointPolicy(
    new URL("https://private-gateway.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: true },
    {
      cache,
      nowMs: 30_000,
      cacheTtlMs: 60_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "10.0.0.11", family: 4 }];
      }
    }
  );

  assert.equal(lookupCallCount, 1);
  assert.deepEqual(first, {
    hostname: "private-gateway.example.com",
    address: "10.0.0.10",
    family: 4
  });
  assert.deepEqual(second, first);
});

void test("runtime provider endpoint policy does not let private-enabled pins bypass stricter routes", async () => {
  const cache = new Map();

  const privatePin = await assertResolvedProviderEndpointPolicy(
    new URL("https://shared-provider.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: true },
    {
      cache,
      nowMs: 1_000,
      cacheTtlMs: 60_000,
      lookupAddresses: async () => [{ address: "10.0.0.10", family: 4 }]
    }
  );

  assert.deepEqual(privatePin, {
    hostname: "shared-provider.example.com",
    address: "10.0.0.10",
    family: 4
  });

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(
        new URL("https://shared-provider.example.com/v1/chat/completions"),
        { allowPrivateEndpoints: false },
        {
          cache,
          nowMs: 30_000,
          cacheTtlMs: 60_000,
          lookupAddresses: async () => [{ address: "151.101.1.140", family: 4 }]
        }
      ),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.hostname, "shared-provider.example.com");
      assert.equal(error.address, "10.0.0.10");
      return true;
    }
  );
});

void test("runtime provider endpoint policy does not let stricter rejected cache block private-enabled routes", async () => {
  const cache = new Map();
  let lookupCallCount = 0;

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(
        new URL("https://private-after-reject.example.com/v1/chat/completions"),
        { allowPrivateEndpoints: false },
        {
          cache,
          nowMs: 1_000,
          cacheTtlMs: 60_000,
          rejectedCacheTtlMs: 300_000,
          lookupAddresses: async () => {
            lookupCallCount += 1;
            return [{ address: "10.0.0.10", family: 4 }];
          }
        }
      ),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.address, "10.0.0.10");
      return true;
    }
  );

  const privatePin = await assertResolvedProviderEndpointPolicy(
    new URL("https://private-after-reject.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: true },
    {
      cache,
      nowMs: 30_000,
      cacheTtlMs: 60_000,
      rejectedCacheTtlMs: 300_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "10.0.0.20", family: 4 }];
      }
    }
  );

  assert.equal(lookupCallCount, 2);
  assert.deepEqual(privatePin, {
    hostname: "private-after-reject.example.com",
    address: "10.0.0.20",
    family: 4
  });
});

void test("runtime provider endpoint policy reuses a validated public DNS pin across repeated requests until its TTL expires", async () => {
  const cache = new Map();
  let lookupCallCount = 0;

  const first = await assertResolvedProviderEndpointPolicy(
    new URL("https://api.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 1_000,
      cacheTtlMs: 60_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.140", family: 4 }];
      }
    }
  );

  const second = await assertResolvedProviderEndpointPolicy(
    new URL("https://api.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 30_000,
      cacheTtlMs: 60_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.141", family: 4 }];
      }
    }
  );

  const third = await assertResolvedProviderEndpointPolicy(
    new URL("https://api.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 62_000,
      cacheTtlMs: 60_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.141", family: 4 }];
      }
    }
  );

  assert.equal(lookupCallCount, 2);
  assert.deepEqual(first, {
    hostname: "api.example.com",
    address: "151.101.1.140",
    family: 4
  });
  assert.deepEqual(second, first);
  assert.deepEqual(third, {
    hostname: "api.example.com",
    address: "151.101.1.141",
    family: 4
  });
});

void test("runtime provider endpoint policy revalidates expired public pins and can later reject a private rebinding answer", async () => {
  const cache = new Map();
  let lookupCallCount = 0;

  const first = await assertResolvedProviderEndpointPolicy(
    new URL("https://api.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 1_000,
      cacheTtlMs: 60_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.140", family: 4 }];
      }
    }
  );

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(
        new URL("https://api.example.com/v1/chat/completions"),
        { allowPrivateEndpoints: false },
        {
          cache,
          nowMs: 62_000,
          cacheTtlMs: 60_000,
          rejectedCacheTtlMs: 300_000,
          lookupAddresses: async () => {
            lookupCallCount += 1;
            return [{ address: "127.0.0.1", family: 4 }];
          }
        }
      ),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.address, "127.0.0.1");
      return true;
    }
  );

  assert.deepEqual(first, {
    hostname: "api.example.com",
    address: "151.101.1.140",
    family: 4
  });
  assert.equal(lookupCallCount, 2);
});

void test("runtime provider endpoint policy uses LRU eviction so recently reused pins survive cache pressure", async () => {
  const cache = new Map();

  for (let index = 0; index < 512; index += 1) {
    await assertResolvedProviderEndpointPolicy(
      new URL(`https://api-${index}.example.com/v1/chat/completions`),
      { allowPrivateEndpoints: false },
      {
        cache,
        nowMs: index + 1,
        cacheTtlMs: 600_000,
        lookupAddresses: async () => [{ address: `151.101.1.${(index % 200) + 1}`, family: 4 }]
      }
    );
  }

  await assertResolvedProviderEndpointPolicy(
    new URL("https://api-0.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 1_000,
      cacheTtlMs: 600_000,
      lookupAddresses: async () => {
        throw new Error("LRU hit should not re-resolve a hot entry");
      }
    }
  );

  await assertResolvedProviderEndpointPolicy(
    new URL("https://api-512.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 1_001,
      cacheTtlMs: 600_000,
      lookupAddresses: async () => [{ address: "151.101.1.201", family: 4 }]
    }
  );

  assert.equal(cache.has("api-0.example.com"), true);
  assert.equal(cache.has("api-1.example.com"), false);
  assert.equal(cache.has("api-512.example.com"), true);
});

void test("runtime provider endpoint policy caches private-address rejections longer than successful pins", async () => {
  const cache = new Map();
  let lookupCallCount = 0;

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(
        new URL("https://api.example.com/v1/chat/completions"),
        { allowPrivateEndpoints: false },
        {
          cache,
          nowMs: 1_000,
          cacheTtlMs: 60_000,
          rejectedCacheTtlMs: 300_000,
          lookupAddresses: async () => {
            lookupCallCount += 1;
            return [{ address: "127.0.0.1", family: 4 }];
          }
        }
      ),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.address, "127.0.0.1");
      return true;
    }
  );

  await assert.rejects(
    () =>
      assertResolvedProviderEndpointPolicy(
        new URL("https://api.example.com/v1/chat/completions"),
        { allowPrivateEndpoints: false },
        {
          cache,
          nowMs: 120_000,
          cacheTtlMs: 60_000,
          rejectedCacheTtlMs: 300_000,
          lookupAddresses: async () => {
            lookupCallCount += 1;
            return [{ address: "151.101.1.141", family: 4 }];
          }
        }
      ),
    (error) => {
      assert.ok(error instanceof ResolvedPrivateEndpointError);
      assert.equal(error.address, "127.0.0.1");
      return true;
    }
  );

  const recovered = await assertResolvedProviderEndpointPolicy(
    new URL("https://api.example.com/v1/chat/completions"),
    { allowPrivateEndpoints: false },
    {
      cache,
      nowMs: 302_000,
      cacheTtlMs: 60_000,
      rejectedCacheTtlMs: 300_000,
      lookupAddresses: async () => {
        lookupCallCount += 1;
        return [{ address: "151.101.1.141", family: 4 }];
      }
    }
  );

  assert.equal(lookupCallCount, 2);
  assert.deepEqual(recovered, {
    hostname: "api.example.com",
    address: "151.101.1.141",
    family: 4
  });
});

void test("switchmaxxer transport reuses a pinned DNS resolution for the actual socket connection", async () => {
  const originalRequest = http.request;
  let observedUrlHost: string | undefined;
  let observedLookupAddress: string | undefined;
  let observedLookupFamily: number | undefined;
  let observedBody = "";
  let fetchImplCalled = false;

  try {
    (http as typeof http & { request: typeof http.request }).request = ((
      url: string | URL,
      options: Record<string, unknown>,
      onResponse?: (response: Readable & {
        statusCode?: number;
        statusMessage?: string;
        headers: Record<string, string>;
      }) => void
    ) => {
      observedUrlHost = typeof url === "string" ? new URL(url).host : url.host;

      const lookup = options["lookup"] as (
        hostname: string,
        lookupOptions: { family?: number },
        callback: (error: Error | null, address: string, family: number) => void
      ) => void;
      lookup("dns-rebind.test", { family: 0 }, (error, address, family) => {
        assert.equal(error, null);
        observedLookupAddress = address;
        observedLookupFamily = family;
      });

      const request = new EventEmitter() as EventEmitter & {
        end: (chunk?: string) => void;
        destroy: (error?: Error) => void;
      };

      request.end = (chunk?: string) => {
        if (typeof chunk === "string") {
          observedBody += chunk;
        }

        const response = Object.assign(Readable.from([Buffer.from("ok")]), {
          statusCode: 200,
          statusMessage: "OK",
          headers: {
            "content-type": "text/plain; charset=utf-8"
          }
        });
        onResponse?.(response);
      };

      request.destroy = (error?: Error) => {
        if (error) {
          request.emit("error", error);
        }
      };

      return request;
    }) as typeof http.request;

    const response = await fetchWithSwitchmaxxerTransport(
      "http://dns-rebind.test:4080/v1/chat/completions",
      {
        method: "POST",
        body: "hello"
      },
      {
        timeoutMs: 5_000,
        fetchImpl: async () => {
          fetchImplCalled = true;
          throw new Error("pinned DNS transport should bypass fetchImpl");
        },
        pinnedDnsResolution: {
          hostname: "dns-rebind.test",
          address: "127.0.0.1",
          family: 4
        }
      }
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(fetchImplCalled, false);
    assert.equal(observedUrlHost, "dns-rebind.test:4080");
    assert.equal(observedLookupAddress, "127.0.0.1");
    assert.equal(observedLookupFamily, 4);
    assert.equal(observedBody, "hello");
  } finally {
    (http as typeof http & { request: typeof http.request }).request = originalRequest;
  }
});
