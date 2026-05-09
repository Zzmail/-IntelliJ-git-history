import test from "node:test";
import assert from "node:assert/strict";
import { computeActionAvailability } from "../git/availability";
import { RepositorySummary } from "../git/models";

const repository: RepositorySummary = {
  id: "repo",
  name: "repo",
  rootUri: "/repo",
  branch: "main",
  head: "head123",
  detached: false,
  dirty: false
};

test("HEAD commit can edit message and undo when repository is clean", () => {
  const availability = computeActionAvailability(repository, {
    hash: "head123",
    parents: ["prev456"],
    isHead: true
  });

  assert.equal(availability.canUndoCommit, true);
  assert.equal(availability.canEditCommitMessage, true);
});

test("dirty repository disables destructive actions", () => {
  const availability = computeActionAvailability(
    { ...repository, dirty: true },
    {
      hash: "head123",
      parents: ["prev456"],
      isHead: true
    }
  );

  assert.equal(availability.canCherryPick, false);
  assert.equal(availability.canCheckoutRevision, false);
  assert.match(availability.disabledReasons.cherryPick ?? "", /工作区/);
});
