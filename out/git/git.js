"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHistoryContentProvider = exports.GitRepositoryService = void 0;
const cp = __importStar(require("node:child_process"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const util = __importStar(require("node:util"));
const vscode = __importStar(require("vscode"));
const availability_1 = require("./availability");
const parsers_1 = require("./parsers");
const execFile = util.promisify(cp.execFile);
const DEFAULT_PAGE_SIZE = 60;
const MAX_HISTORY_SCAN_PER_REPOSITORY = 300;
const IGNORED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    ".pnpm-store",
    ".yarn",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "out",
    "target",
    "coverage",
    ".idea",
    ".vscode"
]);
class GitRepositoryService {
    context;
    disposables = [];
    repositories = [];
    onDidChangeRepositoriesEmitter = new vscode.EventEmitter();
    onDidRefreshEmitter = new vscode.EventEmitter();
    onDidChangeRepositories = this.onDidChangeRepositoriesEmitter.event;
    onDidRefresh = this.onDidRefreshEmitter.event;
    constructor(context) {
        this.context = context;
        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshRepositories()), vscode.workspace.onDidSaveTextDocument(() => void this.refreshRepositories()));
    }
    dispose() {
        this.disposables.forEach((item) => item.dispose());
        this.onDidChangeRepositoriesEmitter.dispose();
        this.onDidRefreshEmitter.dispose();
    }
    async refreshRepositories() {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const discovered = new Map();
        for (const folder of folders) {
            const repositories = await this.discoverRepositoriesUnderFolder(folder);
            for (const repo of repositories) {
                discovered.set(repo.id, repo);
            }
        }
        this.repositories = [...discovered.values()].sort((left, right) => (left.relativePath ?? left.rootUri).localeCompare(right.relativePath ?? right.rootUri));
        this.onDidChangeRepositoriesEmitter.fire(this.repositories);
        this.onDidRefreshEmitter.fire();
        return this.repositories;
    }
    listRepositories() {
        return this.repositories;
    }
    async getHistory(filters, cursorToken, pageSize = DEFAULT_PAGE_SIZE) {
        const repositories = this.repositories.length ? this.repositories : await this.refreshRepositories();
        const selectedRepositories = this.getSelectedRepositories(repositories, filters.selectedRepositoryIds);
        const normalizedFilters = this.normalizeFilters(filters, repositories);
        if (!selectedRepositories.length) {
            return {
                repository: null,
                repositories,
                filters: normalizedFilters,
                commits: [],
                hasMore: false
            };
        }
        const globalOffset = Number.parseInt(cursorToken ?? "0", 10) || 0;
        const historyPages = await Promise.all(selectedRepositories.map(async (repository) => ({
            repository,
            page: await this.getRepositoryHistoryPage(repository, normalizedFilters, 0, Math.max(pageSize, MAX_HISTORY_SCAN_PER_REPOSITORY))
        })));
        const merged = historyPages
            .flatMap(({ page }) => page.commits)
            .sort(compareCommitsByDate);
        const commits = merged.slice(globalOffset, globalOffset + pageSize);
        const hasMore = merged.length > globalOffset + pageSize || historyPages.some(({ page }) => page.hasMore);
        return {
            repository: selectedRepositories[0] ?? null,
            repositories,
            filters: normalizedFilters,
            commits,
            hasMore,
            nextCursor: hasMore ? String(globalOffset + pageSize) : undefined
        };
    }
    async getCommitDetail(repositoryId, hash) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const { stdout: metaStdout } = await this.execGit(repository.rootUri, [
            "show",
            "--no-patch",
            "--decorate=short",
            `--format=${(0, parsers_1.createLogFormat)()}`,
            hash
        ]);
        const [summary] = (0, parsers_1.toCommitSummaries)((0, parsers_1.parseLogOutput)(metaStdout), { repositoryId: repository.id, repositoryName: repository.name }, (candidate) => candidate === repository.head, (commit) => (0, availability_1.computeActionAvailability)(repository, commit));
        const [{ stdout: nameStatusStdout }, { stdout: numStatStdout }] = await Promise.all([
            this.execGit(repository.rootUri, ["show", "--format=", "--name-status", "--find-renames", hash]),
            this.execGit(repository.rootUri, ["show", "--format=", "--numstat", "--find-renames", hash])
        ]);
        const statuses = (0, parsers_1.parseNameStatus)(nameStatusStdout);
        const numStats = (0, parsers_1.parseNumstat)(numStatStdout);
        const changedFiles = [];
        for (const [filePath, statusEntry] of statuses.entries()) {
            const statEntry = numStats.get(filePath);
            changedFiles.push({
                path: filePath,
                oldPath: statusEntry.oldPath,
                status: statusEntry.status,
                additions: statEntry?.additions,
                deletions: statEntry?.deletions,
                isBinary: statEntry?.isBinary ?? false
            });
        }
        const message = [summary.subject, summary.body].filter(Boolean).join("\n\n");
        return {
            ...summary,
            repositoryId,
            message,
            changedFiles
        };
    }
    async getFileDiff(repositoryId, hash, filePath, oldPath) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const detail = await this.getCommitDetail(repositoryId, hash);
        const changedFile = detail.changedFiles.find((item) => item.path === filePath);
        const parent = detail.parents[0];
        const originalPath = oldPath ?? changedFile?.oldPath ?? filePath;
        const targetStatus = changedFile?.status ?? "M";
        const [patchResult, beforeContent, afterContent] = await Promise.all([
            this.execGit(repository.rootUri, [
                "show",
                "--format=",
                "--find-renames",
                hash,
                "--",
                targetStatus === "D" ? originalPath : filePath
            ]).catch(() => ({ stdout: "" })),
            parent && targetStatus !== "A"
                ? this.readRevisionFile(repository.rootUri, parent, originalPath).catch(() => undefined)
                : Promise.resolve(undefined),
            targetStatus !== "D"
                ? this.readRevisionFile(repository.rootUri, hash, filePath).catch(() => undefined)
                : Promise.resolve(undefined)
        ]);
        const patch = patchResult.stdout;
        const isBinary = changedFile?.isBinary ?? patch.includes("Binary files");
        return {
            repositoryId,
            commitHash: hash,
            path: filePath,
            oldPath: changedFile?.oldPath,
            beforeRef: parent && targetStatus !== "A" ? parent : undefined,
            afterRef: targetStatus !== "D" ? hash : undefined,
            beforeContent,
            afterContent,
            patch,
            isBinary
        };
    }
    async getRevisionTree(repositoryId, hash) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const { stdout } = await this.execGit(repository.rootUri, ["ls-tree", "-r", "--name-only", hash]);
        return stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    }
    async getFileContentByRevision(repositoryId, ref, relativePath) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        return this.readRevisionFile(repository.rootUri, ref, relativePath);
    }
    async openDiffWithLocal(repositoryId, hash, filePath) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const targetPath = path.join(repository.rootUri, filePath);
        const title = `${path.basename(filePath)} (${hash.slice(0, 7)} ↔ 工作区)`;
        const leftUri = GitHistoryContentProvider.buildUri(repositoryId, hash, filePath);
        const rightUri = vscode.Uri.file(targetPath);
        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
    }
    async openPreviousVersionWithLocal(repositoryId, hash, filePath, oldPath) {
        const detail = await this.getCommitDetail(repositoryId, hash);
        const changedFile = detail.changedFiles.find((item) => item.path === filePath);
        const beforeRef = detail.parents[0];
        if (!beforeRef) {
            throw new Error("根提交没有父版本可供比较。");
        }
        const repository = this.getRepositoryOrThrow(repositoryId);
        const localUri = vscode.Uri.file(path.join(repository.rootUri, filePath));
        const leftUri = GitHistoryContentProvider.buildUri(repositoryId, beforeRef, changedFile?.oldPath ?? oldPath ?? filePath);
        const title = `${path.basename(filePath)} (${beforeRef.slice(0, 7)} ↔ 工作区)`;
        await vscode.commands.executeCommand("vscode.diff", leftUri, localUri, title);
    }
    async openCommitFileDiff(repositoryId, hash, filePath, oldPath, options) {
        const detail = await this.getCommitDetail(repositoryId, hash);
        const changedFile = detail.changedFiles.find((item) => item.path === filePath);
        const beforeRef = detail.parents[0];
        const leftUri = beforeRef && changedFile?.status !== "A"
            ? GitHistoryContentProvider.buildUri(repositoryId, beforeRef, changedFile?.oldPath ?? oldPath ?? filePath)
            : GitHistoryContentProvider.buildEmptyUri(filePath);
        const rightUri = changedFile?.status === "D"
            ? GitHistoryContentProvider.buildEmptyUri(filePath)
            : GitHistoryContentProvider.buildUri(repositoryId, hash, filePath);
        const title = `${path.basename(filePath)} (${hash.slice(0, 7)})`;
        await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, options);
    }
    async openRepositoryVersion(repositoryId, hash, filePath) {
        const uri = GitHistoryContentProvider.buildUri(repositoryId, hash, filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
    }
    async editSource(repositoryId, filePath) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const target = vscode.Uri.file(path.join(repository.rootUri, filePath));
        const document = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(document, { preview: false });
    }
    async runCommitAction(repositoryId, hash, action) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const detail = await this.getCommitDetail(repositoryId, hash);
        const availability = detail.actionAvailability;
        if (action === "copyRevision") {
            await vscode.env.clipboard.writeText(hash);
            void vscode.window.setStatusBarMessage(`已复制修订号 ${hash.slice(0, 7)}`, 2500);
            return;
        }
        if (action === "showRepositoryAtRevision") {
            await this.showRepositoryAtRevision(repositoryId, hash);
            return;
        }
        if (action === "compareWithLocal") {
            const file = await this.pickCommitFile(detail);
            if (file) {
                await this.openDiffWithLocal(repositoryId, hash, file.path);
            }
            return;
        }
        const guard = {
            createPatch: availability.canCreatePatch,
            cherryPick: availability.canCherryPick,
            checkoutRevision: availability.canCheckoutRevision,
            resetCurrentBranchToHere: availability.canResetCurrentBranchToHere,
            revertCommit: availability.canRevertCommit,
            undoCommit: availability.canUndoCommit,
            editCommitMessage: availability.canEditCommitMessage
        };
        if (action in guard && !guard[action]) {
            const reason = availability.disabledReasons[action] ?? "当前状态下无法执行该操作。";
            throw new Error(reason);
        }
        switch (action) {
            case "createPatch": {
                const defaultUri = vscode.Uri.file(path.join(repository.rootUri, `${hash.slice(0, 7)}.patch`));
                const target = await vscode.window.showSaveDialog({
                    defaultUri,
                    filters: { Patch: ["patch"] },
                    saveLabel: "创建补丁"
                });
                if (!target) {
                    return;
                }
                const { stdout } = await this.execGit(repository.rootUri, ["format-patch", "-1", hash, "--stdout"]);
                await fs.writeFile(target.fsPath, stdout, "utf8");
                break;
            }
            case "cherryPick":
                await this.execGit(repository.rootUri, ["cherry-pick", hash]);
                break;
            case "checkoutRevision":
                await this.execGit(repository.rootUri, ["checkout", hash]);
                break;
            case "resetCurrentBranchToHere": {
                const mode = await vscode.window.showQuickPick([
                    { label: "soft", description: "保留暂存区与工作区改动" },
                    { label: "mixed", description: "保留工作区改动，重置暂存区" },
                    { label: "hard", description: "丢弃工作区改动" }
                ], {
                    title: "将当前分支重置到此处",
                    placeHolder: "选择 reset 模式"
                });
                if (!mode) {
                    return;
                }
                const confirmed = await vscode.window.showWarningMessage(`确定执行 git reset --${mode.label} ${hash.slice(0, 7)} 吗？`, { modal: true }, "继续");
                if (confirmed !== "继续") {
                    return;
                }
                await this.execGit(repository.rootUri, ["reset", `--${mode.label}`, hash]);
                break;
            }
            case "revertCommit":
                await this.execGit(repository.rootUri, ["revert", "--no-edit", hash]);
                break;
            case "undoCommit":
                await this.execGit(repository.rootUri, ["reset", "--soft", "HEAD~1"]);
                break;
            case "editCommitMessage": {
                const currentMessage = detail.message || detail.subject;
                const nextMessage = await vscode.window.showInputBox({
                    title: "编辑提交消息",
                    prompt: "输入新的提交消息",
                    value: currentMessage,
                    ignoreFocusOut: true
                });
                if (!nextMessage || nextMessage === currentMessage) {
                    return;
                }
                await this.execGit(repository.rootUri, ["commit", "--amend", "-m", nextMessage]);
                break;
            }
            default:
                break;
        }
        await this.refreshRepositories();
    }
    async runFileAction(repositoryId, hash, filePath, oldPath, action) {
        switch (action) {
            case "showDiff":
            case "showChangesToParents":
                await this.openCommitFileDiff(repositoryId, hash, filePath, oldPath);
                return;
            case "showDiffInNewWindow":
                await this.openCommitFileDiff(repositoryId, hash, filePath, oldPath, {
                    viewColumn: vscode.ViewColumn.Beside,
                    preview: false
                });
                return;
            case "compareWithLocal":
                await this.openDiffWithLocal(repositoryId, hash, filePath);
                return;
            case "comparePreviousWithLocal":
                await this.openPreviousVersionWithLocal(repositoryId, hash, filePath, oldPath);
                return;
            case "editSource":
                await this.editSource(repositoryId, filePath);
                return;
            case "openRepositoryVersion":
                await this.openRepositoryVersion(repositoryId, hash, filePath);
                return;
            case "revertSelectedChanges":
                await this.applySelectedChange(repositoryId, hash, filePath, true);
                await this.refreshRepositories();
                return;
            case "cherryPickSelectedChanges":
                await this.applySelectedChange(repositoryId, hash, filePath, false);
                await this.refreshRepositories();
                return;
            case "createPatch":
                await this.createFilePatch(repositoryId, hash, filePath, oldPath);
                return;
            case "getFromRevision":
                await this.restoreFileFromRevision(repositoryId, hash, filePath);
                await this.refreshRepositories();
                return;
            case "showHistoryUpToHere":
                return { applyPathFilter: filePath };
            default:
                return;
        }
    }
    async getRepositoryHistoryPage(repository, filters, cursor = 0, pageSize = DEFAULT_PAGE_SIZE) {
        const args = [
            "log",
            "--topo-order",
            "--decorate=short",
            `--skip=${cursor}`,
            "-n",
            `${pageSize}`,
            `--format=${(0, parsers_1.createLogFormat)()}`
        ];
        if (filters.branch.trim()) {
            args.push(filters.branch.trim());
        }
        if (filters.author.trim()) {
            args.push(`--author=${filters.author.trim()}`);
        }
        if (filters.dateFrom.trim()) {
            args.push(`--since=${filters.dateFrom.trim()}`);
        }
        if (filters.dateTo.trim()) {
            args.push(`--until=${filters.dateTo.trim()}`);
        }
        if (filters.paths.length) {
            args.push("--", ...filters.paths);
        }
        let stdout = "";
        try {
            ({ stdout } = await this.execGit(repository.rootUri, args));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (/does not have any commits yet|your current branch .* does not have any commits yet/i.test(message)) {
                return { commits: [], hasMore: false };
            }
            throw error;
        }
        const rawCommits = (0, parsers_1.parseLogOutput)(stdout);
        const commits = (0, parsers_1.filterCommitsByQuery)((0, parsers_1.toCommitSummaries)(rawCommits, { repositoryId: repository.id, repositoryName: repository.name }, (hash) => hash === repository.head, (commit) => (0, availability_1.computeActionAvailability)(repository, commit)), filters);
        return {
            commits,
            hasMore: rawCommits.length === pageSize
        };
    }
    getSelectedRepositories(repositories, selectedIds) {
        if (!selectedIds.length) {
            return repositories;
        }
        const selectedSet = new Set(selectedIds);
        return repositories.filter((repository) => selectedSet.has(repository.id));
    }
    normalizeFilters(filters, repositories) {
        const repositoryIds = repositories.map((repository) => repository.id);
        const selectedRepositoryIds = filters.selectedRepositoryIds.length
            ? filters.selectedRepositoryIds.filter((id) => repositoryIds.includes(id))
            : repositoryIds;
        return {
            selectedRepositoryIds: selectedRepositoryIds.length ? selectedRepositoryIds : repositoryIds,
            query: filters.query,
            branch: filters.branch,
            author: filters.author,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            paths: filters.paths
        };
    }
    async showRepositoryAtRevision(repositoryId, hash) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const files = await this.getRevisionTree(repositoryId, hash);
        const picked = await vscode.window.showQuickPick(files.map((file) => ({ label: file, description: hash.slice(0, 7) })), {
            title: `在修订版中显示仓库 ${hash.slice(0, 7)}`,
            matchOnDescription: true,
            placeHolder: "选择文件以只读打开"
        });
        if (!picked) {
            return;
        }
        const uri = GitHistoryContentProvider.buildUri(repository.id, hash, picked.label);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
    }
    async pickCommitFile(detail) {
        if (!detail.changedFiles.length) {
            return undefined;
        }
        const picked = await vscode.window.showQuickPick(detail.changedFiles.map((item) => ({
            label: item.path,
            description: item.status,
            detail: item.oldPath ? `由 ${item.oldPath} 重命名` : undefined
        })), {
            title: "选择要比较的文件",
            matchOnDescription: true
        });
        if (!picked) {
            return undefined;
        }
        return detail.changedFiles.find((item) => item.path === picked.label);
    }
    getRepositoryOrThrow(repositoryId) {
        const repository = this.repositories.find((item) => item.id === repositoryId);
        if (!repository) {
            throw new Error("未找到目标仓库。");
        }
        return repository;
    }
    async discoverRepositoriesUnderFolder(folder) {
        const discovered = new Map();
        const queue = [folder.uri.fsPath];
        while (queue.length > 0) {
            const currentPath = queue.shift();
            if (!currentPath) {
                continue;
            }
            let entries;
            try {
                entries = await fs.readdir(currentPath, { withFileTypes: true });
            }
            catch {
                continue;
            }
            const hasGitMarker = entries.some((entry) => entry.name === ".git");
            if (hasGitMarker) {
                const repository = await this.tryDiscoverRepository(currentPath, folder);
                if (repository) {
                    discovered.set(repository.id, repository);
                }
            }
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                if (IGNORED_DIRECTORIES.has(entry.name)) {
                    continue;
                }
                queue.push(path.join(currentPath, entry.name));
            }
        }
        if (!discovered.size) {
            const fallback = await this.tryDiscoverRepository(folder.uri.fsPath, folder);
            if (fallback) {
                discovered.set(fallback.id, fallback);
            }
        }
        return [...discovered.values()];
    }
    async tryDiscoverRepository(folderPath, workspaceFolder) {
        try {
            const { stdout } = await this.execGit(folderPath, ["rev-parse", "--show-toplevel"]);
            const rootUri = stdout.trim();
            if (!rootUri) {
                return undefined;
            }
            const branchResult = await this.execGit(rootUri, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({ stdout: "HEAD" }));
            const headResult = await this.execGit(rootUri, ["rev-parse", "HEAD"]).catch(() => ({ stdout: "" }));
            const statusResult = await this.execGit(rootUri, ["status", "--porcelain=v1", "--branch"]).catch(() => ({ stdout: "" }));
            const branch = branchResult.stdout.trim() || "HEAD";
            const dirty = statusResult.stdout
                .split(/\r?\n/)
                .slice(1)
                .some((line) => line.trim().length > 0);
            const relativePath = workspaceFolder
                ? path.relative(workspaceFolder.uri.fsPath, rootUri).replace(/\\/g, "/") || "."
                : ".";
            const name = relativePath === "." ? path.basename(rootUri) : relativePath;
            return {
                id: rootUri,
                name,
                rootUri,
                workspaceFolderName: workspaceFolder?.name,
                relativePath,
                branch,
                head: headResult.stdout.trim() || null,
                detached: branch === "HEAD",
                dirty
            };
        }
        catch {
            return undefined;
        }
    }
    async readRevisionFile(repositoryRoot, ref, relativePath) {
        const { stdout } = await this.execGit(repositoryRoot, ["show", `${ref}:${relativePath.replace(/\\/g, "/")}`], {
            maxBuffer: 32 * 1024 * 1024
        });
        return stdout;
    }
    async createFilePatch(repositoryId, hash, filePath, oldPath) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const defaultUri = vscode.Uri.file(path.join(repository.rootUri, `${path.basename(filePath)}.${hash.slice(0, 7)}.patch`));
        const target = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { Patch: ["patch"] },
            saveLabel: "创建补丁"
        });
        if (!target) {
            return;
        }
        const detail = await this.getCommitDetail(repositoryId, hash);
        const changedFile = detail.changedFiles.find((item) => item.path === filePath);
        const targetPath = changedFile?.status === "D" ? changedFile.oldPath ?? oldPath ?? filePath : filePath;
        const { stdout } = await this.execGit(repository.rootUri, ["show", "--format=", hash, "--", targetPath]);
        await fs.writeFile(target.fsPath, stdout, "utf8");
    }
    async restoreFileFromRevision(repositoryId, hash, filePath) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        await this.execGit(repository.rootUri, ["restore", "--source", hash, "--", filePath]);
    }
    async applySelectedChange(repositoryId, hash, filePath, reverse) {
        const repository = this.getRepositoryOrThrow(repositoryId);
        const detail = await this.getCommitDetail(repositoryId, hash);
        const changedFile = detail.changedFiles.find((item) => item.path === filePath);
        const patchPath = changedFile?.status === "D" ? changedFile.oldPath ?? filePath : filePath;
        const { stdout } = await this.execGit(repository.rootUri, ["show", "--format=", hash, "--", patchPath]);
        const applyArgs = reverse ? ["apply", "-R", "--index", "-"] : ["apply", "--index", "-"];
        await this.execGitWithInput(repository.rootUri, applyArgs, stdout);
    }
    async execGit(cwd, args, options) {
        try {
            const result = await execFile("git", args, {
                cwd,
                windowsHide: true,
                maxBuffer: 16 * 1024 * 1024,
                ...options
            });
            return {
                stdout: typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8"),
                stderr: typeof result.stderr === "string" ? result.stderr : result.stderr.toString("utf8")
            };
        }
        catch (error) {
            const execError = error;
            const stderr = execError.stderr;
            const stderrValue = stderr;
            let message = execError.message;
            if (typeof stderr === "string") {
                message = stderr;
            }
            else if (stderrValue instanceof Uint8Array) {
                message = Buffer.from(stderrValue).toString("utf8");
            }
            throw new Error(message.trim() || "Git 命令执行失败。");
        }
    }
    async execGitWithInput(cwd, args, input) {
        await new Promise((resolve, reject) => {
            const child = cp.spawn("git", args, {
                cwd,
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"]
            });
            let stderr = "";
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString("utf8");
            });
            child.on("error", (error) => reject(error));
            child.on("close", (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(stderr.trim() || "Git 命令执行失败。"));
            });
            child.stdin.write(input, "utf8");
            child.stdin.end();
        });
    }
}
exports.GitRepositoryService = GitRepositoryService;
class GitHistoryContentProvider {
    service;
    static scheme = "git-history";
    constructor(service) {
        this.service = service;
    }
    async provideTextDocumentContent(uri) {
        const params = new URLSearchParams(uri.query);
        const kind = params.get("kind");
        if (kind === "empty") {
            return "";
        }
        const repositoryId = params.get("repo");
        const ref = params.get("ref");
        const filePath = params.get("path");
        if (!repositoryId || !ref || !filePath) {
            return "";
        }
        return this.service.getFileContentByRevision(repositoryId, ref, filePath);
    }
    static buildUri(repositoryId, ref, filePath) {
        const params = new URLSearchParams({
            repo: repositoryId,
            ref,
            path: filePath
        });
        return vscode.Uri.parse(`${GitHistoryContentProvider.scheme}:/${encodeURIComponent(path.basename(filePath))}?${params.toString()}`);
    }
    static buildEmptyUri(filePath) {
        const params = new URLSearchParams({
            kind: "empty",
            path: filePath
        });
        return vscode.Uri.parse(`${GitHistoryContentProvider.scheme}:/${encodeURIComponent(path.basename(filePath))}?${params.toString()}`);
    }
}
exports.GitHistoryContentProvider = GitHistoryContentProvider;
function compareCommitsByDate(left, right) {
    const leftTime = new Date(left.authorDate).getTime();
    const rightTime = new Date(right.authorDate).getTime();
    if (leftTime !== rightTime) {
        return rightTime - leftTime;
    }
    return right.hash.localeCompare(left.hash);
}
//# sourceMappingURL=git.js.map