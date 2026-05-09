import { CommitGraphInfo, CommitSummary, HistoryFilterState } from "./models";

const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";

interface RawCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  body: string;
  references: string[];
  parents: string[];
}

export function createLogFormat(): string {
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

export function parseLogOutput(stdout: string): RawCommit[] {
  return stdout
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [
        hash = "",
        shortHash = "",
        authorName = "",
        authorEmail = "",
        authorDate = "",
        subject = "",
        body = "",
        refs = "",
        parents = ""
      ] = record.split(FIELD_SEPARATOR);

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

export function filterCommitsByQuery<T extends Pick<CommitSummary, "hash" | "shortHash" | "subject" | "body">>(
  commits: T[],
  filters: HistoryFilterState
): T[] {
  const query = filters.query.trim().toLowerCase();
  if (!query) {
    return commits;
  }

  return commits.filter((commit) => {
    const haystacks = [commit.hash, commit.shortHash, commit.subject, commit.body];
    return haystacks.some((value) => value.toLowerCase().includes(query));
  });
}

export function buildGraph(rawCommits: RawCommit[]): CommitGraphInfo[] {
  const lanes: Array<string | undefined> = [];
  const results: CommitGraphInfo[] = [];

  for (const commit of rawCommits) {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = lanes.findIndex((item) => !item);
      if (lane === -1) {
        lane = lanes.length;
      }
      lanes[lane] = commit.hash;
    }

    const parentLanes: number[] = [];
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

export function toCommitSummaries(
  rawCommits: RawCommit[],
  repositoryMeta: { repositoryId: string; repositoryName: string },
  isHeadHash: (hash: string) => boolean,
  actionAvailability: (commit: Omit<CommitSummary, "graph" | "actionAvailability">) => CommitSummary["actionAvailability"]
): CommitSummary[] {
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

export function parseNameStatus(stdout: string): Map<string, { status: string; oldPath?: string }> {
  const map = new Map<string, { status: string; oldPath?: string }>();
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
    } else {
      const path = parts[1];
      if (path) {
        map.set(path, { status });
      }
    }
  }

  return map;
}

export function parseNumstat(stdout: string): Map<string, { additions?: number; deletions?: number; isBinary: boolean }> {
  const map = new Map<string, { additions?: number; deletions?: number; isBinary: boolean }>();
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
