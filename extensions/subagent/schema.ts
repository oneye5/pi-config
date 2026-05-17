/**
 * Typebox parameter schema for the subagent tool. Extracted from `index.ts` —
 * behaviour-preserving.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const TASK_SCORE_GUIDANCE = "Optional model-selection hints. Most tasks are 2s and 3s — score the intrinsic difficulty of the work, not its importance. 1 = trivial/mechanical (rename, typo fix); 2 = routine (omit to default here); 3 = standard professional work (most real tasks); 4 = genuinely complex or high-risk (multi-system reasoning, subtle correctness constraints); 5 = exceptional — reserve for problems that would challenge a senior engineer (novel algorithms, deep cross-cutting analysis). When in doubt, round down. Reasoning is special: omit/2 requests low thinking; use 0 for direct/shallow work.";

const TaskScoresSchema = Type.Object({
	precision: Type.Optional(Type.Integer({
		minimum: 0,
		maximum: 5,
		description: "Correctness bar (1=best-effort/disposable, 2=routine, 3=should be correct, 4=must be right — subtle edge cases matter, 5=zero-tolerance — safety-critical or cryptographic-level). Most code is 2-3",
	})),
	creativity: Type.Optional(Type.Integer({
		minimum: 0,
		maximum: 5,
		description: "Novelty needed (1=pure boilerplate, 2=follow existing patterns, 3=adapt/combine known patterns, 4=design something new under real ambiguity, 5=genuinely novel — no existing pattern applies). Most code is 2-3",
	})),
	thoroughness: Type.Optional(Type.Integer({
		minimum: 0,
		maximum: 5,
		description: "Coverage needed (1=single spot check, 2=happy path, 3=normal edge cases, 4=multi-file or cross-cutting concerns, 5=exhaustive — must find every issue). Most tasks are 2-3",
	})),
	reasoning: Type.Optional(Type.Integer({
		minimum: 0,
		maximum: 5,
		description: "Deduction depth (0=direct lookup/copy, 1=single-step, 2=straightforward logic, 3=multi-step reasoning, 4=deep chains or tricky invariants, 5=frontier-hard — proofs, novel architecture). Most tasks are 0-3. Omit only if low thinking is intended",
	})),
}, {
	description: TASK_SCORE_GUIDANCE,
});

const TaskItem = Type.Object({
	agent: Type.String({
		description:
			'Exact agent name to invoke. This is not agentScope; do not pass "user", "project", or "both" unless those are real agent names.',
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	taskScores: Type.Optional(TaskScoresSchema),
});

const ChainItem = Type.Object({
	agent: Type.String({
		description:
			'Exact agent name to invoke. This is not agentScope; do not pass "user", "project", or "both" unless those are real agent names.',
	}),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	taskScores: Type.Optional(TaskScoresSchema),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description:
		'Which agent directories to search. This is separate from the agent field. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

export const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description:
				'Exact agent name to invoke for single mode. This is not agentScope; do not pass "user", "project", or "both" unless those are real agent names.',
		}),
	),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	taskScores: Type.Optional(TaskScoresSchema),
});
