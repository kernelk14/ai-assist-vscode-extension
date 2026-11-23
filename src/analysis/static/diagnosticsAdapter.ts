import * as path from "path";
import * as vscode from "vscode";
import { AnalysisContext } from "../contextCollector";
import { Finding, FindingSeverity } from "../model/finding";
import { StaticAnalyzer } from "./staticAnalyzer";

function mapSeverity(severity: vscode.DiagnosticSeverity): FindingSeverity {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    default:
      return "info";
  }
}

export class DiagnosticsAdapter implements StaticAnalyzer {
  id = "vscode-diagnostics";

  async analyze(context: AnalysisContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const root = context.workspaceRoot;
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
      if (context.files.length > 0 && !context.files.some((f) => f.uri.toString() === uri.toString())) {
        continue;
      }
      for (const diag of diags) {
        const rel = root ? path.relative(root, uri.fsPath).replace(/\\/g, "/") : uri.fsPath;
        findings.push({
          id: `diag:${rel}:${diag.range.start.line + 1}:${diag.message}`.slice(0, 220),
          source: "static",
          severity: mapSeverity(diag.severity),
          category: "bug",
          title: diag.message.split(/\r?\n/)[0].slice(0, 140),
          recommendation: "Resolve this diagnostic reported by your configured language tooling/linter.",
          evidence: diag.message.slice(0, 300),
          file: rel,
          line: diag.range.start.line + 1,
          endLine: diag.range.end.line + 1,
          ruleId: typeof diag.code === "object" ? String(diag.code.value) : diag.code?.toString(),
        });
      }
    }
    return findings;
  }
}
