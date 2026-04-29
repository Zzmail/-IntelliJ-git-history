import { CommitAction, CommitActionAvailability, CommitSummary, RepositorySummary } from "./models";

function reasonMap(): Partial<Record<CommitAction, string>> {
  return {};
}

export function computeActionAvailability(
  repository: RepositorySummary,
  commit: Pick<CommitSummary, "hash" | "parents" | "isHead">
): CommitActionAvailability {
  const disabledReasons = reasonMap();
  const isMerge = commit.parents.length > 1;

  if (repository.detached) {
    disabledReasons.resetCurrentBranchToHere = "当前不在分支上，无法重置当前分支。";
  }

  if (repository.dirty) {
    disabledReasons.cherryPick = "工作区存在未提交改动。";
    disabledReasons.checkoutRevision = "工作区存在未提交改动。";
    disabledReasons.resetCurrentBranchToHere = disabledReasons.resetCurrentBranchToHere ?? "工作区存在未提交改动。";
    disabledReasons.revertCommit = "工作区存在未提交改动。";
    disabledReasons.undoCommit = "工作区存在未提交改动。";
    disabledReasons.editCommitMessage = "工作区存在未提交改动。";
  }

  if (!commit.parents.length) {
    disabledReasons.undoCommit = "根提交无法撤消。";
  }

  if (!commit.isHead) {
    disabledReasons.undoCommit = "只有当前 HEAD 提交支持撤消。";
    disabledReasons.editCommitMessage = "只有当前 HEAD 提交支持编辑提交消息。";
  }

  if (isMerge) {
    disabledReasons.revertCommit = "暂不支持对合并提交执行还原。";
  }

  return {
    canCopyRevision: true,
    canCreatePatch: true,
    canCherryPick: !disabledReasons.cherryPick,
    canCheckoutRevision: !disabledReasons.checkoutRevision,
    canShowRepositoryAtRevision: true,
    canCompareWithLocal: true,
    canResetCurrentBranchToHere: !disabledReasons.resetCurrentBranchToHere,
    canRevertCommit: !disabledReasons.revertCommit,
    canUndoCommit: !disabledReasons.undoCommit,
    canEditCommitMessage: !disabledReasons.editCommitMessage,
    disabledReasons
  };
}
