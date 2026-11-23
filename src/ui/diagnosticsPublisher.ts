import * as path from "path";
import * as vscode from "vscode";
import { AnalysisReport, FindingSeverity } from "../analysis/model/finding";
import { getConfig } from "../utils/config";

export class DiagnosticsPublisher implements vscode.Disposable {
  private collection = vscode.languages.createDiagnosticCollection("ai-assist-codebase");

  publish(report: AnalysisReport): void {
    this.clear();
    if (!getConfig().enableDiagnostics) {
      return;
    }

    const byFile = new Map<string, vscode.Diagnostic[]>();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    for (const finding of report.findings) {
      if (!finding.file) continue;
      const abs = path.isAbsolute(finding.file)
        ? finding.file
        : root
          ? path.join(root, finding.file)
          : finding.file;
      const uriKey = vscode.Uri.file(abs).toString();
      const list = byFile.get(uriKey) ?? [];
      const line = Math.max(0, (finding.line ?? 1) - 1);
      const endLine = Math.max(line, (finding.endLine ?? finding.line ?? 1) - 1);
      const range = new vscode.Range(line, 0, endLine, 1000);
      const diagnostic = new vscode.Diagnostic(range, `${finding.title}: ${finding.recommendation}`, toVscodeSeverity(finding.severity));
      diagnostic.source = "AI Assist";
      diagnostic.code = finding.ruleId;
      list.push(diagnostic);
      byFile.set(uriKey, list);
    }

    for (const [uriStr, diagnostics] of byFile) {
      this.collection.set(vscode.Uri.parse(uriStr), diagnostics);
    }
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function toVscodeSeverity(severity: FindingSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}
