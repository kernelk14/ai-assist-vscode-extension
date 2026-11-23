import * as path from "path";
import { AnalysisContext } from "../contextCollector";
import { CodebaseMap } from "../model/codebaseMap";

export async function buildCodebaseMap(context: AnalysisContext): Promise<CodebaseMap> {
  const files = context.files;
  const relativePaths = files.map((f) => f.relativePath);
  const languages = Array.from(new Set(files.map((f) => f.languageId).filter((l) => l !== "plaintext"))).slice(0, 12);

  const packageJson = files.find((f) => f.relativePath === "package.json");
  const pkg = safeParseJson(packageJson?.content);
  const scripts = pkg && typeof pkg.scripts === "object" && pkg.scripts
    ? Object.keys(pkg.scripts).slice(0, 20).map((k) => `${k}: ${String(pkg.scripts[k]).slice(0, 80)}`)
    : [];
  const deps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
    ...(pkg?.peerDependencies ?? {}),
  } as Record<string, string>;
  const frameworks = detectFrameworks(deps, relativePaths);
  const packageManagers = detectPackageManagers(relativePaths);
  const entryPoints = detectEntryPoints(relativePaths, pkg);
  const keyFiles = pickKeyFiles(relativePaths);
  const directories = summarizeDirectories(relativePaths);
  const conventions = detectConventions(files, relativePaths, pkg);
  const summary = buildSummary({ languages, frameworks, entryPoints, directories, pkg, relativePaths, conventions });
  const suggestedQuestions = buildSuggestedQuestions({ frameworks, entryPoints, scripts, relativePaths, pkg });

  return {
    rootPath: context.workspaceRoot ?? "",
    summary,
    languages,
    frameworks,
    packageManagers,
    scripts,
    entryPoints,
    keyFiles,
    directories,
    conventions,
    suggestedQuestions,
    generatedAt: new Date().toISOString(),
  };
}

function safeParseJson(content: string | undefined): any | undefined {
  if (!content) return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function detectFrameworks(deps: Record<string, string>, files: string[]): string[] {
  const found = new Set<string>();
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  if (has("react")) found.add("React");
  if (has("next")) found.add("Next.js");
  if (has("vue")) found.add("Vue");
  if (has("svelte")) found.add("Svelte");
  if (has("@angular/core")) found.add("Angular");
  if (has("express")) found.add("Express");
  if (has("fastify")) found.add("Fastify");
  if (has("nestjs") || has("@nestjs/core")) found.add("NestJS");
  if (has("vscode")) found.add("VS Code Extension API");
  if (has("typescript")) found.add("TypeScript");
  if (has("vitest")) found.add("Vitest");
  if (has("jest")) found.add("Jest");
  if (has("mocha")) found.add("Mocha");
  if (files.some((f) => f.endsWith("pyproject.toml") || f.endsWith("requirements.txt"))) found.add("Python");
  if (files.some((f) => f.endsWith("go.mod"))) found.add("Go");
  if (files.some((f) => f.endsWith("Cargo.toml"))) found.add("Rust");
  return Array.from(found).slice(0, 15);
}

function detectPackageManagers(files: string[]): string[] {
  const managers: string[] = [];
  if (files.includes("package-lock.json")) managers.push("npm");
  if (files.includes("pnpm-lock.yaml")) managers.push("pnpm");
  if (files.includes("yarn.lock")) managers.push("yarn");
  if (files.includes("bun.lockb") || files.includes("bun.lock")) managers.push("bun");
  if (files.includes("go.mod")) managers.push("go");
  if (files.includes("Cargo.toml")) managers.push("cargo");
  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) managers.push("pip/python");
  return managers;
}

