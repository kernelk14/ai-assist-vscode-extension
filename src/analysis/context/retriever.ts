import { AnalysisContext, CollectedFile } from "../contextCollector";
import { CodebaseMap } from "../model/codebaseMap";

export interface RetrievedFile {
  file: CollectedFile;
  score: number;
  reason: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "for", "in", "on", "with", "how", "do", "i", "we", "my", "your", "this", "that", "it", "is", "are", "be", "add", "make", "create", "implement", "want", "should", "can", "codebase", "project",
]);

export function retrieveRelevantFiles(
  question: string,
  context: AnalysisContext,
  codebaseMap: CodebaseMap | undefined,
  limit = 8,
): RetrievedFile[] {
  const keywords = extractKeywords(question);
  const scored: RetrievedFile[] = [];

  for (const file of context.files) {
    let score = 0;
    const reasons: string[] = [];
    const pathLower = file.relativePath.toLowerCase();
    const contentLower = file.content.toLowerCase();

    for (const keyword of keywords) {
      if (pathLower.includes(keyword)) {
        score += 5;
        reasons.push(`path matches "${keyword}"`);
      }
      const occurrences = countOccurrences(contentLower, keyword);
      if (occurrences > 0) {
        score += Math.min(occurrences, 5);
        reasons.push(`contains "${keyword}"`);
      }
    }

    if (codebaseMap?.entryPoints.includes(file.relativePath)) score += 2;
    if (codebaseMap?.keyFiles.includes(file.relativePath)) score += 2;
    if (/readme|package\.json|tsconfig|config|route|api|service|controller|model|schema/i.test(file.relativePath)) score += 1;

    if (score > 0) {
      scored.push({ file, score, reason: Array.from(new Set(reasons)).slice(0, 3).join(", ") });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    return scored.slice(0, limit);
  }

  // Fallback: key files/entry points
  const fallbackPaths = new Set([...(codebaseMap?.keyFiles ?? []), ...(codebaseMap?.entryPoints ?? [])]);
  return context.files
    .filter((f) => fallbackPaths.has(f.relativePath))
    .slice(0, limit)
    .map((file) => ({ file, score: 1, reason: "key project file" }));
}

function extractKeywords(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_/-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOP_WORDS.has(t)),
    ),
  ).slice(0, 12);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
    if (count >= 20) break;
  }
  return count;
}
