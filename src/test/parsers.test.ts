import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, filterCommitsByQuery, parseLogOutput } from "../git/parsers";
import { HistoryFilterState } from "../git/models";

test("parseLogOutput parses formatted git log records", () => {
  const raw = "abc123\u001fab12\u001fAlice\u001falice@example.com\u001f2026-04-25T12:00:00+08:00\u001fSubject\u001fBody line\u001fHEAD -> main, tag: v1\u001fdef456\u001e";
  const [commit] = parseLogOutput(raw);

  assert.equal(commit.hash, "abc123");
  assert.equal(commit.shortHash, "ab12");
  assert.equal(commit.authorName, "Alice");
  assert.deepEqual(commit.references, ["HEAD -> main", "tag: v1"]);
  assert.deepEqual(commit.parents, ["def456"]);
});

test("filterCommitsByQuery matches hash and message", () => {
  const filters: HistoryFilterState = {
    selectedRepositoryIds: ["repo"],
    query: "fix",
    branch: "",
    author: "",
    dateFrom: "",
    dateTo: "",
    paths: []
  };

  const commits = [
    { hash: "aaa111", shortHash: "aaa111", subject: "Fix issue", body: "" },
    { hash: "bbb222", shortHash: "bbb222", subject: "Feat", body: "Adds view" }
  ];

  const result = filterCommitsByQuery(commits, filters);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.hash, "aaa111");
});

test("buildGraph assigns lanes for merge history", () => {
  const graph = buildGraph([
    {
      hash: "c3",
      shortHash: "c3",
      authorName: "",
      authorEmail: "",
      authorDate: "",
      subject: "",
      body: "",
      references: [],
      parents: ["c2", "b2"]
    },
    {
      hash: "c2",
      shortHash: "c2",
      authorName: "",
      authorEmail: "",
      authorDate: "",
      subject: "",
      body: "",
      references: [],
      parents: ["c1"]
    }
  ]);

  assert.equal(graph[0]?.lane, 0);
  assert.equal(graph[0]?.parentLanes.length, 2);
});
