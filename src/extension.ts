import * as vscode from "vscode";
import { runGuidance } from "./analysis/agent/guidanceRunner";
import { buildCodebaseMap } from "./analysis/context/codebaseIndexer";
import { collectWorkspaceContext } from "./analysis/contextCollector";
import { AnalysisReport } from "./analysis/model/finding";
import { runAnalysis, AnalysisTarget } from "./analysis/orchestrator";
import { getConfig } from "./utils/config";
import { disposeLogger, getLogger, log } from "./utils/logger";
import { DiagnosticsPublisher } from "./ui/diagnosticsPublisher";
import { FindingsSidebarProvider } from "./ui/sidebarProvider";

let currentAnalysis: vscode.CancellationTokenSource | undefined;
let currentAsk: vscode.CancellationTokenSource | undefined;
let lastTarget: AnalysisTarget | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const logger = getLogger();
  context.subscriptions.push(logger);

  const sidebarProvider = new FindingsSidebarProvider(context.extensionUri);
  const diagnostics = new DiagnosticsPublisher();
  context.subscriptions.push(diagnostics);

  sidebarProvider.onAsk = async (question: string) => {
    await executeAsk(question, sidebarProvider);
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FindingsSidebarProvider.viewType, sidebarProvider),
  );

  const analyzeWorkspace = vscode.commands.registerCommand("aiAssistCodebase.analyzeWorkspace", async () => {
    await executeAnalysis({ kind: "workspace" }, sidebarProvider, diagnostics);
  });

  const analyzeCurrentFile = vscode.commands.registerCommand("aiAssistCodebase.analyzeCurrentFile", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("AI Assist: No active file to analyze.");
      return;
    }
    await executeAnalysis({ kind: "file", uri: editor.document.uri }, sidebarProvider, diagnostics);
  });

  const refreshAnalysis = vscode.commands.registerCommand("aiAssistCodebase.refreshAnalysis", async () => {
    if (!lastTarget) {
      vscode.window.showInformationMessage("AI Assist: No previous analysis to refresh. Run an analysis first.");
      return;
    }
    await executeAnalysis(lastTarget, sidebarProvider, diagnostics);
  });

  const clearResults = vscode.commands.registerCommand("aiAssistCodebase.clearResults", () => {
    currentAnalysis?.cancel();
    currentAnalysis?.dispose();
    currentAnalysis = undefined;
    currentAsk?.cancel();
    currentAsk?.dispose();
    currentAsk = undefined;
    lastTarget = undefined;
    sidebarProvider.setReport(undefined);
    sidebarProvider.setGuidance(undefined);
    diagnostics.clear();
    log("Cleared analysis results.");
  });

  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const config = getConfig();
    if (config.analysisTrigger !== "onSave") {
      return;
    }
    if (document.uri.scheme !== "file") {
      return;
    }
    await executeAnalysis({ kind: "file", uri: document.uri }, sidebarProvider, diagnostics, true);
  });

  context.subscriptions.push(analyzeWorkspace, analyzeCurrentFile, refreshAnalysis, clearResults, onSave);
  log("AI Assist Codebase extension activated.");
}

async function executeAnalysis(
  target: AnalysisTarget,
  sidebarProvider: FindingsSidebarProvider,
  diagnostics: DiagnosticsPublisher,
  silent = false,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length && target.kind === "workspace") {
    vscode.window.showInformationMessage("AI Assist: Open a folder or workspace to analyze.");
    return;
  }

  currentAnalysis?.cancel();
  currentAnalysis?.dispose();
  currentAnalysis = new vscode.CancellationTokenSource();
  const token = currentAnalysis.token;
  lastTarget = target;

  sidebarProvider.setAnalyzing(true);
  log(`Starting ${target.kind} analysis.`);

  try {
    const report = await vscode.window.withProgress<AnalysisReport>(
      {
        location: vscode.ProgressLocation.Notification,
        title: target.kind === "workspace" ? "AI Assist: Analyzing workspace" : "AI Assist: Analyzing file",
        cancellable: true,
      },
      async (_progress, progressToken) => {
        const sub = progressToken.onCancellationRequested(() => currentAnalysis?.cancel());
        try {
          return await runAnalysis(target, token);
        } finally {
          sub.dispose();
        }
      },
    );

    if (token.isCancellationRequested) {
      return;
    }

    sidebarProvider.setReport(report);
    diagnostics.publish(report);

    if (!silent) {
      const { error, warning } = countSeverities(report);
      vscode.window.showInformationMessage(
        `AI Assist: ${report.findings.length} finding(s) (${error} errors, ${warning} warnings).`,
      );
    }
  } catch (err) {
    if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
      log("Analysis cancelled.");
      sidebarProvider.setReport(sidebarProvider.getReport());
      return;
    }
    log(`Analysis failed: ${String(err)}`);
    sidebarProvider.setReport(sidebarProvider.getReport());
    vscode.window.showErrorMessage(`AI Assist: Analysis failed. See "AI Assist Codebase" output for details.`);
  }
}

async function executeAsk(question: string, sidebarProvider: FindingsSidebarProvider): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showInformationMessage("AI Assist: Open a folder or workspace to ask questions about your codebase.");
    return;
  }

  currentAsk?.cancel();
  currentAsk?.dispose();
  currentAsk = new vscode.CancellationTokenSource();
  const token = currentAsk.token;

  sidebarProvider.setAsking(true);
  log(`Ask: ${question}`);

  try {
    const guidance = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "AI Assist: Preparing codebase guidance",
        cancellable: true,
      },
      async (_progress, progressToken) => {
        const sub = progressToken.onCancellationRequested(() => currentAsk?.cancel());
        try {
          const context = await collectWorkspaceContext();
          let codebaseMap = sidebarProvider.getCodebaseMap();
          if (!codebaseMap && context.workspaceRoot) {
            codebaseMap = await buildCodebaseMap(context);
          }
          return await runGuidance(question, context, codebaseMap, token);
        } finally {
          sub.dispose();
        }
      },
    );

    if (token.isCancellationRequested) return;
    sidebarProvider.setGuidance(guidance);
  } catch (err) {
    if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
      log("Ask cancelled.");
      sidebarProvider.setAsking(false);
      return;
    }
    log(`Ask failed: ${String(err)}`);
    sidebarProvider.setAsking(false);
    vscode.window.showErrorMessage(`AI Assist: Could not generate guidance. See "AI Assist Codebase" output for details.`);
  }
}

function countSeverities(report: AnalysisReport): { error: number; warning: number } {
  let error = 0;
  let warning = 0;
  for (const finding of report.findings) {
    if (finding.severity === "error") error++;
    if (finding.severity === "warning") warning++;
  }
  return { error, warning };
}

export function deactivate(): void {
  currentAnalysis?.cancel();
  currentAnalysis?.dispose();
  currentAnalysis = undefined;
  currentAsk?.cancel();
  currentAsk?.dispose();
  currentAsk = undefined;
  disposeLogger();
}
