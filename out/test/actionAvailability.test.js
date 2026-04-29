"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const availability_1 = require("../git/availability");
const repository = {
    id: "repo",
    name: "repo",
    rootUri: "/repo",
    branch: "main",
    head: "head123",
    detached: false,
    dirty: false
};
(0, node_test_1.default)("HEAD commit can edit message and undo when repository is clean", () => {
    const availability = (0, availability_1.computeActionAvailability)(repository, {
        hash: "head123",
        parents: ["prev456"],
        isHead: true
    });
    strict_1.default.equal(availability.canUndoCommit, true);
    strict_1.default.equal(availability.canEditCommitMessage, true);
});
(0, node_test_1.default)("dirty repository disables destructive actions", () => {
    const availability = (0, availability_1.computeActionAvailability)({ ...repository, dirty: true }, {
        hash: "head123",
        parents: ["prev456"],
        isHead: true
    });
    strict_1.default.equal(availability.canCherryPick, false);
    strict_1.default.equal(availability.canCheckoutRevision, false);
    strict_1.default.match(availability.disabledReasons.cherryPick ?? "", /工作区/);
});
//# sourceMappingURL=actionAvailability.test.js.map