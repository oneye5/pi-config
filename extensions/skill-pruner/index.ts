import path from "node:path";
import { randomUUID } from "node:crypto";
import { formatSkillsForPrompt } from "@mariozechner/pi-coding-agent";
import type {
	Skill,
	ExtensionAPI,
	BeforeAgentStartEvent,
	ToolCallEvent,
	InputEvent,
	ToolInfo,
} from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { DEFAULT_CONFIG, loadConfig } from "./config.js";
import { applyThreshold, applyToolThreshold, scoreSkills, scoreTools } from "./scorer.js";
import { appendDecision, estimateTokens, recordKnownSkills, recordSkillRead } from "./logger.js";
import type { PruningConfig, PruningDecision, PruningResult, ScoredTool, SkillScoreCacheEntry } from "./types.js";

/** Root of the pi-config repo, resolved from this extension's known position. */
const CONFIG_ROOT = path.resolve(import.meta.dirname, "..", "..");

const SKILLS_BLOCK_RE = /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/;
const PROCESS_SESSION_ID = randomUUID();

let config: PruningConfig | null = null;
const skillCache = new Map<string, SkillScoreCacheEntry>();
let formatSkillsForPromptImpl: (skills: Skill[]) => string = formatSkillsForPrompt;
/** Test seam: overrides getAllTools / getActiveTools / setActiveTools. */
let getAllToolsOverride: (() => ToolInfo[]) | null = null;
let getActiveToolsOverride: (() => string[]) | null = null;
let setActiveToolsOverride: ((names: string[]) => void) | null = null;

/** Facade for pi API methods used for tool introspection. Captured from pi in the factory closure. */
let piApi: {
	getAllTools: () => ToolInfo[];
	getActiveTools: () => string[];
	setActiveTools: (names: string[]) => void;
} | null = null;

/** Returns the pi API facade, falling back to no-ops when pi hasn't been initialized. */
function getPiToolSeams(): { getAllTools: () => ToolInfo[]; getActiveTools: () => string[]; setActiveTools: (names: string[]) => void } {
	return piApi ?? {
		getAllTools: () => [],
		getActiveTools: () => [],
		setActiveTools: () => {},
	};
}

