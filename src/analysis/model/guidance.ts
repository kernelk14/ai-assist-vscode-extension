export interface GuidanceReference {
  path: string;
  reason: string;
  line?: number;
}

export interface GuidanceStep {
  title: string;
  detail: string;
  files?: string[];
}

export interface GuidanceExample {
  title: string;
  language: string;
  snippet: string;
  explanation: string;
  file?: string;
}

export interface GuidanceResponse {
  question: string;
  codebaseSummary: string;
  teaching: string[];
  relevantFiles: GuidanceReference[];
  steps: GuidanceStep[];
  examples: GuidanceExample[];
  checks: string[];
  warnings: string[];
  followUpQuestions: string[];
  usedModel?: string;
  createdAt: string;
}
