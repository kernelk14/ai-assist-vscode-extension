import * as vscode from "vscode";

export interface ExtensionConfig {
  analysisTrigger: "manual" | "onSave";
  enableAgenticAnalysis: boolean;
  enableDiagnostics: boolean;
  maxFilesToScan: number;
  excludeGlobs: string[];
}

export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("aiAssistCodebase");
  return {
    analysisTrigger: config.get<"manual" | "onSave">("analysisTrigger", "manual"),
    enableAgenticAnalysis: config.get<boolean>("enableAgenticAnalysis", true),
    enableDiagnostics: config.get<boolean>("enableDiagnostics", true),
    maxFilesToScan: config.get<number>("maxFilesToScan", 200),
    excludeGlobs: config.get<string[]>("excludeGlobs", [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/out/**",
      "**/coverage/**",
    ]),
  };
}
