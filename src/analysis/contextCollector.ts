import * as path from "path";
import * as vscode from "vscode";
import { getConfig } from "../utils/config";
import { log } from "../utils/logger";

export interface CollectedFile {
  uri: vscode.Uri;
  relativePath: string;
  content: string;
  languageId: string;
}

export interface AnalysisContext {
  workspaceRoot?: string;
  files: CollectedFile[];
  diagnostics: vscode.Diagnostic[];
}

const MAX_FILE_CHARS = 20_000;

export async function collectWorkspaceContext(): Promise<AnalysisContext> {
  const config = getConfig();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return { files: [], diagnostics: [] };
  }

  const exclude = `{${config.excludeGlobs.join(",")}}`;
  const uris = await vscode.workspace.findFiles("**/*", exclude, config.maxFilesToScan);
  const files = await readFiles(folder.uri.fsPath, uris);
  log(`Collected ${files.length} workspace files for analysis.`);
  return {
    workspaceRoot: folder.uri.fsPath,
    files,
    diagnostics: collectDiagnostics(uris),
  };
}

export async function collectFileContext(uri: vscode.Uri): Promise<AnalysisContext> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const root = folder?.uri.fsPath;
  const files = await readFiles(root ?? path.dirname(uri.fsPath), [uri]);
  return {
    workspaceRoot: root,
    files,
    diagnostics: vscode.languages.getDiagnostics(uri),
  };
}

async function readFiles(root: string, uris: vscode.Uri[]): Promise<CollectedFile[]> {
  const results: CollectedFile[] = [];
  for (const uri of uris) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File) {
        continue;
      }
      // Skip likely-binary/large files by extension/size heuristic.
      if (stat.size > 200_000) {
        continue;
      }
      if (isProbablyBinary(uri.fsPath)) {
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      let content = Buffer.from(bytes).toString("utf8");
      if (content.includes("\u0000")) {
        continue;
      }
      if (content.length > MAX_FILE_CHARS) {
        content = content.slice(0, MAX_FILE_CHARS) + "\n\n/* ...truncated for analysis... */";
      }
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      results.push({
        uri,
        relativePath: path.relative(root, uri.fsPath).replace(/\\/g, "/"),
        content,
        languageId: doc?.languageId ?? languageIdFromPath(uri.fsPath),
      });
    } catch (err) {
      log(`Skipping file ${uri.fsPath}: ${String(err)}`);
    }
  }
  return results;
}

function collectDiagnostics(uris: vscode.Uri[]): vscode.Diagnostic[] {
  const uriSet = new Set(uris.map((u) => u.toString()));
  const diagnostics: vscode.Diagnostic[] = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    if (uriSet.has(uri.toString())) {
      diagnostics.push(...diags);
    }
  }
  return diagnostics;
}

function isProbablyBinary(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|exe|dll|so|dylib|woff2?|ttf|eot|mp3|mp4|mov|avi)$/i.test(
    filePath,
  );
}

function languageIdFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".cs":
      return "csharp";
    case ".html":
      return "html";
    case ".css":
      return "css";
    default:
      return "plaintext";
  }
}
