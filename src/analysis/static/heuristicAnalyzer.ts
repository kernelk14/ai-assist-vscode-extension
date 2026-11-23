import { AnalysisContext } from "../contextCollector";
import { Finding } from "../model/finding";
import { StaticAnalyzer } from "./staticAnalyzer";

function makeId(parts: string[]): string {
  return parts.join(":").replace(/[^a-zA-Z0-9:_./-]/g, "_").slice(0, 200);
}

export class HeuristicAnalyzer implements StaticAnalyzer {
  id = "heuristics";

  async analyze(context: AnalysisContext): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const file of context.files) {
      const lines = file.content.split(/\r?\n/);
      this.checkTodos(file.relativePath, lines, findings);
      this.checkConsoleLogs(file.relativePath, lines, findings);
      this.checkAnyType(file.relativePath, lines, findings);
      this.checkEmptyCatch(file.relativePath, file.content, findings);
      this.checkLargeFile(file.relativePath, lines, findings);
      this.checkSecrets(file.relativePath, lines, findings);
    }

    this.checkMissingTests(context, findings);
    return findings;
  }

  private checkTodos(file: string, lines: string[], findings: Finding[]): void {
    lines.forEach((line, idx) => {
      const match = line.match(/\b(TODO|FIXME|HACK)\b[:\s]*(.*)/i);
      if (!match) return;
      const tag = match[1].toUpperCase();
      const detail = match[2]?.trim();
      findings.push({
        id: makeId(["heuristic", "todo", file, String(idx + 1), tag]),
        source: "static",
        severity: tag === "FIXME" ? "warning" : "info",
        category: "todo",
        title: `${tag} found`,
        recommendation: detail
          ? `Address the ${tag}: ${detail}`
          : `Review and resolve this ${tag} comment or convert it into a tracked issue.`,
        evidence: line.trim().slice(0, 200),
        file,
        line: idx + 1,
        ruleId: "heuristic/todo-comment",
      });
    });
  }

  private checkConsoleLogs(file: string, lines: string[], findings: Finding[]): void {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return;
    lines.forEach((line, idx) => {
      if (!/\bconsole\.(log|debug|info)\s*\(/.test(line)) return;
      if (/^\s*\/\//.test(line)) return;
      findings.push({
        id: makeId(["heuristic", "console", file, String(idx + 1)]),
        source: "static",
        severity: "info",
        category: "maintainability",
        title: "Console logging left in code",
        recommendation: "Remove debug logging or replace it with a structured logger before shipping.",
        evidence: line.trim().slice(0, 200),
        file,
        line: idx + 1,
        ruleId: "heuristic/console-log",
      });
    });
  }

  private checkAnyType(file: string, lines: string[], findings: Finding[]): void {
    if (!/\.(ts|tsx)$/.test(file)) return;
    lines.forEach((line, idx) => {
      if (!/\b:\s*any\b|\bas\s+any\b/.test(line)) return;
      if (/^\s*\/\//.test(line)) return;
      findings.push({
        id: makeId(["heuristic", "any", file, String(idx + 1)]),
        source: "static",
        severity: "warning",
        category: "maintainability",
        title: "Explicit `any` type",
        recommendation: "Replace `any` with a specific type or `unknown` and narrow it where used.",
        evidence: line.trim().slice(0, 200),
        file,
        line: idx + 1,
        ruleId: "heuristic/no-any",
      });
    });
  }

  private checkEmptyCatch(file: string, content: string, findings: Finding[]): void {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return;
    const regex = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push({
        id: makeId(["heuristic", "empty-catch", file, String(line)]),
        source: "static",
        severity: "warning",
        category: "bug",
        title: "Empty catch block",
        recommendation: "Handle the error, log it, or rethrow. Empty catches hide failures and make debugging harder.",
        evidence: match[0].slice(0, 200),
        file,
        line,
        ruleId: "heuristic/empty-catch",
      });
    }
  }

  private checkLargeFile(file: string, lines: string[], findings: Finding[]): void {
    if (lines.length < 400) return;
    findings.push({
      id: makeId(["heuristic", "large-file", file]),
      source: "static",
      severity: "info",
      category: "maintainability",
      title: "Large file",
      recommendation: `This file has ${lines.length} lines. Consider splitting responsibilities into smaller modules to make it easier to maintain and test.`,
      evidence: `${file} has ${lines.length} lines`,
      file,
      line: 1,
      ruleId: "heuristic/large-file",
    });
  }

  private checkSecrets(file: string, lines: string[], findings: Finding[]): void {
    const secretPattern = /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i;
    lines.forEach((line, idx) => {
      if (/^\s*[#/\/\*]/.test(line)) return;
      if (!secretPattern.test(line)) return;
      if (/process\.env|import\.meta\.env|getenv|config\.|settings\./i.test(line)) return;
      findings.push({
        id: makeId(["heuristic", "secret", file, String(idx + 1)]),
        source: "static",
        severity: "error",
        category: "security",
        title: "Possible hardcoded secret",
        recommendation: "Move secrets to environment variables or a secret manager. Rotate the value if it was committed.",
        evidence: line.trim().replace(/(['"])[^'"]{4}[^'"]*([^'"]{2})\1/, "$1***REDACTED***$2$1").slice(0, 200),
        file,
        line: idx + 1,
        ruleId: "heuristic/possible-secret",
      });
    });
  }

  private checkMissingTests(context: AnalysisContext, findings: Finding[]): void {
    const files = context.files.map((f) => f.relativePath);
    const hasSource = files.some((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/test|spec/.test(f));
    const hasTests = files.some((f) => /(\.test\.|\.spec\.|__tests__)/.test(f));
    if (hasSource && !hasTests) {
      findings.push({
        id: makeId(["heuristic", "missing-tests", context.workspaceRoot ?? "workspace"]),
        source: "static",
        severity: "warning",
        category: "testing",
        title: "No tests detected",
        recommendation: "Add automated tests for critical behavior. Start with unit tests for core logic and regression tests for known bugs.",
        evidence: "Workspace contains source files but no obvious test files.",
        ruleId: "heuristic/missing-tests",
      });
    }
  }
}
