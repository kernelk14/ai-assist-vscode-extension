import * as vscode from "vscode";
import { log } from "../../utils/logger";
import { AnalysisContext } from "../contextCollector";
import { CodebaseMap } from "../model/codebaseMap";
import { GuidanceExample, GuidanceResponse } from "../model/guidance";
import { retrieveRelevantFiles } from "../context/retriever";
import { runWithVsCodeLm } from "./llmProvider";

export async function runGuidance(
  question: string,
  context: AnalysisContext,
  codebaseMap: CodebaseMap | undefined,
  token: vscode.CancellationToken,
): Promise<GuidanceResponse> {
  const retrieved = retrieveRelevantFiles(question, context, codebaseMap, 8);
  const prompt = buildPrompt(question, context, codebaseMap, retrieved.map((r) => r.file));

  const response = await runWithVsCodeLm(prompt, token);
  if (response) {
    const parsed = parseJson(response.text);
    if (parsed) {
      return normalizeGuidance(question, parsed, codebaseMap, response.model);
    }
    log("Guidance response was not valid JSON; returning fallback.");
  }

  return buildFallbackGuidance(question, codebaseMap, retrieved.map((r) => ({ path: r.file.relativePath, reason: r.reason })));
}

function buildPrompt(question: string, context: AnalysisContext, codebaseMap: CodebaseMap | undefined, files: { relativePath: string; languageId: string; content: string }[]): string {
  const mapBlock = codebaseMap
    ? [
        `Summary: ${codebaseMap.summary}`,
        `Languages: ${codebaseMap.languages.join(", ") || "(unknown)"}`,
        `Frameworks/tools: ${codebaseMap.frameworks.join(", ") || "(none detected)"}`,
        `Entry points: ${codebaseMap.entryPoints.join(", ") || "(none detected)"}`,
        `Key files: ${codebaseMap.keyFiles.join(", ") || "(none)"}`,
        `Directories: ${codebaseMap.directories.join(", ") || "(none)"}`,
        `Conventions: ${codebaseMap.conventions.join(" | ") || "(none)"}`,
        `Scripts: ${codebaseMap.scripts.join(" | ") || "(none)"}`,
        `Suggested questions: ${codebaseMap.suggestedQuestions.join(" | ") || "(none)"}`,
      ].join("\n")
    : "No codebase map available.";

  const fileBlocks = files.map((f) => `### ${f.relativePath} (${f.languageId})\n\`\`\`\n${f.content.slice(0, 1800)}\n\`\`\``).join("\n\n");

  return [
    "You are a codebase-aware teaching assistant inside a VS Code extension.",
    "Teach the user how to do the requested task in THIS codebase. Do not give generic advice when codebase-specific guidance is possible.",
    "Explain how the relevant part of the codebase works, why the recommended approach fits, and give concrete steps.",
    "Include small illustrative code snippets/examples when helpful. Snippets are examples only - never imply they were auto-applied.",
    "Cite actual file paths. If you are unsure, say so in warnings.",
    "Do NOT suggest inline autocomplete. Do NOT auto-edit files.",
    "",
    "Return ONLY valid JSON with this shape:",
    "{",
    '  "codebaseSummary": "what this codebase does, grounded in provided context",',
    '  "teaching": ["short teaching point about how this codebase works or why this pattern fits"],',
    '  "relevantFiles": [{"path": "relative/path", "reason": "why relevant", "line": 1}],',
    '  "steps": [{"title": "step title", "detail": "specific actionable detail", "files": ["relative/path"]}],',
    '  "examples": [{"title": "example title", "language": "ts", "snippet": "short example code", "explanation": "what this example shows", "file": "relative/path"}],',
    '  "checks": ["tests/lint/build/manual checks to run"],',
    '  "warnings": ["assumptions or missing info"],',
    '  "followUpQuestions": ["suggested next question"]',
    "}",
    "",
    `## User question\n${question}`,
    "",
    "## Codebase map",
    mapBlock,
    "",
    "## Relevant files",
    fileBlocks || "(no relevant files retrieved)",
    "",
    "## Workspace root",
    context.workspaceRoot ?? "(unknown)",
  ].join("\n");
}

function parseJson(text: string): any | undefined {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (block) candidates.unshift(block[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* ignore */ }
  }
  return undefined;
}

