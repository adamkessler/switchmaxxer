import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpResponseBodyTooLargeError,
  parseJsonObjectResponseWithinBounds,
  readResponseTextWithinBounds
} from "./http-json";
import { HARD_MAX_JSON_SERIALIZED_BYTES } from "./json-bounds";

void test("bounded response reader rejects declared oversized bodies before buffering", async () => {
  const response = new Response("{}", {
    headers: {
      "content-length": String(HARD_MAX_JSON_SERIALIZED_BYTES + 1)
    }
  });

  await assert.rejects(
    () => parseJsonObjectResponseWithinBounds(response),
    (error: unknown) => error instanceof HttpResponseBodyTooLargeError
  );
});

void test("bounded response reader rejects streamed bodies over the byte cap", async () => {
  const response = new Response("12345");

  await assert.rejects(
    () => readResponseTextWithinBounds(response, 4),
    (error: unknown) => error instanceof HttpResponseBodyTooLargeError
  );
});

void test("bounded JSON response parser requires object payloads", async () => {
  await assert.rejects(
    () => parseJsonObjectResponseWithinBounds(new Response("[]")),
    /json_payload_not_object/
  );

  const payload = await parseJsonObjectResponseWithinBounds(new Response("{\"ok\":true}"));
  assert.equal(payload["ok"], true);
});
