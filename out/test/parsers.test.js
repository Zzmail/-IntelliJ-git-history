"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const parsers_1 = require("../git/parsers");
(0, node_test_1.default)("parseLogOutput parses formatted git log records", () => {
    const raw = "abc123\u001fab12\u001fAlice\u001falice@example.com\u001f2026-04-25T12:00:00+08:00\u001fSubject\u001fBody line\u001fHEAD -> main, tag: v1\u001fdef456\u001e";
    const [commit] = (0, parsers_1.parseLogOutput)(raw);
    strict_1.default.equal(commit.hash, "abc123");
    strict_1.default.equal(commit.shortHash, "ab12");
    strict_1.default.equal(commit.authorName, "Alice");
    strict_1.default.deepEqual(commit.references, ["HEAD -> main", "tag: v1"]);
    strict_1.default.deepEqual(commit.parents, ["def456"]);
});
(0, node_test_1.default)("filterCommitsByQuery matches hash and message", () => {
    const filters = {
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
    const result = (0, parsers_1.filterCommitsByQuery)(commits, filters);
    strict_1.default.equal(result.length, 1);
    strict_1.default.equal(result[0]?.hash, "aaa111");
});
(0, node_test_1.default)("buildGraph assigns lanes for merge history", () => {
    const graph = (0, parsers_1.buildGraph)([
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
    strict_1.default.equal(graph[0]?.lane, 0);
    strict_1.default.equal(graph[0]?.parentLanes.length, 2);
});
//# sourceMappingURL=parsers.test.js.map