export default function (pi: ExtensionAPI) {
	// Capture pi API methods for tool introspection (available throughout the session).
	piApi = {
		getAllTools: () => pi.getAllTools(),
		getActiveTools: () => pi.getActiveTools(),
		setActiveTools: (names) => pi.setActiveTools(names),
	};

	// --- Message renderer for pruning-result custom type ---
	pi.registerMessageRenderer("pruning-result", (message, { expanded }, theme) => {
		const details = message.details as PruningResult | undefined;
		if (!details) {
			const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
			box.addChild(new Text(String(message.content), 0, 0));
			return box;
		}

		const mode = details.mode === "shadow" ? "shadow" : details.mode;
		const modeLabel = theme.fg("dim", mode === "shadow" ? "[shadow] " : "");
		const skillSummary = details.excludedSkills.length > 0
			? `Kept ${details.includedSkills.length}/${details.includedSkills.length + details.excludedSkills.length} skills`
			: "All skills included";
		const toolSummary = details.excludedTools.length > 0
			? `Kept ${details.includedTools.length}/${details.includedTools.length + details.excludedTools.length} tools`
			: "";
		const parts = [skillSummary, toolSummary].filter(Boolean);
		const tokenNote = details.skillTokensSaved + details.toolTokensSaved > 0
			? ` · Saved ~${details.skillTokensSaved + details.toolTokensSaved} tokens`
			: "";

		if (!expanded) {
			const compact = `${modeLabel}Pruned: ${parts.join(", ")}${tokenNote}`;
			const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
			box.addChild(new Text(compact, 0, 0));
			return box;
		}

		// Expanded view
		const lines: string[] = [];
		if (details.excludedSkills.length > 0) {
			lines.push(theme.fg("success", `  Skills kept: ${details.includedSkills.join(", ")}`));
			lines.push(theme.fg("dim", `  Skills pruned: ${details.excludedSkills.join(", ")}`));
		}
		if (details.excludedTools.length > 0) {
			lines.push(theme.fg("success", `  Tools kept: ${details.includedTools.join(", ")}`));
			lines.push(theme.fg("dim", `  Tools pruned: ${details.excludedTools.join(", ")}`));
		}
		if (tokenNote) {
			lines.push(theme.fg("accent", `  ${tokenNote.trim()}`));
		}

		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(`${modeLabel}Pruning Results\n${lines.join("\n")}`, 0, 0));
		return box;
	});

	// --- request_tool: recovery tool for pruned tools ---
	pi.registerTool({
		name: "request_tool",
		label: "Request Tool",
		description: "Request a tool that was pruned from the current session. Use when you need a tool that is not currently available. The tool will be enabled for the remainder of the session.",
		parameters: {
			type: "object",
			properties: {
				toolName: {
					type: "string",
					description: "The name of the tool to enable (e.g. 'web_search', 'fetch_content')",
				},
			},
			required: ["toolName"],
		},
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const toolName = params.toolName as string;
			const allTools = getAllToolsOverride
				? getAllToolsOverride()
				: getPiToolSeams().getAllTools();
			const activeTools = getActiveToolsOverride
				? getActiveToolsOverride()
				: getPiToolSeams().getActiveTools();

			const knownNames = new Set(allTools.map((t) => t.name));
			if (!knownNames.has(toolName)) {
				return { content: [{ type: "text" as const, text: `Unknown tool '${toolName}'. Available tools: ${[...knownNames].sort().join(", ")}` }], isError: true };
			}
			if (activeTools.includes(toolName)) {
				return { content: [{ type: "text" as const, text: `Tool '${toolName}' is already active.` }] };
			}

			const newActiveTools = [...activeTools, toolName];
			if (setActiveToolsOverride) {
				setActiveToolsOverride(newActiveTools);
			} else {
				getPiToolSeams().setActiveTools(newActiveTools);
			}

			return { content: [{ type: "text" as const, text: `Tool '${toolName}' has been enabled and is now available.` }] };
		},
	});

	// --- before_agent_start: skill + tool pruning ---
	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const activeConfig = getConfig();
		const sessionId = getSessionId(ctx);
		const skills = event.systemPromptOptions.skills ?? [];
		const allSkillPaths = skills.map((s) => s.filePath);

		// --- Off mode: no pruning, but still log skill reads ---
		if (activeConfig.mode === "off") {
			recordKnownSkills(sessionId, "off", allSkillPaths, [], []);
			// Still log tool state baseline even in off mode
			if (activeConfig.tools) {
				const allTools = getAllToolsOverride
					? getAllToolsOverride()
					: getPiToolSeams().getAllTools();
				const toolDecision = buildToolDecision({
					sessionId,
					mode: "off",
					allTools,
					includedTools: allTools.map((t) => t.name),
					excludedTools: [],
					config: activeConfig,
				});
				appendDecision(toolDecision);
			}
			return undefined;
		}

		// --- Skill pruning ---
		let modifiedSystemPrompt = event.systemPrompt;
		let skillPruningRan = false;
		let skillResult: SkillPruningResult | null = null;

		if (skills.length > 0) {
			// Exclude disabled skills from scoring/threshold — they never consume floor/ceiling slots.
			const visibleSkills = skills.filter((s) => !s.disableModelInvocation);
			const disabledNames = new Set(
				skills.filter((s) => s.disableModelInvocation).map((s) => s.name),
			);

			// Pinned names that resolve to a disabled skill → warn + skip.
			const effectivePinned = activeConfig.skills.pinned.filter((name) => {
				if (disabledNames.has(name)) {
					console.warn(`[skill-pruner] pinned skill '${name}' is disabled (disableModelInvocation); skipping`);
					return false;
				}
				return true;
			});

			const contextFile = event.systemPromptOptions.contextFiles?.[0];
			const scored = scoreSkills(event.prompt, contextFile?.content ?? "", visibleSkills, activeConfig, skillCache);
			const thresholded = applyThreshold(scored, effectivePinned, activeConfig);
			const includedSkills = thresholded.included.map((scoredSkill) => scoredSkill.skill);
			const newBlock = formatSkillsForPromptImpl(includedSkills);
			const hint = buildHint(thresholded.excluded.map((skill) => skill.name));
			const replacement = buildReplacement(newBlock, hint);
			const match = event.systemPrompt.match(SKILLS_BLOCK_RE);

			if (!match) {
				console.warn("[skill-pruner] skills block not found in system prompt; skipping pruning");
				recordKnownSkills(sessionId, activeConfig.mode, allSkillPaths, [], []);
				skillResult = null;
			} else {
				const skillModified = event.systemPrompt.replace(SKILLS_BLOCK_RE, replacement);
				const decision = buildDecision({
					sessionId,
					mode: activeConfig.mode,
					query: event.prompt,
					contextFilePath: contextFile?.path,
					scored,
					included: thresholded.included,
					excluded: thresholded.excluded,
					newBlock: replacement,
					originalBlock: match[0],
					pinned: effectivePinned,
				});
				appendDecision(decision);

				skillResult = {
					included: thresholded.included.map((s) => s.name),
					excluded: thresholded.excluded.map((s) => s.name),
					tokensSaved: estimateTokens(match[0]) - estimateTokens(replacement),
				};

				if (activeConfig.mode === "shadow") {
					recordKnownSkills(sessionId, "shadow", allSkillPaths, [], thresholded.excluded.map((skill) => skill.skill.filePath));
					modifiedSystemPrompt = event.systemPrompt; // shadow: don't modify
				} else {
					recordKnownSkills(sessionId, "auto", allSkillPaths, thresholded.excluded.map((skill) => skill.skill.filePath), []);
					modifiedSystemPrompt = skillModified;
					skillPruningRan = true;
				}
			}
		} else {
			recordKnownSkills(sessionId, activeConfig.mode, allSkillPaths, [], []);
		}

		// --- Tool pruning ---
		let toolResult: ToolPruningResult | null = null;

		if (activeConfig.tools) {
			const allTools = getAllToolsOverride
				? getAllToolsOverride()
				: getPiToolSeams().getAllTools();
			const contextFile = event.systemPromptOptions.contextFiles?.[0];

			if (allTools.length > 0) {
				const scoredTools = scoreTools(event.prompt, contextFile?.content ?? "", allTools, activeConfig.tools);
				const currentActive = getActiveToolsOverride
					? getActiveToolsOverride()
					: getPiToolSeams().getActiveTools();
				const toolThreshold = applyToolThreshold(scoredTools, currentActive, activeConfig.tools);

				const toolTokensSaved = estimateToolTokens(allTools, toolThreshold.excluded);

				if (activeConfig.mode === "auto") {
					if (setActiveToolsOverride) {
						setActiveToolsOverride(toolThreshold.included);
					} else {
						getPiToolSeams().setActiveTools(toolThreshold.included);
					}
				}

				toolResult = {
					included: toolThreshold.included,
					excluded: toolThreshold.excluded,
					tokensSaved: toolTokensSaved,
				};

				const toolDecision = buildToolDecision({
					sessionId,
					mode: activeConfig.mode,
					allTools,
					includedTools: toolThreshold.included,
					excludedTools: toolThreshold.excluded,
					config: activeConfig,
				});
				appendDecision(toolDecision);
			}
		}

		// --- Build and send UI feedback message ---
		// Use pi.sendMessage() to inject the message into the TUI chat history,
		// not the before_agent_start return 'message' field (which only adds to LLM context).
		const feedbackMessage = buildFeedbackMessage(skillResult, toolResult, activeConfig.mode);
		if (feedbackMessage) {
			pi.sendMessage(feedbackMessage);
		}

		if (activeConfig.mode === "shadow") {
			// Shadow mode: don't modify prompt or tools, but still log
			return { systemPrompt: event.systemPrompt };
		}

		if (skillPruningRan) {
			return { systemPrompt: modifiedSystemPrompt };
		}
		return undefined;
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
		try {
			if (event.toolName !== "read") {
				return undefined;
			}

			const readPath = typeof event.input?.path === "string" ? event.input.path : undefined;
			if (readPath !== undefined) {
				recordSkillRead(getSessionId(ctx), readPath);
			}
		} catch (error) {
			console.warn(`[skill-pruner] failed to record skill read: ${error instanceof Error ? error.message : String(error)}`);
		}
		return undefined;
	});

	pi.on("input", async (_event: InputEvent) => ({ action: "continue" as const }));
}

