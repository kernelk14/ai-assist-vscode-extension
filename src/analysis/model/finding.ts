import { CodebaseMap } from "./codebaseMap";

export type FindingSeverity = "error" | "warning" | "info";

export type FindingCategory =
  | "bug"
  | "security"
  | "maintainability"
  | "testing"
  | "performance"
  | "style"
  | "documentation"
  | "todo";

export type FindingSource = "static" | "agent";

export interface Finding {
  id: string;
  source: FindingSource;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  recommendation: string;
  evidence?: string;
  file?: string;
  line?: number;
  endLine?: number;
  ruleId?: string;
}

export interface AnalysisSummary {
  whatToDo: string[];
  notes?: string[];
  suggestedTasks?: string[];
  suggestedQuestions?: string[];
}

export interface AnalysisReport {
  findings: Finding[];
  summary: AnalysisSummary;
  analyzedAt: string;
  target: "workspace" | "file";
  targetLabel: string;
  staticOnly: boolean;
  codebaseMap?: CodebaseMap;
}
