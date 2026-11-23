import * as vscode from "vscode";
import { AnalysisReport, Finding } from "../analysis/model/finding";
import { CodebaseMap } from "../analysis/model/codebaseMap";
import { GuidanceResponse } from "../analysis/model/guidance";

export class FindingsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiAssistCodebase.findingsView";
  private view?: vscode.WebviewView;
  private report?: AnalysisReport;
  private guidance?: GuidanceResponse;
  private analyzing = false;
  private asking = false;
  private lastQuestion = "";
  public onAsk?: (question: string) => Promise<void> | void;
  public onAnalyzeWorkspace?: () => Promise<void> | void;
  public onAnalyzeCurrentFile?: () => Promise<void> | void;
  public onRefresh?: () => Promise<void> | void;
  public onAskCurrentFile?: () => Promise<void> | void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "open" && typeof message.file === "string") {
        await openFindingLocation(message.file, message.line, message.endLine);
      }
      if (message.type === "ask" && typeof message.question === "string") {
        const question = message.question.trim();
        if (question && this.onAsk) {
          this.lastQuestion = question;
          await this.onAsk(question);
        }
      }
      if (message.type === "analyzeWorkspace") await this.onAnalyzeWorkspace?.();
      if (message.type === "analyzeCurrentFile") await this.onAnalyzeCurrentFile?.();
      if (message.type === "refresh") await this.onRefresh?.();
      if (message.type === "askCurrentFile") await this.onAskCurrentFile?.();
      if (message.type === "draft" && typeof message.question === "string") {
        this.lastQuestion = message.question;
      }
    });
    this.render();
  }

  setAnalyzing(analyzing: boolean): void {
    this.analyzing = analyzing;
    this.render();
  }

  setAsking(asking: boolean): void {
    this.asking = asking;
    this.render();
  }

  setReport(report: AnalysisReport | undefined): void {
    this.report = report;
    this.analyzing = false;
    this.render();
  }

  setGuidance(guidance: GuidanceResponse | undefined): void {
    this.guidance = guidance;
    this.asking = false;
    this.render();
  }

  getReport(): AnalysisReport | undefined {
    return this.report;
  }

  getCodebaseMap(): CodebaseMap | undefined {
    return this.report?.codebaseMap;
  }

  reveal(): void {
    this.view?.show?.(true);
  }

  setDraftQuestion(question: string): void {
    this.lastQuestion = question;
    this.render();
    this.reveal();
  }

  async askQuestion(question: string): Promise<void> {
    this.lastQuestion = question;
    this.render();
    this.reveal();
    if (this.onAsk) {
      await this.onAsk(question.trim());
    }
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const nonce = String(Date.now()) + Math.random().toString(16).slice(2);
    const report = this.report;
    const guidance = this.guidance;
    const codebaseMap = report?.codebaseMap;
    const codebaseSummary = guidance?.codebaseSummary || codebaseMap?.summary || "Run Analyze Workspace to build a codebase summary.";
    const suggestedQuestions = dedupeStrings([
      ...(report?.summary.suggestedQuestions ?? []),
      ...(codebaseMap?.suggestedQuestions ?? []),
    ]).slice(0, 10);
    const askingBlock = this.asking ? `<div class="meta">Thinking about your codebase…</div>` : "";
    const analyzingBlock = this.analyzing ? `<div class="meta">Analyzing codebase…</div>` : "";

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 12px 16px; font-size: 12px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 8px; color: var(--vscode-descriptionForeground); }
    h3 { font-size: 12px; margin: 12px 0 6px; }
    .meta { color: var(--vscode-descriptionForeground); margin: 8px 0; }
    .card { background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,.08)); border-radius: 6px; padding: 10px; margin: 8px 0; }
    .todo li, .steps li { margin: 6px 0; }
    .finding { border-left: 3px solid var(--vscode-editorWidget-border); padding-left: 10px; margin: 10px 0; }
    .finding.error { border-left-color: var(--vscode-errorForeground); }
    .finding.warning { border-left-color: var(--vscode-editorWarning-foreground); }
    .finding.info { border-left-color: var(--vscode-editorInfo-foreground); }
    .title { font-weight: 600; margin-bottom: 2px; }
    .badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-right: 4px; margin-bottom: 4px; }
    .loc { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; word-break: break-all; }
    .rec, .detail { margin-top: 4px; white-space: pre-wrap; }
    .evidence { color: var(--vscode-descriptionForeground); margin-top: 4px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .empty { color: var(--vscode-descriptionForeground); margin-top: 8px; }
    ul { padding-left: 18px; margin: 6px 0; }
    textarea { width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 8px; font: inherit; }
    button { margin-top: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer; font: inherit; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
    .actions button { margin-top: 0; }
    .chip { display: inline-block; margin: 4px 6px 0 0; padding: 4px 8px; border-radius: 12px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; font-size: 11px; line-height: 1.4; }
    .chip:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .muted { color: var(--vscode-descriptionForeground); }
    .step { margin: 10px 0; padding-left: 10px; border-left: 2px solid var(--vscode-focusBorder, #007acc); }
    pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12)); padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    code { font-family: var(--vscode-editor-font-family); }
    .example { margin: 10px 0; }
  </style>
</head>
<body>
  <div class="actions">
    <button class="secondary" id="analyzeWorkspaceBtn">Analyze Workspace</button>
    <button class="secondary" id="analyzeFileBtn">Analyze File</button>
    <button class="secondary" id="askFileBtn">Ask About File</button>
    <button class="secondary" id="refreshBtn">Refresh</button>
  </div>
  <div class="meta">Codebase-aware teaching assistant — grounded in your workspace, no auto-edits.</div>
  <h2>Ask About This Codebase</h2>
  <div class="card">
    <textarea id="question" placeholder="e.g. How do I add a new API endpoint? Teach me how this codebase handles X.">${escapeHtml(this.lastQuestion)}</textarea>
    <div class="row">
      <button id="askBtn">Ask AI Assist</button>
      <span class="muted">Codebase-aware teaching. Examples are guidance only.</span>
    </div>
    ${askingBlock}
    ${renderQuestionChips(suggestedQuestions, "Suggested questions")}
  </div>

  <h2>Codebase</h2>
  <div class="card">
    <div>${escapeHtml(codebaseSummary)}</div>
    ${renderCodebaseMeta(codebaseMap)}
  </div>

  ${renderGuidance(guidance)}
  ${analyzingBlock}
  ${renderReport(report)}

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const questionEl = document.getElementById('question');
    document.getElementById('askBtn').addEventListener('click', () => {
      const q = questionEl.value;
      if (q && q.trim()) vscode.postMessage({ type: 'ask', question: q });
    });
    document.getElementById('analyzeWorkspaceBtn').addEventListener('click', () => vscode.postMessage({ type: 'analyzeWorkspace' }));
    document.getElementById('analyzeFileBtn').addEventListener('click', () => vscode.postMessage({ type: 'analyzeCurrentFile' }));
    document.getElementById('askFileBtn').addEventListener('click', () => vscode.postMessage({ type: 'askCurrentFile' }));
    document.getElementById('refreshBtn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    questionEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const q = e.target.value;
        if (q && q.trim()) vscode.postMessage({ type: 'ask', question: q });
      }
    });
    document.querySelectorAll('[data-file]').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'open', file: el.dataset.file, line: Number(el.dataset.line || 1), endLine: Number(el.dataset.endLine || el.dataset.line || 1) });
      });
    });
    document.querySelectorAll('[data-ask]').forEach(el => {
      el.addEventListener('click', () => {
        const q = el.getAttribute('data-ask') || '';
        questionEl.value = q;
        vscode.postMessage({ type: 'ask', question: q });
      });
    });
  </script>