// --- Internal types for result accumulation ---

interface SkillPruningResult {
	included: string[];
	excluded: string[];
	tokensSaved: number;
}

interface ToolPruningResult {
	included: string[];
	excluded: string[];
	tokensSaved: number;
}

// --- Helper functions ---

function getConfig(): PruningConfig {
	if (!config) {
		config = loadConfig(path.join(CONFIG_ROOT, "settings.json"));
	}
	return config;
}

function getSessionId(ctx: unknown): string {
	// ExtensionContext has sessionManager.getSessionId(), not sessionId directly.
	const ctxObj = ctx as Record<string, unknown>;
	const sessionManager = ctxObj?.sessionManager as { getSessionId?: () => string } | undefined;
	const sessionId = sessionManager?.getSessionId?.();
	return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : PROCESS_SESSION_ID;
}

/** internal: test seam — overrides the SKILLS block formatter. */
export function __setFormatter(fn: ((skills: Skill[]) => string) | null): void {
	formatSkillsForPromptImpl = fn ?? formatSkillsForPrompt;
}

function buildHint(excludedNames: string[]): string {
	if (excludedNames.length === 0) {
		return "";
	}
	return `<!-- Pruned skills (not shown to save attention): ${excludedNames.join(", ")}. Use /skill:name to load one. -->`;
}

