import * as vscode from "vscode";
import { GitHistoryContentProvider, GitRepositoryService } from "./git/git";
import { GitHistoryViewProvider } from "./view/historyViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const service = new GitRepositoryService(context);
  const provider = new GitHistoryViewProvider(context, service);
  const contentProvider = new GitHistoryContentProvider(service);
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.name = "Git History";
  statusBarItem.text = "$(git-commit) Git 历史";
  statusBarItem.tooltip = "打开 Git History 面板";
  statusBarItem.command = "gitHistory.focus";
  statusBarItem.show();

  context.subscriptions.push(
    service,
    provider,
    statusBarItem,
    vscode.workspace.registerTextDocumentContentProvider(GitHistoryContentProvider.scheme, contentProvider),
    vscode.window.registerWebviewViewProvider("gitHistory.mainView", provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("gitHistory.refresh", async () => {
      await service.refreshRepositories();
      await provider.refresh(true);
    }),
    vscode.commands.registerCommand("gitHistory.focus", async () => {
      await provider.reveal();
    })
  );

  void service.refreshRepositories();
}

export function deactivate(): void {}
