import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiProvider, CompleteRequest } from "../providers/index.js";
import type { RetrievedChunk } from "./retrieval.js";
import { makeReranker } from "./reranker.js";

function chunk(path: string): RetrievedChunk {
  return { path, chunk: `content of ${path}`, score: 1 };
}

/** A provider whose `complete` returns canned text, counting its calls. */
function stub(
  impl: (req: CompleteRequest) => Promise<{ text: string }>,
): { provider: AiProvider; calls: () => number } {
  let n = 0;
  const provider: AiProvider = {
    id: "mock",
    complete: async (req) => {
      n += 1;
      return impl(req);
    },
    completeStream: async () => ({ text: "" }),
  };
  return { provider, calls: () => n };
}

const ABCD = [chunk("a"), chunk("b"), chunk("c"), chunk("d")];
const paths = (cs: RetrievedChunk[]): string[] => cs.map((c) => c.path);

test("reranker reorders candidates by the model's ranking", async () => {
  const { provider } = stub(async () => ({ text: '{"ranking":[2,0]}' }));
  const rerank = makeReranker(provider);
  const out = await rerank("q", ABCD, 2);
  assert.deepEqual(paths(out), ["c", "a"]);
});

test("reranker never drops a candidate — omitted ones keep retrieval order behind the picks", async () => {
  const { provider } = stub(async () => ({ text: '{"ranking":[1]}' }));
  const rerank = makeReranker(provider);
  const out = await rerank("q", [chunk("a"), chunk("b"), chunk("c")], 3);
  // b picked first; a and c (omitted) follow in their original order; nothing lost.
  assert.deepEqual(paths(out), ["b", "a", "c"]);
});

test("reranker filters out-of-range and duplicate indices", async () => {
  const { provider } = stub(async () => ({ text: '{"ranking":[5,1,1,-1,0]}' }));
  const rerank = makeReranker(provider);
  const out = await rerank("q", [chunk("a"), chunk("b"), chunk("c")], 3);
  // valid order from the model is [1,0] → b, a; then the omitted c.
  assert.deepEqual(paths(out), ["b", "a", "c"]);
});

test("reranker fails safe to retrieval order on non-JSON output", async () => {
  const { provider } = stub(async () => ({ text: "sorry, I can't do that" }));
  const rerank = makeReranker(provider);
  const out = await rerank("q", ABCD, 3);
  assert.deepEqual(paths(out), ["a", "b", "c"]);
});

test("reranker fails safe to retrieval order when the provider throws", async () => {
  const { provider } = stub(async () => {
    throw new Error("provider exploded");
  });
  const rerank = makeReranker(provider);
  const out = await rerank("q", ABCD, 2);
  assert.deepEqual(paths(out), ["a", "b"]);
});

test("reranker short-circuits a single candidate without calling the model", async () => {
  const { provider, calls } = stub(async () => ({ text: '{"ranking":[0]}' }));
  const rerank = makeReranker(provider);
  const out = await rerank("q", [chunk("a")], 3);
  assert.deepEqual(paths(out), ["a"]);
  assert.equal(calls(), 0);
});