function buildReplacement(newBlock: string, hint: string): string {
	const stripped = newBlock.replace(/^\n\n/, "");
	if (hint === "") {
		return `\n\n${stripped}`;
	}
	return `\n\n${stripped}\n${hint}`;
}

function buildDecision(input: {
	sessionId: string;
	mode: PruningConfig["mode"];
	query: string;
	contextFilePath?: string;
	scored: ReturnType<typeof scoreSkills>;
	included: ReturnType<typeof applyThreshold>["included"];
	excluded: ReturnType<typeof applyThreshold>["excluded"];
	newBlock: string;
	originalBlock: string;
	pinned: string[];
}): PruningDecision {
	const includedNames = new Set(input.included.map((skill) => skill.name));
	const pinnedNames = new Set(input.included.filter((skill) => skill.pinned).map((skill) => skill.name));
	return {
		timestamp: new Date().toISOString(),
		sessionId: input.sessionId,
		mode: input.mode,
		query: input.query,
		contextFile: input.contextFilePath,
		candidates: input.scored.map((skill) => ({
			name: skill.name,
			triggerScore: skill.triggerScore,
			keywordScore: skill.keywordScore,
			nameScore: skill.nameScore,
			compositeScore: skill.compositeScore,
			included: includedNames.has(skill.name),
			pinned: pinnedNames.has(skill.name) || undefined,
		})),
		pinned: input.pinned,
		included: input.included.map((skill) => skill.name),
		excluded: input.excluded.map((skill) => skill.name),
		skillBlockTokens: estimateTokens(input.newBlock),
		originalBlockTokens: estimateTokens(input.originalBlock),
	};
}

function buildToolDecision(input: {
	sessionId: string;
	mode: PruningConfig["mode"];
	allTools: ToolInfo[];
	includedTools: string[];
	excludedTools: string[];
	config: PruningConfig;
}): PruningDecision {
	const includedSet = new Set(input.includedTools);
	return {
		timestamp: new Date().toISOString(),
		sessionId: input.sessionId,
		mode: input.mode,
		query: "",
		candidates: [],
		pinned: [],
		included: [],
		excluded: [],
		skillBlockTokens: 0,
		originalBlockTokens: 0,
		toolCandidates: input.allTools.map((t) => {
			const tier = input.config.tools?.tiers[t.name] ?? "contextual";
			return {
				name: t.name,
				tier: tier as "core" | "contextual" | "rare",
				keywordScore: 0,
				nameScore: 0,
				compositeScore: 0,
				included: includedSet.has(t.name),
			};
		}),
		toolIncluded: input.includedTools,
		toolExcluded: input.excludedTools,
		toolBlockTokens: 0,
		originalToolBlockTokens: 0,
	};
}

