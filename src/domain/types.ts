export type RoleId =
  | "designer"
  | "sales"
  | "installer"
  | "production"
  | "procurement"
  | "consumer";

export type RiskLevel = "standard" | "precision";

export type ConfidenceLevel = "verified" | "guided" | "needs-review";

export interface RoleProfile {
  id: RoleId;
  label: string;
  eyebrow: string;
  description: string;
  starterPrompts: readonly string[];
}

export interface OfficialSource {
  id: string;
  title: string;
  url: string;
  summary: string;
  official: true;
  keywords: readonly string[];
}

export interface KnowledgeMatch {
  source: OfficialSource;
  score: number;
  matchedKeywords: string[];
}
