# AI Assist Codebase

A VS Code extension that analyzes your codebase, understands what it does, and tells you how to implement changes in it.

## What it does

- **Codebase-aware guidance**: builds a workspace map (languages, frameworks, entry points, conventions) and uses it to provide repo-specific steps.
- **Ask the codebase**: ask “How do I implement X?” in the sidebar and get actionable steps with cited files.
- **Hybrid analysis**: combines deterministic static checks with optional agentic synthesis through the VS Code Language Model API (`vscode.lm`).
- **Actionable findings**: reports severity, evidence, and recommended next steps in the sidebar and Problems panel.
- **No auto-suggest / no auto-edit**: does not provide inline completions and does not modify code automatically.

## Commands

- `AI Assist: Analyze Workspace` - scan the workspace, build codebase understanding, and report findings/tasks.
- `AI Assist: Analyze Current File` - analyze the active editor file.
- `AI Assist: Refresh Analysis` - rerun the last analysis.
- `AI Assist: Clear Results` - clear findings, guidance, and diagnostics.

## Settings

- `aiAssistCodebase.analysisTrigger` - `manual` (default) or `onSave`.
- `aiAssistCodebase.enableAgenticAnalysis` - use `vscode.lm` for synthesis/guidance when available; falls back to static/heuristic guidance.
- `aiAssistCodebase.enableDiagnostics` - publish findings to Problems.
- `aiAssistCodebase.maxFilesToScan` - cap workspace scan size.
- `aiAssistCodebase.excludeGlobs` - glob patterns excluded from scans.

## Development

```bash
npm install
npm run build
```

Press `F5` in VS Code to launch the Extension Development Host.

## Notes

- Agentic guidance uses VS Code's Language Model API. If no model is available, the extension still provides codebase map + heuristic/static guidance.
- Guidance cites workspace files when available; always review suggestions before applying changes.
