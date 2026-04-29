"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogFormat = createLogFormat;
exports.parseLogOutput = parseLogOutput;
exports.filterCommitsByQuery = filterCommitsByQuery;
exports.buildGraph = buildGraph;
exports.toCommitSummaries = toCommitSummaries;
exports.parseNameStatus = parseNameStatus;
exports.parseNumstat = parseNumstat;
const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";
function createLogFormat() {
    return [
        "%H",
        "%h",
        "%an",
        "%ae",
        "%aI",
        "%s",
        "%b",
        "%D",
        "%P"
    ].join("%x1f") + "%x1e";
}
function parseLogOutput(stdout) {
    return stdout
        .split(RECORD_SEPARATOR)
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
        const [hash = "", shortHash = "", authorName = "", authorEmail = "", authorDate = "", subject = "", body = "", refs = "", parents = ""] = record.split(FIELD_SEPARATOR);
        return {
            hash,
            shortHash,
            authorName,
            authorEmail,
            authorDate,
            subject,
            body,
            references: refs
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            parents: parents
                .split(" ")
                .map((item) => item.trim())
                .filter(Boolean)
        };
    });
}
function filterCommitsByQuery(commits, filters) {
    const query = filters.query.trim().toLowerCase();
    if (!query) {
        return commits;
    }
    return commits.filter((commit) => {
        const haystacks = [commit.hash, commit.shortHash, commit.subject, commit.body];
        return haystacks.some((value) => value.toLowerCase().includes(query));
    });
}
function buildGraph(rawCommits) {
    const lanes = [];
    const results = [];
    for (const commit of rawCommits) {
        let lane = lanes.indexOf(commit.hash);
        if (lane === -1) {
            lane = lanes.findIndex((item) => !item);
            if (lane === -1) {
                lane = lanes.length;
            }
            lanes[lane] = commit.hash;
        }
        const parentLanes = [];
        lanes[lane] = undefined;
        commit.parents.forEach((parent, index) => {
            let parentLane = lanes.indexOf(parent);
            if (parentLane === -1) {
                parentLane = index === 0 ? lane : lanes.findIndex((item) => !item);
                if (parentLane === -1) {
                    parentLane = lanes.length;
                }
                lanes[parentLane] = parent;
            }
            parentLanes.push(parentLane);
        });
        while (lanes.length > 0 && lanes[lanes.length - 1] === undefined) {
            lanes.pop();
        }
        results.push({
            lane,
            laneCount: Math.max(lanes.length, lane + 1, 1),
            parentLanes
        });
    }
    return results;
}
function toCommitSummaries(rawCommits, repositoryMeta, isHeadHash, actionAvailability) {
    const graph = buildGraph(rawCommits);
    return rawCommits.map((commit, index) => {
        const summaryBase = {
            repositoryId: repositoryMeta.repositoryId,
            repositoryName: repositoryMeta.repositoryName,
            hash: commit.hash,
            shortHash: commit.shortHash,
            subject: commit.subject,
            body: commit.body,
            authorName: commit.authorName,
            authorEmail: commit.authorEmail,
            authorDate: commit.authorDate,
            references: commit.references,
            parents: commit.parents,
            isHead: isHeadHash(commit.hash)
        };
        return {
            ...summaryBase,
            graph: graph[index],
            actionAvailability: actionAvailability(summaryBase)
        };
    });
}
function parseNameStatus(stdout) {
    const map = new Map();
    const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    for (const line of lines) {
        const parts = line.split("\t");
        const rawStatus = parts[0] ?? "M";
        const status = rawStatus.charAt(0);
        if (status === "R" || status === "C") {
            const oldPath = parts[1];
            const newPath = parts[2];
            if (newPath) {
                map.set(newPath, { status, oldPath });
            }
        }
        else {
            const path = parts[1];
            if (path) {
                map.set(path, { status });
            }
        }
    }
    return map;
}
function parseNumstat(stdout) {
    const map = new Map();
    const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    for (const line of lines) {
        const parts = line.split("\t");
        if (parts.length < 3) {
            continue;
        }
        const [additionsRaw, deletionsRaw, ...pathParts] = parts;
        const path = pathParts[pathParts.length - 1];
        if (!path) {
            continue;
        }
        const isBinary = additionsRaw === "-" || deletionsRaw === "-";
        map.set(path, {
            additions: isBinary ? undefined : Number.parseInt(additionsRaw, 10),
            deletions: isBinary ? undefined : Number.parseInt(deletionsRaw, 10),
            isBinary
        });
    }
    return map;
}
//# sourceMappingURL=parsers.js.map