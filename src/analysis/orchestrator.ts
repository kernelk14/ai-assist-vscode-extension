import * as vscode from "vscode";
import { getConfig } from "../utils/config";
import { log } from "../utils/logger";
import { runAgentAnalysis } from "./agent/agentRunner";
import { buildCodebaseMap } from "./context/codebaseIndexer";
import { AnalysisContext, collectFileContext, collectWorkspaceContext } from "./contextCollector";
import { AnalysisReport, AnalysisSummary, Finding } from "./model/finding";
import { DiagnosticsAdapter } from "./static/diagnosticsAdapter";
import { HeuristicAnalyzer } from "./static/heuristicAnalyzer";
import { StaticAnalyzer } from "./static/staticAnalyzer";

export type AnalysisTarget =
  | { kind: "workspace" }
  | { kind: "file"; uri: vscode.Uri };

export async function runAnalysis(
  target: AnalysisTarget,
  token: vscode.CancellationToken,
): Promise<AnalysisReport> {
  const config = getConfig();
  const context = target.kind === "workspace"
    ? await collectWorkspaceContext()
    : await collectFileContext(target.uri);

  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }

  const codebaseMap = target.kind === "workspace" ? await buildCodebaseMap(context) : undefined;

  const staticAnalyzers: StaticAnalyzer[] = [new HeuristicAnalyzer(), new DiagnosticsAdapter()];
  const staticResults = await Promise.all(staticAnalyzers.map((a) => safeAnalyze(a, context)));
  let findings = dedupeFindings(staticResults.flat());

  let summary: AnalysisSummary = buildStaticSummary(findings, codebaseMap?.summary);
  let staticOnly = true;

  if (config.enableAgenticAnalysis && !token.isCancellationRequested) {
    const agentResult = await runAgentAnalysis(context, findings, token, codebaseMap);
    if (agentResult) {
      staticOnly = false;
      findings = dedupeFindings([...findings, ...agentResult.findings]);
      summary = agentResult.summary;
      if (agentResult.usedModel) {
        summary.notes = [...(summary.notes ?? []), `Agent model: ${agentResult.usedModel}`];
      }
    } else {
      summary.notes = [...(summary.notes ?? []), "Agentic analysis unavailable; showing static results only."];
    }
  }

  findings = sortFindings(findings);
  const targetLabel = target.kind === "workspace"
    ? (context.workspaceRoot ?? "Workspace")
    : vscode.workspace.asRelativePath(target.uri, false);

  const report: AnalysisReport = {
    findings,
    summary,
    analyzedAt: new Date().toISOString(),
    target: target.kind,
    targetLabel,
    staticOnly,
    codebaseMap,
  };

  log(`Analysis complete: ${findings.length} findings (${staticOnly ? "static-only" : "hybrid"}).`);
  return report;
}

async function safeAnalyze(analyzer: StaticAnalyzer, context: AnalysisContext): Promise<Finding[]> {
  try {
    return await analyzer.analyze(context);
  } catch (err) {
    log(`Static analyzer ${analyzer.id} failed: ${String(err)}`);
    return [];
  }
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];
  for (const finding of findings) {
    const key = [
      finding.ruleId ?? "",
      finding.file ?? "",
      finding.line ?? "",
      finding.title.toLowerCase().trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

function sortFindings(findings: Finding[]): Finding[] {
  const severityOrder = { error: 0, warning: 1, info: 2 };
  return [...findings].sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    if (sev !== 0) return sev;
    const file = (a.file ?? "").localeCompare(b.file ?? "");
    if (file !== 0) return file;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

function buildStaticSummary(findings: Finding[], codebaseSummary?: string): AnalysisSummary {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  const whatToDo: string[] = [];

  if (codebaseSummary) {
    whatToDo.push(`Understand the codebase: ${codebaseSummary}`);
  }
  if (errors > 0) whatToDo.push(`Fix ${errors} error-level finding(s) first; these are most likely to cause bugs or security issues.`);
  if (warnings > 0) whatToDo.push(`Address ${warnings} warning(s) to improve reliability and maintainability.`);
  if (infos > 0) whatToDo.push(`Review ${infos} informational finding(s) for cleanup and technical debt.`);
  if (findings.length === 0 && !codebaseSummary) {
    whatToDo.push("No findings detected by the current static checks. Consider enabling agentic analysis or adding project linters for deeper coverage.");
  }

  const suggestedTasks: string[] = [];
  if (findings.some((f) => f.category === "testing")) suggestedTasks.push("Add or improve tests for uncovered critical behavior.");
  if (findings.some((f) => f.category === "security")) suggestedTasks.push("Review security findings and harden sensitive code paths.");
  if (findings.some((f) => f.category === "maintainability")) suggestedTasks.push("Refactor maintainability hotspots into smaller, testable modules.");
  if (suggestedTasks.length === 0) suggestedTasks.push("Ask AI Assist how to implement a feature or change in this codebase.");

  const suggestedQuestions: string[] = [];
  if (findings.some((f) => f.category === "testing")) suggestedQuestions.push("What are the most important untested behaviors in this codebase, and how should I test them?");
  if (findings.some((f) => f.category === "security")) suggestedQuestions.push("Where are the security risks in this codebase, and how do I fix them safely?");
  if (findings.some((f) => f.category === "maintainability")) suggestedQuestions.push("Which parts of this codebase are hardest to maintain, and how should I refactor them?");
  if (findings.some((f) => f.ruleId === "heuristic/missing-tests")) suggestedQuestions.push("How should I set up a testing structure that fits this codebase?");
  if (findings.some((f) => f.ruleId === "heuristic/possible-secret")) suggestedQuestions.push("How should secrets and configuration be managed in this codebase?");
  if (suggestedQuestions.length === 0) suggestedQuestions.push("What important gaps or missing pieces should I address in this codebase?");

  return {
    whatToDo,
    notes: ["Summary generated from static checks."],
    suggestedTasks,
    suggestedQuestions,
  };
}
