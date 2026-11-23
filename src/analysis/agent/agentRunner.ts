import * as vscode from "vscode";
import { AnalysisContext } from "../contextCollector";
import { CodebaseMap } from "../model/codebaseMap";
import { AnalysisSummary, Finding } from "../model/finding";
import { log } from "../../utils/logger";
import { runWithVsCodeLm } from "./llmProvider";

interface AgentResult {
  summary: AnalysisSummary;
  findings: Finding[];
  usedModel?: string;
}

export async function runAgentAnalysis(
  context: AnalysisContext,
  staticFindings: Finding[],
  token: vscode.CancellationToken,
  codebaseMap?: CodebaseMap,
): Promise<AgentResult | undefined> {
  const prompt = buildPrompt(context, staticFindings, codebaseMap);
  const response = await runWithVsCodeLm(prompt, token);
  if (!response) {
    return undefined;
  }

  const parsed = parseAgentResponse(response.text);
  if (!parsed) {
    log("Agent response was not valid JSON; returning raw summary.");
    return {
      summary: {
        whatToDo: [response.text.slice(0, 1000)],
        notes: ["Agent returned unstructured output; showing raw response."],
      },
      findings: [],
      usedModel: response.model,
    };
  }

  const findings = (parsed.findings ?? []).map((f: any, idx: number) => normalizeAgentFinding(f, idx));
  return {
    summary: {
      whatToDo: Array.isArray(parsed.whatToDo) && parsed.whatToDo.length > 0
        ? parsed.whatToDo.map(String).slice(0, 10)
        : ["Review the static findings and address the highest-severity items first."],
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 10) : undefined,
      suggestedTasks: Array.isArray(parsed.suggestedTasks) ? parsed.suggestedTasks.map(String).slice(0, 8) : undefined,
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.map(String).slice(0, 8) : undefined,
    },
    findings,
    usedModel: response.model,
  };
}

function buildPrompt(context: AnalysisContext, staticFindings: Finding[], codebaseMap?: CodebaseMap): string {
  const fileSummaries = context.files
    .slice(0, 25)
    .map((f) => {
      const snippet = f.content.slice(0, 1400);
      return `### ${f.relativePath} (${f.languageId})\n\`\`\`\n${snippet}\n\`\`\``;
    })
    .join("\n\n");

  const findingSummary = staticFindings
    .slice(0, 40)
    .map((f) => `- [${f.severity}/${f.category}] ${f.file ?? "workspace"}:${f.line ?? "-"} ${f.title} — ${f.recommendation}`)
    .join("\n");

  const mapBlock = codebaseMap
    ? [
        `Summary: ${codebaseMap.summary}`,
        `Languages: ${codebaseMap.languages.join(", ") || "(unknown)"}`,
        `Frameworks/tools: ${codebaseMap.frameworks.join(", ") || "(none detected)"}`,
        `Entry points: ${codebaseMap.entryPoints.join(", ") || "(none detected)"}`,
        `Key files: ${codebaseMap.keyFiles.join(", ") || "(none)"}`,
        `Conventions: ${codebaseMap.conventions.join(" | ") || "(none)"}`,
      ].join("\n")
    : "No codebase map available.";

  return [
    "You are a codebase-aware analysis assistant inside a VS Code extension.",
    "Your job is to understand what this codebase does and tell the developer what to do next.",
    "Do NOT give generic advice when the codebase map/files provide specific context. Cite actual file paths.",
    "Do NOT suggest inline autocomplete. Do NOT write full replacement files. Provide actionable, repo-specific guidance.",
    "Also generate suggestedQuestions the user can ask next. Base them on your knowledge of this codebase, the problems/findings you see, and gaps/lacks/missing pieces (tests, docs, error handling, security, architecture, etc.). Make them specific to this codebase.",
    "",
    "Return ONLY valid JSON with this shape:",
    "{",
    '  "whatToDo": ["priority action 1 grounded in this codebase"],',
    '  "suggestedTasks": ["repo-specific task the user might want to implement next"],',
    '  "suggestedQuestions": ["specific question the user should ask about this codebase, based on gaps/problems/knowledge"],',
    '  "notes": ["optional note"],',
    '  "findings": [',
    "    {",
    '      "severity": "error|warning|info",',
    '      "category": "bug|security|maintainability|testing|performance|style|documentation|todo",',
    '      "title": "short title",',
    '      "recommendation": "specific actionable recommendation",',
    '      "evidence": "short evidence",',
    '      "file": "relative/path.ext",',
    '      "line": 1',
    "    }",
    "  ]",
    "}",
    "",
    "## Codebase map",
    mapBlock,
    "",
    "## Static findings",
    findingSummary || "(none)",
    "",
    "## Codebase context",
    fileSummaries || "(no files provided)",
  ].join("\n");
}

function parseAgentResponse(text: string): any | undefined {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const jsonBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonBlock) candidates.unshift(jsonBlock[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }
  return undefined;
}

function normalizeAgentFinding(raw: any, idx: number): Finding {
  const severity = ["error", "warning", "info"].includes(raw?.severity) ? raw.severity : "info";
  const category = ["bug", "security", "maintainability", "testing", "performance", "style", "documentation", "todo"].includes(raw?.category)
    ? raw.category
    : "maintainability";
  const file = typeof raw?.file === "string" ? raw.file.replace(/\\/g, "/") : undefined;
  const line = typeof raw?.line === "number" && Number.isFinite(raw.line) ? Math.max(1, Math.floor(raw.line)) : undefined;
  return {
    id: `agent:${file ?? "workspace"}:${line ?? 0}:${idx}:${String(raw?.title ?? "finding")}`.slice(0, 220),
    source: "agent",
    severity,
    category,
    title: String(raw?.title ?? "Agent finding").slice(0, 140),
    recommendation: String(raw?.recommendation ?? "Review this area.").slice(0, 1000),
    evidence: typeof raw?.evidence === "string" ? raw.evidence.slice(0, 300) : undefined,
    file,
    line,
    ruleId: "agent/analysis",
  };
}