function detectEntryPoints(files: string[], pkg: any): string[] {
  const candidates = [
    pkg?.main,
    pkg?.module,
    pkg?.browser,
    "src/index.ts",
    "src/index.tsx",
    "src/main.ts",
    "src/main.tsx",
    "src/extension.ts",
    "src/app.ts",
    "src/server.ts",
    "index.ts",
    "index.js",
    "main.py",
    "app.py",
  ].filter((v): v is string => typeof v === "string");
  const found = candidates.filter((c) => files.includes(c.replace(/^\.\//, "")));
  for (const f of files) {
    if (/^(src\/)?(extension|main|index|app|server)\.(ts|tsx|js|jsx|py|go|rs)$/.test(f)) {
      if (!found.includes(f)) found.push(f);
    }
  }
  return Array.from(new Set(found)).slice(0, 12);
}

function pickKeyFiles(files: string[]): string[] {
  const priority = [
    "README.md",
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "src/extension.ts",
    "src/main.ts",
    "src/index.ts",
    "src/app.tsx",
  ];
  const picked = priority.filter((f) => files.includes(f));
  for (const f of files) {
    if (picked.length >= 20) break;
    if (/config|route|schema|api|service|controller/i.test(f) && !picked.includes(f)) {
      picked.push(f);
    }
  }
  return picked.slice(0, 20);
}

function summarizeDirectories(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/");
    const top = parts.length > 1 ? parts[0] + "/" : ".";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([dir, count]) => `${dir} (${count} files)`);
}

function detectConventions(files: { relativePath: string; content: string }[], paths: string[], pkg: any): string[] {
  const conventions: string[] = [];
  if (paths.some((f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"))) conventions.push("Automated tests present");
  else conventions.push("No obvious test files detected");
  if (paths.some((f) => f.startsWith("src/"))) conventions.push("Source code organized under src/");
  if (pkg?.scripts?.build) conventions.push(`Build script: ${String(pkg.scripts.build).slice(0, 80)}`);
  if (pkg?.scripts?.test) conventions.push(`Test script: ${String(pkg.scripts.test).slice(0, 80)}`);
  if (pkg?.scripts?.lint) conventions.push(`Lint script: ${String(pkg.scripts.lint).slice(0, 80)}`);
  if (files.some((f) => /export (class|function|const|interface|type)/.test(f.content))) conventions.push("ES module exports used");
  if (files.some((f) => f.relativePath.endsWith("tsconfig.json"))) conventions.push("TypeScript configuration present");
  return conventions.slice(0, 12);
}

function buildSummary(input: {
  languages: string[];
  frameworks: string[];
  entryPoints: string[];
  directories: string[];
  pkg: any;
  relativePaths: string[];
  conventions: string[];
}): string {
  const name = typeof input.pkg?.name === "string" ? input.pkg.name : "This workspace";
  const desc = typeof input.pkg?.description === "string" ? input.pkg.description : "";
  const parts: string[] = [];
  parts.push(`${name}${desc ? ` — ${desc}` : ""}.`);
  if (input.languages.length) parts.push(`Primary languages: ${input.languages.join(", ")}.`);
  if (input.frameworks.length) parts.push(`Frameworks/tools: ${input.frameworks.join(", ")}.`);
  if (input.entryPoints.length) parts.push(`Likely entry points: ${input.entryPoints.join(", ")}.`);
  if (input.directories.length) parts.push(`Top areas: ${input.directories.join(", ")}.`);
  if (input.relativePaths.length === 0) parts.push("Workspace appears empty or no readable files were collected.");
  return parts.join(" ");
}

function buildSuggestedQuestions(input: {
  frameworks: string[];
  entryPoints: string[];
  scripts: string[];
  relativePaths: string[];
  pkg: any;
}): string[] {
  const questions: string[] = [];
  const has = (f: string) => input.frameworks.includes(f);
  const hasFile = (pattern: RegExp) => input.relativePaths.some((p) => pattern.test(p));

  questions.push("What does this codebase do, and how is it organized?");

  if (has("VS Code Extension API")) {
    questions.push("How do I add a new command to this VS Code extension?");
    questions.push("How do I add a new setting/configuration option?");
    questions.push("How does the extension activation and main flow work?");
  }
  if (has("React") || has("Next.js") || has("Vue") || has("Svelte") || has("Angular")) {
    questions.push("How do I add a new UI component following this project's patterns?");
  }
  if (has("Express") || has("Fastify") || has("NestJS") || hasFile(/route|controller|api/i)) {
    questions.push("How do I add a new API endpoint in this codebase?");
  }
  if (hasFile(/test|spec|__tests__/i)) {
    questions.push("How do I write tests that match this project's testing style?");
  } else {
    questions.push("How should I add tests to this project?");
  }
  if (input.scripts.some((s) => s.startsWith("build:"))) questions.push("How do I build and run this project locally?");
  if (input.entryPoints.length > 0) questions.push(`Where should I start reading to understand ${input.entryPoints[0]}?`);
  if (typeof input.pkg?.name === "string") questions.push(`How can I safely add a new feature to ${input.pkg.name}?`);

  return Array.from(new Set(questions)).slice(0, 8);
}
