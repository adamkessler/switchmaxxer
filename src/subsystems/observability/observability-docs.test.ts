import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  OBSERVATION_EVENTS,
  OBSERVATION_KINDS,
  OBSERVATION_OUTCOMES,
  OBSERVATION_STAGES
} from "./types";

function extractBacktickedBulletList(documentText: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = documentText.match(new RegExp(`### ${escapedHeading}\\n\\n((?:- \`[^\\n]+\`\\n)+)`));
  assert.ok(match, `missing heading block for ${heading}`);
  const block = match[1];
  if (typeof block !== "string") {
    throw new Error(`missing bullet block for ${heading}`);
  }

  return block
    .trim()
    .split("\n")
    .map((line) => {
      const itemMatch = line.match(/^- `(.+)`$/);
      assert.ok(itemMatch, `invalid bullet line under ${heading}: ${line}`);
      const value = itemMatch[1];
      if (typeof value !== "string") {
        throw new Error(`missing bullet value under ${heading}`);
      }
      return value;
    });
}

void test("observability logging reference enumerates the canonical observation enums from source", () => {
  const documentPath = path.resolve(
    __dirname,
    "../../../docs/subsystems/observability/switchmaxxer-logging-reference.md"
  );
  const documentText = readFileSync(documentPath, "utf8");

  assert.deepEqual(extractBacktickedBulletList(documentText, "`OBSERVATION_EVENTS`"), [...OBSERVATION_EVENTS]);
  assert.deepEqual(extractBacktickedBulletList(documentText, "`OBSERVATION_KINDS`"), [...OBSERVATION_KINDS]);
  assert.deepEqual(extractBacktickedBulletList(documentText, "`OBSERVATION_OUTCOMES`"), [...OBSERVATION_OUTCOMES]);
  assert.deepEqual(extractBacktickedBulletList(documentText, "`OBSERVATION_STAGES`"), [...OBSERVATION_STAGES]);
});