</body>
</html>`;
  }
}

function renderQuestionChips(questions: string[], label: string): string {
  if (!questions.length) return "";
  return `<div class="meta"><strong>${escapeHtml(label)}:</strong></div><div>${questions.map((q) => `<span class="chip" data-ask="${escapeAttr(q)}">${escapeHtml(q)}</span>`).join("")}</div>`;
}

function renderCodebaseMeta(map: CodebaseMap | undefined): string {
  if (!map) return "";
  const bits: string[] = [];
  if (map.frameworks.length) bits.push(`<div class="meta"><strong>Frameworks:</strong> ${escapeHtml(map.frameworks.join(", "))}</div>`);
  if (map.entryPoints.length) bits.push(`<div class="meta"><strong>Entry points:</strong> ${escapeHtml(map.entryPoints.join(", "))}</div>`);
  if (map.keyFiles.length) bits.push(`<div class="meta"><strong>Key files:</strong> ${map.keyFiles.slice(0, 8).map((f) => `<span class="loc" data-file="${escapeAttr(f)}" data-line="1">${escapeHtml(f)}</span>`).join(", ")}</div>`);
  return bits.join("");
}

function renderGuidance(guidance: GuidanceResponse | undefined): string {
  if (!guidance) return "";
  const teaching = guidance.teaching.length
    ? `<ul>${guidance.teaching.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
    : "";
  const refs = guidance.relevantFiles.length
    ? `<ul>${guidance.relevantFiles.map((r) => `<li><span class="loc" data-file="${escapeAttr(r.path)}" data-line="${r.line ?? 1}">${escapeHtml(r.path)}${r.line ? `:${r.line}` : ""}</span> — ${escapeHtml(r.reason)}</li>`).join("")}</ul>`
    : `<div class="empty">No specific files cited.</div>`;
  const steps = guidance.steps.length
    ? guidance.steps.map((s, i) => `<div class="step"><div class="title">${i + 1}. ${escapeHtml(s.title)}</div><div class="detail">${escapeHtml(s.detail)}</div>${s.files?.length ? `<div class="meta">Files: ${s.files.map((f) => `<span class="loc" data-file="${escapeAttr(f)}" data-line="1">${escapeHtml(f)}</span>`).join(", ")}</div>` : ""}</div>`).join("")
    : `<div class="empty">No steps returned.</div>`;
  const examples = guidance.examples.length
    ? guidance.examples.map((e) => `<div class="example"><div class="title">${escapeHtml(e.title)}</div>${e.file ? `<div class="meta">Related file: <span class="loc" data-file="${escapeAttr(e.file)}" data-line="1">${escapeHtml(e.file)}</span></div>` : ""}<div class="meta">Example only — review before using.</div><pre><code>${escapeHtml(e.snippet)}</code></pre><div class="detail">${escapeHtml(e.explanation)}</div></div>`).join("")
    : "";
  const checks = guidance.checks.length ? `<ul>${guidance.checks.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : "";
  const warnings = guidance.warnings.length ? `<div class="meta"><strong>Warnings:</strong> ${escapeHtml(guidance.warnings.join(" | "))}</div>` : "";
  const model = guidance.usedModel ? `<div class="meta"><strong>Model:</strong> ${escapeHtml(guidance.usedModel)}</div>` : `<div class="meta"><strong>Mode:</strong> Heuristic fallback</div>`;
  const followUps = renderQuestionChips(guidance.followUpQuestions, "Follow-up questions");

  return `
    <h2>Guidance</h2>
    <div class="card">
      <div class="meta"><strong>Question:</strong> ${escapeHtml(guidance.question)}</div>
      ${model}
      ${warnings}
      ${teaching ? `<h3>How it works here</h3>${teaching}` : ""}
      <h3>Relevant Files</h3>
      ${refs}
      <h3>Steps</h3>
      ${steps}
      ${examples ? `<h3>Examples</h3>${examples}` : ""}
      ${checks ? `<h3>Checks</h3>${checks}` : ""}
      ${followUps}
    </div>
  `;
}

function renderReport(report: AnalysisReport | undefined): string {
  if (!report) {
    return `<h2>Analysis</h2><div class="empty">No analysis yet. Run <em>AI Assist: Analyze Workspace</em> for codebase understanding, suggested questions, and findings.</div>`;
  }
  const summary = report.summary.whatToDo.length
    ? `<ul class="todo">${report.summary.whatToDo.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="empty">No actions suggested.</div>`;
  const suggested = report.summary.suggestedTasks?.length
    ? `<h3>Suggested Tasks</h3><ul class="todo">${report.summary.suggestedTasks.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
    : "";
  const notes = (report.summary.notes ?? []).map((n) => `<div class="meta">${escapeHtml(n)}</div>`).join("");
  const findings = report.findings.length
    ? report.findings.map(renderFinding).join("")
    : `<div class="empty">No findings.</div>`;

  return `
    <h2>Analysis</h2>
    <div class="card">
      <div class="meta"><strong>Target:</strong> ${escapeHtml(report.targetLabel)}</div>
      <div class="meta"><strong>Analyzed:</strong> ${escapeHtml(new Date(report.analyzedAt).toLocaleString())}</div>
      <div class="meta"><strong>Mode:</strong> ${report.staticOnly ? "Static only" : "Hybrid (static + agentic)"}</div>
      ${notes}
      <h3>What To Do</h3>
      ${summary}
      ${suggested}
    </div>
    <h2>Findings (${report.findings.length})</h2>
    ${findings}
  `;
}

function renderFinding(finding: Finding): string {
  const location = finding.file
    ? `<div class="loc" data-file="${escapeAttr(finding.file)}" data-line="${finding.line ?? 1}" data-end-line="${finding.endLine ?? finding.line ?? 1}">${escapeHtml(finding.file)}${finding.line ? `:${finding.line}` : ""}</div>`
    : "";
  const evidence = finding.evidence ? `<div class="evidence">${escapeHtml(finding.evidence)}</div>` : "";
  const askQuestion = `Teach me why this is an issue and how to fix it in this codebase: ${finding.title}${finding.file ? ` at ${finding.file}${finding.line ? `:${finding.line}` : ""}` : ""}. Recommendation: ${finding.recommendation}`;
  return `
    <div class="finding ${escapeAttr(finding.severity)}">
      <div class="title">${escapeHtml(finding.title)}</div>
      <div>
        <span class="badge">${escapeHtml(finding.severity)}</span>
        <span class="badge">${escapeHtml(finding.category)}</span>
        <span class="badge">${escapeHtml(finding.source)}</span>
      </div>
      ${location}
      <div class="rec">${escapeHtml(finding.recommendation)}</div>
      ${evidence}
      <div class="meta"><span class="chip" data-ask="${escapeAttr(askQuestion)}">Teach me how to fix this</span></div>
    </div>
  `;
}

async function openFindingLocation(file: string, line: number | undefined, endLine?: number): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri = /^[a-zA-Z]:[\\/]/.test(file) || file.startsWith("/")
    ? vscode.Uri.file(file)
    : root
      ? vscode.Uri.joinPath(root, file)
      : vscode.Uri.file(file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const start = Math.max(0, (line ?? 1) - 1);
  const end = Math.max(start, (endLine ?? line ?? 1) - 1);
  const startPos = new vscode.Position(start, 0);
  const endPos = new vscode.Position(end, doc.lineAt(Math.min(end, doc.lineCount - 1)).text.length);
  const range = new vscode.Range(startPos, endPos);
  editor.selection = new vscode.Selection(startPos, endPos);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}
