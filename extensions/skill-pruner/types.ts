import type { Skill } from "@mariozechner/pi-coding-agent";

export type PruningMode = "auto" | "off" | "shadow";

export interface SkillPruningConfig {
	ceiling: number;
	floor: number;
	scoreThreshold: number;
	gapThreshold: number;
	pinned: string[];
}

export interface PruningConfig {
	mode: PruningMode;
	skills: SkillPruningConfig;
	tools?: ToolPruningConfig;
}

export interface SkillTriggers {
	positive: string[];
	negative: string[];
}

export interface SkillScoreCacheEntry {
	triggers: SkillTriggers;
	nameTokens: string[];
}

export interface ScoredSkill {
	skill: Skill;
	name: string;
	triggerScore: number;
	keywordScore: number;
	nameScore: number;
	triggerNormalized: number;
	keywordNormalized: number;
	nameNormalized: number;
	compositeScore: number;
	pinned?: boolean;
}

export interface ThresholdResult {
	included: ScoredSkill[];
	excluded: ScoredSkill[];
}

export interface PruningDecisionCandidate {
	name: string;
	triggerScore: number;
	keywordScore: number;
	nameScore: number;
	compositeScore: number;
	included: boolean;
	pinned?: boolean;
}

export type ToolTier = "core" | "contextual" | "rare";

export type ToolTierConfig = Record<string, ToolTier>;

export type ToolDependencies = Record<string, string[]>;

export interface ToolPruningConfig {
	tiers: ToolTierConfig;
	dependencies: ToolDependencies;
	ceiling: number;
}

export interface ScoredTool {
	name: string;
	description: string;
	tier: ToolTier;
	keywordScore: number;
	nameScore: number;
	compositeScore: number;
}

export interface PruningResult {
	includedSkills: string[];
	excludedSkills: string[];
	includedTools: string[];
	excludedTools: string[];
	mode: PruningMode;
	skillTokensSaved: number;
	toolTokensSaved: number;
}

export interface PruningDecision {
	timestamp: string;
	sessionId: string;
	mode: PruningMode;
	query: string;
	contextFile?: string;
	candidates: PruningDecisionCandidate[];
	pinned: string[];
	included: string[];
	excluded: string[];
	skillBlockTokens: number;
	originalBlockTokens: number;
	toolCandidates?: Array<{ name: string; tier: ToolTier; keywordScore: number; nameScore: number; compositeScore: number; included: boolean }>;
	toolIncluded?: string[];
	toolExcluded?: string[];
	toolBlockTokens?: number;
	originalToolBlockTokens?: number;
}
