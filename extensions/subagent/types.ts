/**
 * Shared types for the subagent extension. Extracted from `index.ts` purely
 * to bound that file's size — no behaviour changes.
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentScope } from "./agents.js";
import type { TaskScores } from "./model-selection.js";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const COLLAPSED_ITEM_COUNT = 10;
export const MAX_MODEL_RETRIES = 5;
/** Max characters shown when previewing a task description in chain/parallel renderCall. */
export const TASK_PREVIEW_SHORT = 40;
/** Max characters shown when previewing a task description in single-mode renderCall. */
export const TASK_PREVIEW_LONG = 60;
/** Max characters shown for parallel result summaries. */
export const PARALLEL_SUMMARY_PREVIEW = 100;
export const AGENT_SCOPE_VALUES = new Set<AgentScope>(["user", "project", "both"]);

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	/** The model the subagent session actually ran with. */
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	/** Streaming text accumulated from in-progress assistant turn, available while running. */
	streamingText?: string;
	step?: number;
	/** Tool names currently executing in this subagent (cleared when tool finishes). */
	runningTools?: string[];
	/** The model actually chosen by scored selection. */
	selectedModel?: string;
	/** Thinking level applied to this run. */
	thinkingLevel?: string;
	/** Merged scores used for selection (after merge of defaults + caller overrides). */
	taskScores?: TaskScores;
	/** Raw scores the calling agent provided (before merge with defaults). */
	callerScores?: TaskScores;
	/** Agent's frontmatter default scores. */
	agentDefaultScores?: TaskScores;
	/** The top-K models that were candidates. */
	selectionPool?: string[];
	/** Dot product scores for the pool (parallel arrays with selectionPool). */
	selectionFitScores?: number[];
	/** Model that failed before this result was retried with a different model. */
	failedModel?: string;
	/** How many fallback attempts were made before this result (0 = first try). */
	retryCount?: number;
	/** Diagnostic when a requested model could not be resolved and execution fell back. */
	modelResolutionDiagnostic?: string;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, any> };

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;
