(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const monacoBase = document.body.dataset.monacoBase;
  const lanePalette = ["#d7ba7d", "#4ec9b0", "#c586c0", "#569cd6", "#ce9178", "#b5cea8"];

  const state = {
    repositories: [],
    repository: null,
    filters: {
      selectedRepositoryIds: [],
      query: "",
      branch: "",
      author: "",
      dateFrom: "",
      dateTo: "",
      paths: []
    },
    commits: [],
    selectedCommit: null,
    selectedDiff: null,
    hasMore: false,
    nextCursor: null
  };

  const ui = {
    contextMenu: null,
    monacoReady: false,
    monacoHost: null,
    monacoEditor: null,
    repoPickerOpen: false
  };

  const commitMenuItems = [
    ["复制修订号", "copyRevision", "canCopyRevision"],
    ["创建补丁", "createPatch", "canCreatePatch"],
    ["优选", "cherryPick", "canCherryPick"],
    ["签出修订", "checkoutRevision", "canCheckoutRevision"],
    ["在修订版中显示仓库", "showRepositoryAtRevision", "canShowRepositoryAtRevision"],
    ["与本地比较", "compareWithLocal", "canCompareWithLocal"],
    ["将当前分支重置到此处...", "resetCurrentBranchToHere", "canResetCurrentBranchToHere"],
    ["还原提交", "revertCommit", "canRevertCommit"],
    ["撤消提交...", "undoCommit", "canUndoCommit"],
    ["编辑提交消息...", "editCommitMessage", "canEditCommitMessage"]
  ];

  const fileMenuItems = [
    ["显示差异", "showDiff"],
    ["Show Diff in a New Window", "showDiffInNewWindow"],
    ["与本地比较", "compareWithLocal"],
    ["将前一版本与本地版本进行比较", "comparePreviousWithLocal"],
    ["编辑源", "editSource"],
    ["打开仓库版本", "openRepositoryVersion"],
    ["还原所选更改", "revertSelectedChanges"],
    ["优选所选更改", "cherryPickSelectedChanges"],
    ["创建补丁...", "createPatch"],
    ["从修订中获取", "getFromRevision"],
    ["迄今为止的历史记录", "showHistoryUpToHere"],
    ["Show Changes to Parents", "showChangesToParents"]
  ];

  window.addEventListener("message", (event) => {
    const { type, payload } = event.data || {};
    if (type !== "state") {
      return;
    }
    Object.assign(state, payload);
    render();
  });

  window.addEventListener("click", (event) => {
    const target = event.target;
    if (ui.repoPickerOpen && !target.closest(".filter-popover-slot")) {
      ui.repoPickerOpen = false;
      render();
      return;
    }
    if (ui.contextMenu && !target.closest(".context-menu")) {
      hideContextMenu();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      ui.repoPickerOpen = false;
      hideContextMenu();
      render();
    }
  });

  vscode.postMessage({ type: "ready" });

  function render() {
    app.innerHTML = "";
    if (!state.repositories.length) {
      app.appendChild(emptyState("当前工作区未发现 Git 仓库。"));
      return;
    }

    const layout = document.createElement("div");
    layout.className = "layout";
    layout.appendChild(renderHistoryPane());
    layout.appendChild(renderDetails());
    app.appendChild(layout);
  }

  function renderHistoryPane() {
    const pane = document.createElement("section");
    pane.className = "pane";

    const filters = document.createElement("div");
    filters.className = "filters";
    filters.appendChild(createInput("query", "文本或哈希", state.filters.query || ""));
    filters.appendChild(createInput("branch", "Branch", state.filters.branch || ""));
    filters.appendChild(createInput("author", "User", state.filters.author || ""));
    filters.appendChild(createInput("dateFrom", "起始日期 YYYY-MM-DD", state.filters.dateFrom || ""));
    filters.appendChild(createInput("dateTo", "结束日期 YYYY-MM-DD", state.filters.dateTo || ""));
    filters.appendChild(renderRepositoryPicker());
    filters.appendChild(createInput("paths", "Paths (逗号分隔)", (state.filters.paths || []).join(", ")));

    const commitList = document.createElement("div");
    commitList.className = "commit-list";
    commitList.addEventListener("scroll", () => {
      const nearBottom = commitList.scrollTop + commitList.clientHeight >= commitList.scrollHeight - 60;
      if (nearBottom && state.hasMore && state.nextCursor) {
        vscode.postMessage({ type: "history/loadMore", cursor: state.nextCursor });
      }
    });

    state.commits.forEach((commit) => {
      const item = document.createElement("div");
      item.className = "commit-item" + (isSelectedCommit(commit) ? " is-selected" : "");
      item.innerHTML = `
        <div class="commit-author">${escapeHtml(commit.authorName)}</div>
        <div class="graph">${renderGraph(commit.graph)}</div>
        <div class="commit-message">
          <div class="commit-title-row">
            <span class="repo-badge">${escapeHtml(commit.repositoryName)}</span>
            <span class="commit-subject">${escapeHtml(commit.subject || "(no subject)")}</span>
          </div>
          <span class="commit-refs">${commit.references.map((ref) => `<span class="ref-pill">${escapeHtml(ref)}</span>`).join("")}</span>
        </div>
        <div class="commit-date">${escapeHtml(formatDate(commit.authorDate))}</div>
      `;
      item.addEventListener("click", () => {
        vscode.postMessage({ type: "commit/select", repositoryId: commit.repositoryId, hash: commit.hash });
      });
      item.addEventListener("dblclick", () => {
        const targetFile =
          isSelectedCommit(commit) && state.selectedCommit.changedFiles && state.selectedCommit.changedFiles[0]
            ? state.selectedCommit.changedFiles[0]
            : null;
        if (targetFile) {
          vscode.postMessage({
            type: "file/openDiff",
            repositoryId: commit.repositoryId,
            hash: commit.hash,
            path: targetFile.path,
            oldPath: targetFile.oldPath
          });
        }
      });
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (!isSelectedCommit(commit)) {
          vscode.postMessage({ type: "commit/select", repositoryId: commit.repositoryId, hash: commit.hash });
        }
        showCommitContextMenu(event.clientX, event.clientY, commit);
      });
      commitList.appendChild(item);
    });

    if (!state.commits.length) {
      commitList.appendChild(emptyState("没有符合当前筛选条件的提交。"));
    } else if (state.hasMore) {
      const button = document.createElement("button");
      button.className = "load-more";
      button.textContent = "加载更多";
      button.addEventListener("click", () => {
        vscode.postMessage({ type: "history/loadMore", cursor: state.nextCursor });
      });
      commitList.appendChild(button);
    }

    pane.appendChild(filters);
    pane.appendChild(commitList);

    filters.querySelectorAll("input").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          submitFilters();
        }
      });
      input.addEventListener("blur", submitFilters);
    });

    return pane;

    function submitFilters() {
      applyFilters({
        ...state.filters,
        query: filters.querySelector("#query").value,
        branch: filters.querySelector("#branch").value,
        author: filters.querySelector("#author").value,
        dateFrom: filters.querySelector("#dateFrom").value,
        dateTo: filters.querySelector("#dateTo").value,
        paths: filters.querySelector("#paths").value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      });
    }
  }

  function renderRepositoryPicker() {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-popover-slot";

    const button = document.createElement("button");
    button.className = "repo-picker-button";
    button.type = "button";
    button.textContent = getRepositoryButtonLabel();
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      ui.repoPickerOpen = !ui.repoPickerOpen;
      render();
    });
    wrapper.appendChild(button);

    if (!ui.repoPickerOpen) {
      return wrapper;
    }

    const popover = document.createElement("div");
    popover.className = "filter-popover";
    popover.addEventListener("click", (event) => event.stopPropagation());

    popover.appendChild(
      createRepositoryOptionRow("全部仓库", areAllRepositoriesSelected(), (checked) => {
        applyFilters({
          ...state.filters,
          selectedRepositoryIds: checked ? state.repositories.map((repository) => repository.id) : []
        });
      })
    );

    state.repositories.forEach((repository) => {
      popover.appendChild(
        createRepositoryOptionRow(
          repository.name,
          state.filters.selectedRepositoryIds.includes(repository.id),
          (checked) => {
            const next = new Set(state.filters.selectedRepositoryIds);
            if (checked) {
              next.add(repository.id);
            } else {
              next.delete(repository.id);
            }
            applyFilters({
              ...state.filters,
              selectedRepositoryIds: Array.from(next)
            });
          }
        )
      );
    });

    wrapper.appendChild(popover);
    return wrapper;
  }

  function createRepositoryOptionRow(labelText, checked, onChange) {
    const row = document.createElement("div");
    row.className = "filter-check-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", (event) => {
      onChange(event.target.checked);
    });

    const label = document.createElement("span");
    label.textContent = labelText;

    row.appendChild(checkbox);
    row.appendChild(label);
    row.addEventListener("click", () => {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return row;
  }

  function renderDetails() {
    const pane = document.createElement("section");
    pane.className = "pane";
    const details = document.createElement("div");
    details.className = "details";

    if (!state.selectedCommit) {
      details.appendChild(emptyState("选择提交后在这里查看变更。"));
      pane.appendChild(details);
      return pane;
    }

    const header = document.createElement("div");
    header.className = "detail-header";
    header.innerHTML = `
      <h2 class="detail-title">${escapeHtml(state.selectedCommit.subject || "(no subject)")}</h2>
      <div class="detail-meta">
        <div>${escapeHtml(state.selectedCommit.repositoryName)} · ${escapeHtml(state.selectedCommit.shortHash)} · ${escapeHtml(state.selectedCommit.authorName)} &lt;${escapeHtml(state.selectedCommit.authorEmail)}&gt;</div>
        <div>${escapeHtml(formatDate(state.selectedCommit.authorDate))}</div>
        <div>${escapeHtml(state.selectedCommit.message || "")}</div>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "detail-body";
    body.appendChild(renderChangedFiles());
    body.appendChild(renderDiffPanel());
    details.appendChild(header);
    details.appendChild(body);
    pane.appendChild(details);
    return pane;
  }

  function renderChangedFiles() {
    const wrapper = document.createElement("div");
    wrapper.className = "changed-files";
    if (!state.selectedCommit.changedFiles || !state.selectedCommit.changedFiles.length) {
      wrapper.appendChild(emptyState("该提交没有文件变更信息。"));
      return wrapper;
    }

    state.selectedCommit.changedFiles.forEach((file) => {
      const item = document.createElement("div");
      item.className = "file-item" + (state.selectedDiff && state.selectedDiff.path === file.path ? " is-selected" : "");
      item.innerHTML = `
        <span class="file-status status-${file.status}">${escapeHtml(file.status)}</span>
        <span class="file-path">${escapeHtml(file.path)}</span>
        <span class="file-stats">${renderStats(file)}</span>
      `;
      item.addEventListener("click", () => {
        vscode.postMessage({
          type: "file/select",
          repositoryId: state.selectedCommit.repositoryId,
          hash: state.selectedCommit.hash,
          path: file.path,
          oldPath: file.oldPath
        });
      });
      item.addEventListener("dblclick", () => {
        vscode.postMessage({
          type: "file/openDiff",
          repositoryId: state.selectedCommit.repositoryId,
          hash: state.selectedCommit.hash,
          path: file.path,
          oldPath: file.oldPath
        });
      });
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showFileContextMenu(event.clientX, event.clientY, file);
      });
      wrapper.appendChild(item);
    });

    return wrapper;
  }

  function renderDiffPanel() {
    const panel = document.createElement("div");
    panel.className = "diff-panel";
    const toolbar = document.createElement("div");
    toolbar.className = "diff-toolbar";
    toolbar.innerHTML = `
      <strong>${escapeHtml(state.selectedDiff ? state.selectedDiff.path : "变更预览")}</strong>
      <span style="color: var(--muted);">${state.selectedDiff && state.selectedDiff.isBinary ? "二进制文件" : ""}</span>
    `;
    panel.appendChild(toolbar);

    const view = document.createElement("div");
    view.className = "diff-view";
    if (!state.selectedDiff) {
      view.appendChild(emptyState("选择变更文件以查看内容。"));
      panel.appendChild(view);
      return panel;
    }

    if (state.selectedDiff.isBinary) {
      view.appendChild(emptyState("二进制文件无法内嵌预览。双击文件可在编辑器中打开更大视图。"));
      panel.appendChild(view);
      return panel;
    }

    ui.monacoHost = view;
    renderDiffEditor();
    panel.appendChild(view);
    return panel;
  }

  function renderDiffEditor() {
    if (!ui.monacoHost || !state.selectedDiff) {
      return;
    }

    if (!ui.monacoReady) {
      tryLoadMonaco()
        .then(() => renderDiffEditor())
        .catch(() => renderFallbackDiff(ui.monacoHost, state.selectedDiff));
      return;
    }

    if (!ui.monacoEditor || !window.monaco) {
      ui.monacoEditor = window.monaco.editor.createDiffEditor(ui.monacoHost, {
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false
      });
    }

    const original = window.monaco.editor.createModel(state.selectedDiff.beforeContent || "", undefined);
    const modified = window.monaco.editor.createModel(state.selectedDiff.afterContent || "", undefined);
    ui.monacoEditor.setModel({ original, modified });
  }

  function renderFallbackDiff(host, diff) {
    host.innerHTML = `
      <div class="fallback-diff">
        <div class="fallback-column"><pre>${escapeHtml(diff.beforeContent || "")}</pre></div>
        <div class="fallback-column"><pre>${escapeHtml(diff.afterContent || "")}</pre></div>
      </div>
    `;
  }

  function tryLoadMonaco() {
    if (ui.monacoReady || window.monaco) {
      ui.monacoReady = true;
      return Promise.resolve();
    }
    if (!monacoBase) {
      return Promise.reject(new Error("Monaco base missing"));
    }

    return new Promise((resolve, reject) => {
      const loader = document.createElement("script");
      loader.src = `${monacoBase}/vs/loader.js`;
      loader.onload = () => {
        if (!window.require) {
          reject(new Error("AMD loader missing"));
          return;
        }
        window.require.config({ paths: { vs: `${monacoBase}/vs` } });
        window.require(["vs/editor/editor.main"], () => {
          ui.monacoReady = true;
          resolve();
        }, reject);
      };
      loader.onerror = reject;
      document.body.appendChild(loader);
    });
  }

  function showCommitContextMenu(x, y, commit) {
    hideContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";

    commitMenuItems.forEach(([label, action, capability]) => {
      const button = document.createElement("button");
      const enabled = Boolean(commit.actionAvailability[capability]);
      button.textContent = label;
      button.disabled = !enabled;
      if (!enabled && commit.actionAvailability.disabledReasons[action]) {
        button.title = commit.actionAvailability.disabledReasons[action];
      }
      button.addEventListener("click", () => {
        if (enabled) {
          vscode.postMessage({
            type: "commit/runAction",
            repositoryId: commit.repositoryId,
            hash: commit.hash,
            action
          });
        }
        hideContextMenu();
      });
      menu.appendChild(button);
    });

    placeContextMenu(menu, x, y);
  }

  function showFileContextMenu(x, y, file) {
    hideContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";

    fileMenuItems.forEach(([label, action]) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("click", () => {
        vscode.postMessage({
          type: "file/runAction",
          repositoryId: state.selectedCommit.repositoryId,
          hash: state.selectedCommit.hash,
          path: file.path,
          oldPath: file.oldPath,
          action
        });
        hideContextMenu();
      });
      menu.appendChild(button);
    });

    placeContextMenu(menu, x, y);
  }

  function placeContextMenu(menu, x, y) {
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    ui.contextMenu = menu;
  }

  function hideContextMenu() {
    if (ui.contextMenu) {
      ui.contextMenu.remove();
      ui.contextMenu = null;
    }
  }

  function applyFilters(nextFilters) {
    vscode.postMessage({
      type: "history/applyFilters",
      filters: nextFilters
    });
  }

  function createInput(id, placeholder, value) {
    const input = document.createElement("input");
    input.id = id;
    input.placeholder = placeholder;
    input.value = value;
    input.autocomplete = "off";
    return input;
  }

  function isSelectedCommit(commit) {
    return Boolean(
      state.selectedCommit &&
      state.selectedCommit.hash === commit.hash &&
      state.selectedCommit.repositoryId === commit.repositoryId
    );
  }

  function renderGraph(graph) {
    const width = 80;
    const height = 34;
    const step = 16;
    const dotX = graph.lane * step + 12;
    const dotY = 17;
    const laneCount = Math.max(graph.laneCount, 1);
    const lines = [];

    for (let lane = 0; lane < laneCount; lane += 1) {
      const lineX = lane * step + 12;
      const color = lanePalette[lane % lanePalette.length];
      lines.push(`<line x1="${lineX}" y1="0" x2="${lineX}" y2="${height}" stroke="${color}" stroke-width="2" opacity="0.8" />`);
    }

    graph.parentLanes.forEach((parentLane) => {
      const parentX = parentLane * step + 12;
      const color = lanePalette[parentLane % lanePalette.length];
      lines.push(`<path d="M ${dotX} ${dotY} C ${dotX} ${dotY + 6}, ${parentX} ${dotY + 6}, ${parentX} ${height}" stroke="${color}" fill="none" stroke-width="2" />`);
    });

    const dotColor = lanePalette[graph.lane % lanePalette.length];
    return `
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        ${lines.join("")}
        <circle cx="${dotX}" cy="${dotY}" r="5" fill="${dotColor}" />
      </svg>
    `;
  }

  function getRepositoryButtonLabel() {
    const total = state.repositories.length;
    const selectedCount = state.filters.selectedRepositoryIds.length || total;
    if (selectedCount === total) {
      return "仓库：全部";
    }
    if (selectedCount === 0) {
      return "仓库：未选择";
    }
    if (selectedCount === 1) {
      const selectedId = state.filters.selectedRepositoryIds[0];
      const repository = state.repositories.find((item) => item.id === selectedId);
      return `仓库：${repository ? repository.name : "1 个已选"}`;
    }
    return `仓库：已选 ${selectedCount}/${total}`;
  }

  function areAllRepositoriesSelected() {
    return state.filters.selectedRepositoryIds.length === state.repositories.length;
  }

  function emptyState(text) {
    const wrapper = document.createElement("div");
    wrapper.className = "empty-state";
    wrapper.textContent = text;
    return wrapper;
  }

  function renderStats(file) {
    if (file.isBinary) {
      return "binary";
    }
    const additions = typeof file.additions === "number" ? `+${file.additions}` : "";
    const deletions = typeof file.deletions === "number" ? `-${file.deletions}` : "";
    return [additions, deletions].filter(Boolean).join(" ");
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
