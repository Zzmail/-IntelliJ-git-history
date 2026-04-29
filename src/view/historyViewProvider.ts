import * as vscode from "vscode";
import { GitRepositoryService } from "../git/git";
import { CommitAction, CommitDetail, FileAction, HistoryFilterState, HistoryPage } from "../git/models";

type InboundMessage =
  | { type: "ready" }
  | { type: "history/loadMore"; cursor?: string }
  | { type: "history/applyFilters"; filters: HistoryFilterState }
  | { type: "commit/select"; repositoryId: string; hash: string }
  | { type: "file/select"; repositoryId: string; hash: string; path: string; oldPath?: string }
  | { type: "commit/runAction"; repositoryId: string; hash: string; action: CommitAction }
  | { type: "file/openDiff"; repositoryId: string; hash: string; path: string; oldPath?: string }
  | { type: "file/runAction"; repositoryId: string; hash: string; path: string; oldPath?: string; action: FileAction }
  | { type: "repo/showRevisionTree"; repositoryId: string; hash: string }
  | { type: "state/refresh" };

export class GitHistoryViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly filters: HistoryFilterState = {
    selectedRepositoryIds: [],
    query: "",
    branch: "",
    author: "",
    dateFrom: "",
    dateTo: "",
    paths: []
  };
  private selectedCommit?: CommitDetail;
  private pageCursor?: string;
  private hasMore = false;
  private commits: HistoryPage["commits"] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: GitRepositoryService
  ) {
    this.disposables.push(
      this.service.onDidRefresh(() => {
        if (this.view) {
          void this.refresh(true);
        }
      })
    );
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose());
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "node_modules")
      ]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: InboundMessage) => void this.handleMessage(message), null, this.disposables);
    await this.refresh(true);
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.gitHistoryPanel");
  }

  async refresh(resetSelection = false): Promise<void> {
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
    } else {
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

  private async handleMessage(message: InboundMessage): Promise<void> {
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
        } catch (error) {
          const text = error instanceof Error ? error.message : "操作失败。";
          void vscode.window.showErrorMessage(text);
        }
        return;
      case "file/runAction":
        try {
          const result = await this.service.runFileAction(
            message.repositoryId,
            message.hash,
            message.path,
            message.oldPath,
            message.action
          );
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
        } catch (error) {
          const text = error instanceof Error ? error.message : "操作失败。";
          void vscode.window.showErrorMessage(text);
        }
        return;
      default:
        return;
    }
  }

  private async loadMore(cursor?: string): Promise<void> {
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

  private async selectCommit(repositoryId: string, hash: string): Promise<void> {
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

  private async selectFile(repositoryId: string, hash: string, filePath: string, oldPath?: string): Promise<void> {
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

  private postState(state: HistoryPage): void {
    this.view?.webview.postMessage({
      type: "state",
      payload: state
    });
  }

  private getHtml(webview: vscode.Webview): string {
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

function createNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
