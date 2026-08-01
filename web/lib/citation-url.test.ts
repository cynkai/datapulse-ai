import assert from "node:assert/strict";
import test from "node:test";
import { isSafeCitationUrl } from "./citation-url.ts";

test("accepts HTTP and HTTPS citation links", () => {
  assert.equal(isSafeCitationUrl("http://example.com/source"), true);
  assert.equal(isSafeCitationUrl("https://example.com/source"), true);
});

test("rejects non-HTTP citation links before CitationList can render them", () => {
  assert.equal(isSafeCitationUrl("javascript:alert(1)"), false);
  assert.equal(isSafeCitationUrl("data:text/html,unsafe"), false);
  assert.equal(isSafeCitationUrl("mailto:unsafe@example.com"), false);
  assert.equal(isSafeCitationUrl("not a URL"), false);
});
