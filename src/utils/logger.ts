import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("AI Assist Codebase");
  }
  return channel;
}

export function log(message: string): void {
  const time = new Date().toISOString();
  getLogger().appendLine(`[${time}] ${message}`);
}

export function disposeLogger(): void {
  channel?.dispose();
  channel = undefined;
}
