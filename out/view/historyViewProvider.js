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
exports.GitHistoryViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class GitHistoryViewProvider {
    context;
    service;
    view;
    disposables = [];
    filters = {
        selectedRepositoryIds: [],
        query: "",
        branch: "",
        author: "",
        dateFrom: "",
        dateTo: "",
        paths: []
    };
    selectedCommit;
    pageCursor;
    hasMore = false;
    commits = [];
    constructor(context, service) {
        this.context = context;
        this.service = service;
        this.disposables.push(this.service.onDidRefresh(() => {
            if (this.view) {
                void this.refresh(true);
            }
        }));
    }
    dispose() {
        this.disposables.forEach((item) => item.dispose());
    }
    async resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "media"),
                vscode.Uri.joinPath(this.context.extensionUri, "node_modules")
            ]
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage((message) => void this.handleMessage(message), null, this.disposables);
        await this.refresh(true);
    }
    async reveal() {
        await vscode.commands.executeCommand("workbench.view.extension.gitHistoryPanel");
    }
    async refresh(resetSelection = false) {
        const page = await this.service.getHistory(this.filters);
        Object.assign(this.filters, page.filters);
        this.pageCursor = page.nextCursor;
        this.hasMore = page.hasMore;
        this.commits = page.commits;
        if (resetSelection || !this.selectedCommit) {
            this.selectedCommit = undefined;
            if (page.commits[0]) {
                this.selectedCommit = await this.service.getCommitDetail(page.commits[0].repositoryId, page.commits[0].hash);
            }
        }
        else {
            this.selectedCommit = await this.service
                .getCommitDetail(this.selectedCommit.repositoryId, this.selectedCommit.hash)
                .catch(() => undefined);
        }
        this.postState({
            ...page,
            selectedCommit: this.selectedCommit,
            selectedDiff: undefined
        });
    }
    async handleMessage(message) {
        switch (message.type) {
            case "ready":
            case "state/refresh":
                await this.refresh(message.type === "state/refresh");
                return;
            case "history/applyFilters":
                Object.assign(this.filters, {
                    ...message.filters,
                    selectedRepositoryIds: message.filters.selectedRepositoryIds ?? [],
                    paths: message.filters.paths ?? []
                });
                await this.refresh(true);
                return;
            case "history/loadMore":
                await this.loadMore(message.cursor);
                return;
            case "commit/select":
                await this.selectCommit(message.repositoryId, message.hash);
                return;
            case "file/select":
                await this.selectFile(message.repositoryId, message.hash, message.path, message.oldPath);
                return;
            case "file/openDiff":
                await this.service.openCommitFileDiff(message.repositoryId, message.hash, message.path, message.oldPath);
                return;
            case "repo/showRevisionTree":
                await this.service.runCommitAction(message.repositoryId, message.hash, "showRepositoryAtRevision");
                return;
            case "commit/runAction":
                try {
                    await this.service.runCommitAction(message.repositoryId, message.hash, message.action);
                    await this.refresh(true);
                }
                catch (error) {
                    const text = error instanceof Error ? error.message : "操作失败。";
                    void vscode.window.showErrorMessage(text);
                }
                return;
            case "file/runAction":
                try {
                    const result = await this.service.runFileAction(message.repositoryId, message.hash, message.path, message.oldPath, message.action);
                    if (result?.applyPathFilter) {
                        Object.assign(this.filters, {
                            paths: [result.applyPathFilter]
                        });
                        await this.refresh(true);
                        return;
                    }
                    if (["revertSelectedChanges", "cherryPickSelectedChanges", "getFromRevision"].includes(message.action)) {
                        await this.refresh(false);
                    }
                }
                catch (error) {
                    const text = error instanceof Error ? error.message : "操作失败。";
                    void vscode.window.showErrorMessage(text);
                }
                return;
            default:
                return;
        }
    }
    async loadMore(cursor) {
        if (!this.hasMore || !cursor) {
            return;
        }
        const page = await this.service.getHistory(this.filters, cursor);
        Object.assign(this.filters, page.filters);
        this.pageCursor = page.nextCursor ?? cursor;
        this.hasMore = page.hasMore;
        this.commits = [...this.commits, ...page.commits];
        this.postState({
            ...page,
            commits: this.commits,
            selectedCommit: this.selectedCommit,
            selectedDiff: undefined
        });
    }
    async selectCommit(repositoryId, hash) {
        this.selectedCommit = await this.service.getCommitDetail(repositoryId, hash);
        this.postState({
            repository: this.service.listRepositories().find((item) => item.id === repositoryId) ?? null,
            repositories: this.service.listRepositories(),
            filters: this.filters,
            commits: this.commits,
            selectedCommit: this.selectedCommit,
            selectedDiff: undefined,
            hasMore: this.hasMore,
            nextCursor: this.pageCursor
        });
    }
    async selectFile(repositoryId, hash, filePath, oldPath) {
        if (!this.selectedCommit || this.selectedCommit.hash !== hash || this.selectedCommit.repositoryId !== repositoryId) {
            this.selectedCommit = await this.service.getCommitDetail(repositoryId, hash);
        }
        const selectedDiff = await this.service.getFileDiff(repositoryId, hash, filePath, oldPath);
        this.postState({
            repository: this.service.listRepositories().find((item) => item.id === repositoryId) ?? null,
            repositories: this.service.listRepositories(),
            filters: this.filters,
            commits: this.commits,
            selectedCommit: this.selectedCommit,
            selectedDiff,
            hasMore: this.hasMore,
            nextCursor: this.pageCursor
        });
    }
    postState(state) {
        this.view?.webview.postMessage({
            type: "state",
            payload: state
        });
    }
    getHtml(webview) {
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
        const monacoBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "monaco-editor", "min"));
        const nonce = createNonce();
        return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git History</title>
    <link rel="stylesheet" href="${stylesUri}" />
  </head>
  <body data-monaco-base="${monacoBaseUri}">
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
    }
}
exports.GitHistoryViewProvider = GitHistoryViewProvider;
function createNonce() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
//# sourceMappingURL=historyViewProvider.js.map