/** Estimate tokens saved by excluding tools from the system prompt. */
function estimateToolTokens(allTools: ToolInfo[], excludedToolNames: string[]): number {
	const excludedSet = new Set(excludedToolNames);
	let chars = 0;
	for (const tool of allTools) {
		if (excludedSet.has(tool.name)) {
			// Rough estimate: name + description + parameter schema
			chars += tool.name.length + tool.description.length + 50;
		}
	}
	return Math.ceil(chars / 4);
}

function buildFeedbackMessage(
	skillResult: SkillPruningResult | null,
	toolResult: ToolPruningResult | null,
	mode: PruningConfig["mode"],
): Pick<PruningResult, "customType" | "content" | "display" | "details"> | null {
	const hasSkillPruning = skillResult && skillResult.excluded.length > 0;
	const hasToolPruning = toolResult && toolResult.excluded.length > 0;

	if (!hasSkillPruning && !hasToolPruning) {
		return null;
	}

	const parts: string[] = [];
	const details: PruningResult = {
		includedSkills: skillResult?.included ?? [],
		excludedSkills: skillResult?.excluded ?? [],
		includedTools: toolResult?.included ?? [],
		excludedTools: toolResult?.excluded ?? [],
		mode,
		skillTokensSaved: skillResult?.tokensSaved ?? 0,
		toolTokensSaved: toolResult?.tokensSaved ?? 0,
	};

	if (hasSkillPruning) {
		parts.push(`Kept ${skillResult!.included.length}/${skillResult!.included.length + skillResult!.excluded.length} skills`);
	}
	if (hasToolPruning) {
		parts.push(`Kept ${toolResult!.included.length}/${toolResult!.included.length + toolResult!.excluded.length} tools`);
	}

	const tokensSaved = details.skillTokensSaved + details.toolTokensSaved;
	const tokenNote = tokensSaved > 0 ? ` · Saved ~${tokensSaved} tokens` : "";

	const content = `Pruned: ${parts.join(", ")}${tokenNote}`;

	return {
		customType: "pruning-result",
		content,
		display: true,
		details,
	};
}

export function setConfigForTesting(nextConfig: PruningConfig | null): void {
	config = nextConfig ? {
		mode: nextConfig.mode,
		skills: { ...nextConfig.skills, pinned: [...nextConfig.skills.pinned] },
		tools: nextConfig.tools ? {
			tiers: { ...nextConfig.tools.tiers },
			dependencies: Object.fromEntries(Object.entries(nextConfig.tools.dependencies).map(([k, v]) => [k, [...v]])),
			ceiling: nextConfig.tools.ceiling,
		} : undefined,
	} : null;
}

export function resetForTesting(): void {
	config = { mode: DEFAULT_CONFIG.mode, skills: { ...DEFAULT_CONFIG.skills, pinned: [] }, tools: DEFAULT_CONFIG.tools };
	skillCache.clear();
	formatSkillsForPromptImpl = formatSkillsForPrompt;
	getAllToolsOverride = null;
	getActiveToolsOverride = null;
	setActiveToolsOverride = null;
	piApi = null;
}

/** Test seam: override tool introspection methods. */
export function __setToolSeams(opts: {
	getAllTools?: (() => ToolInfo[]) | null;
	getActiveTools?: (() => string[]) | null;
	setActiveTools?: ((names: string[]) => void) | null;
}): void {
	getAllToolsOverride = opts.getAllTools ?? null;
	getActiveToolsOverride = opts.getActiveTools ?? null;
	setActiveToolsOverride = opts.setActiveTools ?? null;
}

export { SKILLS_BLOCK_RE };
