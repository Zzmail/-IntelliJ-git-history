export type ChangedFileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U" | "B" | "X";

export interface RepositorySummary {
  id: string;
  name: string;
  rootUri: string;
  workspaceFolderName?: string;
  relativePath?: string;
  branch: string;
  head: string | null;
  detached: boolean;
  dirty: boolean;
}

export interface HistoryFilterState {
  selectedRepositoryIds: string[];
  query: string;
  branch: string;
  author: string;
  dateFrom: string;
  dateTo: string;
  paths: string[];
}

export interface CommitGraphInfo {
  lane: number;
  laneCount: number;
  parentLanes: number[];
}

export interface CommitActionAvailability {
  canCopyRevision: boolean;
  canCreatePatch: boolean;
  canCherryPick: boolean;
  canCheckoutRevision: boolean;
  canShowRepositoryAtRevision: boolean;
  canCompareWithLocal: boolean;
  canResetCurrentBranchToHere: boolean;
  canRevertCommit: boolean;
  canUndoCommit: boolean;
  canEditCommitMessage: boolean;
  disabledReasons: Partial<Record<CommitAction, string>>;
}

export interface CommitSummary {
  repositoryId: string;
  repositoryName: string;
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  references: string[];
  parents: string[];
  isHead: boolean;
  graph: CommitGraphInfo;
  actionAvailability: CommitActionAvailability;
}

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: ChangedFileStatus;
  additions?: number;
  deletions?: number;
  isBinary: boolean;
}

export interface CommitDetail extends CommitSummary {
  repositoryId: string;
  message: string;
  changedFiles: ChangedFile[];
}

export interface FileDiff {
  repositoryId: string;
  commitHash: string;
  path: string;
  oldPath?: string;
  beforeRef?: string;
  afterRef?: string;
  beforeContent?: string;
  afterContent?: string;
  patch: string;
  isBinary: boolean;
}

export interface HistoryPage {
  repository: RepositorySummary | null;
  repositories: RepositorySummary[];
  filters: HistoryFilterState;
  commits: CommitSummary[];
  selectedCommit?: CommitDetail;
  selectedDiff?: FileDiff;
  hasMore: boolean;
  nextCursor?: string;
  error?: string;
}

export type CommitAction =
  | "copyRevision"
  | "createPatch"
  | "cherryPick"
  | "checkoutRevision"
  | "showRepositoryAtRevision"
  | "compareWithLocal"
  | "resetCurrentBranchToHere"
  | "revertCommit"
  | "undoCommit"
  | "editCommitMessage";

export type FileAction =
  | "showDiff"
  | "showDiffInNewWindow"
  | "compareWithLocal"
  | "comparePreviousWithLocal"
  | "editSource"
  | "openRepositoryVersion"
  | "revertSelectedChanges"
  | "cherryPickSelectedChanges"
  | "createPatch"
  | "getFromRevision"
  | "showHistoryUpToHere"
  | "showChangesToParents";
