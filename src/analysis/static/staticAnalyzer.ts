import { AnalysisContext } from "../contextCollector";
import { Finding } from "../model/finding";

export interface StaticAnalyzer {
  id: string;
  analyze(context: AnalysisContext): Promise<Finding[]>;
}
