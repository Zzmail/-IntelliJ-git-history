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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const git_1 = require("./git/git");
const historyViewProvider_1 = require("./view/historyViewProvider");
function activate(context) {
    const service = new git_1.GitRepositoryService(context);
    const provider = new historyViewProvider_1.GitHistoryViewProvider(context, service);
    const contentProvider = new git_1.GitHistoryContentProvider(service);
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBarItem.name = "Git History";
    statusBarItem.text = "$(git-commit) Git 历史";
    statusBarItem.tooltip = "打开 Git History 面板";
    statusBarItem.command = "gitHistory.focus";
    statusBarItem.show();
    context.subscriptions.push(service, provider, statusBarItem, vscode.workspace.registerTextDocumentContentProvider(git_1.GitHistoryContentProvider.scheme, contentProvider), vscode.window.registerWebviewViewProvider("gitHistory.mainView", provider, {
        webviewOptions: { retainContextWhenHidden: true }
    }), vscode.commands.registerCommand("gitHistory.refresh", async () => {
        await service.refreshRepositories();
        await provider.refresh(true);
    }), vscode.commands.registerCommand("gitHistory.focus", async () => {
        await provider.reveal();
    }));
    void service.refreshRepositories();
}
function deactivate() { }
//# sourceMappingURL=extension.js.map