function normalizeGuidance(question: string, raw: any, codebaseMap: CodebaseMap | undefined, model: string): GuidanceResponse {
  const relevantFiles = Array.isArray(raw?.relevantFiles)
    ? raw.relevantFiles.slice(0, 10).map((r: any) => ({
        path: String(r?.path ?? "").replace(/\\/g, "/"),
        reason: String(r?.reason ?? "Relevant to the request").slice(0, 240),
        line: typeof r?.line === "number" && Number.isFinite(r.line) ? Math.max(1, Math.floor(r.line)) : undefined,
      })).filter((r: any) => r.path)
    : [];
  const steps = Array.isArray(raw?.steps)
    ? raw.steps.slice(0, 12).map((s: any) => ({
        title: String(s?.title ?? "Step").slice(0, 140),
        detail: String(s?.detail ?? "").slice(0, 1500),
        files: Array.isArray(s?.files) ? s.files.map(String).slice(0, 10) : undefined,
      }))
    : [];
  const examples: GuidanceExample[] = Array.isArray(raw?.examples)
    ? raw.examples.slice(0, 4).map((e: any) => ({
        title: String(e?.title ?? "Example").slice(0, 140),
        language: String(e?.language ?? "text").slice(0, 40),
        snippet: String(e?.snippet ?? "").slice(0, 3000),
        explanation: String(e?.explanation ?? "").slice(0, 500),
        file: typeof e?.file === "string" ? e.file.replace(/\\/g, "/") : undefined,
      })).filter((e: GuidanceExample) => e.snippet.trim().length > 0)
    : [];

  return {
    question,
    codebaseSummary: String(raw?.codebaseSummary ?? codebaseMap?.summary ?? "No codebase summary available.").slice(0, 2000),
    teaching: Array.isArray(raw?.teaching) ? raw.teaching.map(String).slice(0, 8) : defaultTeaching(codebaseMap),
    relevantFiles,
    steps: steps.length ? steps : [{ title: "Review relevant files", detail: "Inspect the relevant files and adapt the change to existing patterns.", files: relevantFiles.map((r: { path: string }) => r.path) }],
    examples,
    checks: Array.isArray(raw?.checks) ? raw.checks.map(String).slice(0, 10) : ["Run the project's build/tests after making changes."],
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String).slice(0, 10) : [],
    followUpQuestions: Array.isArray(raw?.followUpQuestions) ? raw.followUpQuestions.map(String).slice(0, 6) : (codebaseMap?.suggestedQuestions.slice(0, 3) ?? []),
    usedModel: model,
    createdAt: new Date().toISOString(),
  };
}

function defaultTeaching(codebaseMap: CodebaseMap | undefined): string[] {
  if (!codebaseMap) return ["Run Analyze Workspace first so the assistant can learn this codebase's structure."];
  const points = [`This codebase: ${codebaseMap.summary}`];
  if (codebaseMap.conventions.length) points.push(`Conventions to follow: ${codebaseMap.conventions.slice(0, 3).join("; ")}.`);
  return points;
}

function buildFallbackGuidance(question: string, codebaseMap: CodebaseMap | undefined, relevantFiles: { path: string; reason: string }[]): GuidanceResponse {
  const examples = fallbackExamples(codebaseMap);
  return {
    question,
    codebaseSummary: codebaseMap?.summary ?? "No codebase summary available. Run Analyze Workspace to index the project.",
    teaching: defaultTeaching(codebaseMap),
    relevantFiles,
    steps: [
      {
        title: "Understand the existing pattern",
        detail: "Start with the key files and entry points. Find a similar feature and mirror its structure before creating something new.",
        files: codebaseMap?.keyFiles?.slice(0, 5),
      },
      {
        title: "Locate where your change belongs",
        detail: `Search for code related to: "${question}". Identify the module, types, and wiring points that need updating.`,
        files: relevantFiles.map((r) => r.path),
      },
      {
        title: "Implement in small, verifiable steps",
        detail: "Make the smallest change that fits existing conventions, then add/update tests or checks. Keep behavior consistent with the rest of the codebase.",
      },
    ],
    examples,
    checks: ["Run build/typecheck/lint/tests relevant to the changed area."],
    warnings: ["Agentic model unavailable; this is a heuristic fallback. Enable VS Code LM access for codebase-specific teaching and examples."],
    followUpQuestions: codebaseMap?.suggestedQuestions.slice(0, 4) ?? [],
    createdAt: new Date().toISOString(),
  };
}

function fallbackExamples(codebaseMap: CodebaseMap | undefined): GuidanceExample[] {
  if (codebaseMap?.frameworks.includes("VS Code Extension API")) {
    return [
      {
        title: "Register a command (example)",
        language: "ts",
        file: "src/extension.ts",
        explanation: "Example pattern for adding a VS Code command. Adapt names/logic to your extension.",
        snippet: `context.subscriptions.push(\n  vscode.commands.registerCommand("myExtension.myCommand", async () => {\n    vscode.window.showInformationMessage("Hello from my command");\n  }),\n);`,
      },
    ];
  }
  if (codebaseMap?.frameworks.includes("React") || codebaseMap?.frameworks.includes("Next.js")) {
    return [
      {
        title: "Component pattern (example)",
        language: "tsx",
        explanation: "Example component structure. Match your project's props/state/styling conventions.",
        snippet: `type Props = { title: string };\n\nexport function ExampleCard({ title }: Props) {\n  return <section><h2>{title}</h2></section>;\n}`,
      },
    ];
  }
  return [];
}
