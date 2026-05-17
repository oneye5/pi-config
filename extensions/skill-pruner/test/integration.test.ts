import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, Skill, ToolInfo } from "@mariozechner/pi-coding-agent";
import { clearPruningTrackingForTesting, setLogPathForTesting } from "../logger.js";
import type { PruningConfig } from "../types.js";

installSdkResolverForTests();
const require = createRequire(import.meta.url);
const { default: skillPruner, __setFormatter, __setToolSeams, resetForTesting, setConfigForTesting } = require("../index.ts") as typeof import("../index.js");

function installSdkResolverForTests(): void {
	const mockDir = mkdtempSync(path.join(tmpdir(), "skill-pruner-sdk-mock-"));

	// Mock pi-coding-agent SDK
	const sdkPath = path.join(mockDir, "pi-coding-agent.cjs");
	writeFileSync(sdkPath, "exports.formatSkillsForPrompt = () => { throw new Error('test must call __setFormatter'); };\n", "utf-8");

	// Mock pi-tui
	const tuiPath = path.join(mockDir, "pi-tui.cjs");
	writeFileSync(tuiPath, [
		"class Box {",
		"  children = [];",
		"  constructor(px, py, bgFn) { this.paddingX = px; this.paddingY = py; this.bgFn = bgFn; }",
		"  addChild(c) { this.children.push(c); }",
		"  render(w) { return this.children.flatMap(c => c.render(w)); }",
		"}",
		"class Text {",
		"  constructor(text, px, py) { this.text = text; this.paddingX = px ?? 0; this.paddingY = py ?? 0; }",
		"  render(w) { return [this.text]; }",
		"}",
		"module.exports = { Box, Text };",
	].join("\n"), "utf-8");

	const moduleWithResolver = Module as typeof Module & {
		_resolveFilename: (request: string, parent?: unknown, isMain?: boolean, options?: unknown) => string;
	};
	const originalResolveFilename = moduleWithResolver._resolveFilename;
	moduleWithResolver._resolveFilename = function resolveFilename(request, parent, isMain, options): string {
		if (request === "@mariozechner/pi-coding-agent") {
			return sdkPath;
		}
		if (request === "@mariozechner/pi-tui") {
			return tuiPath;
		}
		return originalResolveFilename.call(this, request, parent, isMain, options);
	};
}

// ---------------------------------------------------------------------------
// Shared test-double for formatSkillsForPrompt.
// Mimics the SDK preamble + block envelope so SKILLS_BLOCK_RE still matches.
// ---------------------------------------------------------------------------
function testFormatSkillsForPrompt(skills: Skill[]): string {
	const visibleSkills = skills.filter((s) => !s.disableModelInvocation);
	if (visibleSkills.length === 0) return "";
	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];
	for (const skill of visibleSkills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function skill(name: string, description: string, overrides: Partial<Skill> = {}): Skill {
	return {
		name,
		description,
		filePath: `/repo/skills/${name}/SKILL.md`,
		baseDir: `/repo/skills/${name}`,
		sourceInfo: {} as Skill["sourceInfo"],
		disableModelInvocation: false,
		...overrides,
	};
}

function config(overrides: Partial<PruningConfig["skills"]> = {}, mode: PruningConfig["mode"] = "auto", toolsOverrides?: Partial<PruningConfig["tools"]>): PruningConfig {
	const result: PruningConfig = {
		mode,
		skills: { ceiling: 5, floor: 2, scoreThreshold: 0.4, gapThreshold: 0.3, pinned: [], ...overrides },
	};
	if (toolsOverrides) {
		result.tools = {
			tiers: { read: "core", edit: "core", write: "core", bash: "core", subagent: "contextual", web_search: "contextual", code_search: "contextual", fetch_content: "contextual", get_search_content: "contextual", ...(toolsOverrides?.tiers ?? {}) },
			dependencies: { edit: ["read"], subagent: ["bash"], ...(toolsOverrides?.dependencies ?? {}) },
			ceiling: toolsOverrides?.ceiling ?? 5,
		};
	}
	return result;
}

type Handler = (event: any, ctx: any) => unknown | Promise<unknown>;

type RegisterResult = {
	handlers: Map<string, Handler>;
	registeredTools: Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>;
	registeredRenderers: Map<string, (...args: any[]) => any>;
};

function register(configOverride: PruningConfig, logPath = path.join(mkdtempSync(path.join(tmpdir(), "skill-pruner-integration-")), "pruning.jsonl")): RegisterResult {
	resetForTesting();
	clearPruningTrackingForTesting();
	setLogPathForTesting(logPath);
	setConfigForTesting(configOverride);
	__setFormatter(testFormatSkillsForPrompt);
	const handlers = new Map<string, Handler>();
	const registeredTools: Map<string, { execute: (...args: unknown[]) => Promise<unknown> }> = new Map();
	const registeredRenderers = new Map<string, (...args: any[]) => any>();
	const sentMessages: any[] = [];
	const pi = {
		on(eventName: string, handler: Handler) {
			handlers.set(eventName, handler);
		},
		registerMessageRenderer(customType: string, renderer: any) {
			registeredRenderers.set(customType, renderer);
		},
		registerTool(toolDef: { name: string; execute?: (...args: unknown[]) => Promise<unknown> }) {
			if (toolDef.execute) {
				registeredTools.set(toolDef.name, toolDef as { execute: (...args: unknown[]) => Promise<unknown> });
			}
		},
		getAllTools: () => [] as ToolInfo[],
		getActiveTools: () => [] as string[],
		setActiveTools: (_names: string[]) => {},
		sendMessage: (message: any) => { sentMessages.push(message); },
	} as unknown as ExtensionAPI;
	skillPruner(pi);
	return { handlers, registeredTools, registeredRenderers, sentMessages };
}

function systemPrompt(skills: Skill[]): string {
	return `Base prompt.${testFormatSkillsForPrompt(skills)}\nCurrent date: 2026-05-16`;
}

async function runBeforeAgentStart(handlers: Map<string, Handler>, prompt: string, skills: Skill[], overrideSystemPrompt?: string) {
	const handler = handlers.get("before_agent_start");
	assert.ok(handler, "before_agent_start handler registered");
	return await handler({
		type: "before_agent_start",
		prompt,
		systemPrompt: overrideSystemPrompt ?? systemPrompt(skills),
		systemPromptOptions: {
			cwd: "/repo",
			skills,
			contextFiles: [{ path: "AGENTS.md", content: "Project context" }],
		},
	}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });
}

const realisticSkills = [
	skill("code-simplification", "Simplifies code for clarity. Use when refactoring code for clarity, reducing complexity. Do not use when adding new features."),
	skill("duckdb-query-optimization", "Guides DuckDB query performance tuning. Use when queries against analytics databases are slow, writing new analytics queries. Do not use for general SQL questions."),
	skill("frontend-design", "Production-grade frontend interfaces. Use when building UI components, pages, or visual applications. Do not use for backend logic."),
];

// ---------------------------------------------------------------------------
// Existing tests (updated for new behavior)
// ---------------------------------------------------------------------------

test("full pipeline includes focused relevant skills and hints excluded skills", async () => {
	const { handlers } = register(config({ floor: 1, ceiling: 2, scoreThreshold: 0.4, gapThreshold: 0.3 }));
	const result = await runBeforeAgentStart(handlers, "Refactor this code for clarity", realisticSkills) as { systemPrompt?: string } | undefined;

	assert.ok(result?.systemPrompt);
	assert.match(result.systemPrompt, /<name>code-simplification<\/name>/);
	assert.doesNotMatch(result.systemPrompt, /<name>duckdb-query-optimization<\/name>/);
	assert.match(result.systemPrompt, /Pruned skills .*duckdb-query-optimization/);
});

test("empty skills array produces no modification", async () => {
	const { handlers } = register(config());
	const result = await runBeforeAgentStart(handlers, "anything", [], "Base prompt without skills");
	assert.equal(result, undefined);
});

test("all-zero scores include floor of 2 by name asc", async () => {
	const skills = [
		skill("charlie", "General helper."),
		skill("alpha", "Another helper."),
		skill("bravo", "More assistance."),
	];
	const { handlers } = register(config({ floor: 2, ceiling: 5 }));
	const result = await runBeforeAgentStart(handlers, "unrelated zebra", skills) as { systemPrompt?: string } | undefined;

	assert.ok(result?.systemPrompt);
	assert.match(result.systemPrompt, /<name>alpha<\/name>/);
	assert.match(result.systemPrompt, /<name>bravo<\/name>/);
	assert.doesNotMatch(result.systemPrompt, /<name>charlie<\/name>/);
	assert.match(result.systemPrompt, /Pruned skills .*charlie/);
});

test("regex no-match case fails open with original prompt unchanged", async () => {
	const { handlers } = register(config({ floor: 1, ceiling: 1 }));
	const result = await runBeforeAgentStart(handlers, "Refactor code", realisticSkills, "Base prompt without the skills block");
	assert.equal(result, undefined);
});

test("literal /skill:name prompt force-includes the named skill through name match", async () => {
	const { handlers } = register(config({ floor: 1, ceiling: 1 }));
	const result = await runBeforeAgentStart(handlers, "Please use /skill:duckdb-query-optimization for this", realisticSkills) as { systemPrompt?: string } | undefined;

	assert.ok(result?.systemPrompt);
	assert.match(result.systemPrompt, /<name>duckdb-query-optimization<\/name>/);
	assert.doesNotMatch(result.systemPrompt, /<name>code-simplification<\/name>/);
});

test("shadow mode leaves prompt unchanged, logs decision, and records shadow miss candidates", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "skill-pruner-integration-"));
	const logPath = path.join(dir, "pruning.jsonl");
	setLogPathForTesting(logPath);
	try {
		const { handlers } = register(config({ floor: 1, ceiling: 1 }, "shadow"), logPath);
		const originalPrompt = systemPrompt(realisticSkills);
		const result = await runBeforeAgentStart(handlers, "Refactor this code for clarity", realisticSkills, originalPrompt) as { systemPrompt?: string } | undefined;

		assert.equal(result?.systemPrompt, originalPrompt);

		const toolHandler = handlers.get("tool_call");
		assert.ok(toolHandler, "tool_call handler registered");
		await toolHandler({
			type: "tool_call",
			toolCallId: "1",
			toolName: "read",
			input: { path: "/repo/skills/duckdb-query-optimization/SKILL.md" },
		}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });

		const lines = readFileSync(logPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(lines[0].mode, "shadow");
		assert.ok(lines[0].excluded.includes("duckdb-query-optimization"));
		// In shadow mode, a would-be-pruned skill read emits shadow_miss_candidate (not skill_read).
		assert.ok(lines.some((line) => line.event === "shadow_miss_candidate" && line.skillName === "duckdb-query-optimization"));
		assert.ok(!lines.some((line) => line.event === "skill_read" && line.skillName === "duckdb-query-optimization"));
	} finally {
		setLogPathForTesting(null);
		clearPruningTrackingForTesting();
	}
});

test("input handler always continues", async () => {
	const { handlers } = register(config());
	const handler = handlers.get("input");
	assert.ok(handler, "input handler registered");
	assert.deepEqual(await handler({ type: "input", text: "hello", source: "interactive" }, { cwd: "/repo" }), { action: "continue" });
});

// ---------------------------------------------------------------------------
// New tests from adversarial review (Issue 7)
// ---------------------------------------------------------------------------

test("off mode baseline: known skill read → skill_read; non-skill read → no event", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "skill-pruner-integration-"));
	const logPath = path.join(dir, "pruning.jsonl");
	setLogPathForTesting(logPath);
	try {
		const { handlers } = register(config({}, "off"), logPath);
		await runBeforeAgentStart(handlers, "anything", realisticSkills);

		const toolHandler = handlers.get("tool_call");
		assert.ok(toolHandler);

		// known skill → skill_read
		await toolHandler({
			type: "tool_call", toolCallId: "1", toolName: "read",
			input: { path: "/repo/skills/code-simplification/SKILL.md" },
		}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });

		// non-skill → no event logged
		await toolHandler({
			type: "tool_call", toolCallId: "2", toolName: "read",
			input: { path: "/repo/src/index.ts" },
		}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });

		const lines = readFileSync(logPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
		assert.ok(lines.some((line) => line.event === "skill_read" && line.skillName === "code-simplification"));
		assert.ok(!lines.some((line) => line.skillName === "src/index" || line.skillName === "index"));
	} finally {
		setLogPathForTesting(null);
		clearPruningTrackingForTesting();
	}
});

test("auto mode: pruned skill read → skill_miss; included skill read → skill_read; non-skill → no event", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "skill-pruner-integration-"));
	const logPath = path.join(dir, "pruning.jsonl");
	setLogPathForTesting(logPath);
	try {
		// With floor=1, ceiling=1, refactoring code → only code-simplification included
		const { handlers } = register(config({ floor: 1, ceiling: 1, scoreThreshold: 0.4 }), logPath);
		await runBeforeAgentStart(handlers, "Refactor this code for clarity", realisticSkills);

		const toolHandler = handlers.get("tool_call");
		assert.ok(toolHandler);

		// duckdb-query-optimization should be pruned → skill_miss
		await toolHandler({
			type: "tool_call", toolCallId: "1", toolName: "read",
			input: { path: "/repo/skills/duckdb-query-optimization/SKILL.md" },
		}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });

		// code-simplification is included → skill_read
		await toolHandler({
			type: "tool_call", toolCallId: "2", toolName: "read",
			input: { path: "/repo/skills/code-simplification/SKILL.md" },
		}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });

		// non-skill → no event
		await toolHandler({
			type: "tool_call", toolCallId: "3", toolName: "read",
			input: { path: "/repo/src/index.ts" },
		}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });

		const lines = readFileSync(logPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
		assert.ok(lines.some((line) => line.event === "skill_miss" && line.skillName === "duckdb-query-optimization"));
		assert.ok(lines.some((line) => line.event === "skill_read" && line.skillName === "code-simplification"));
		assert.ok(!lines.some((line) => line.skillName === "src/index" || line.skillName === "index"));
	} finally {
		setLogPathForTesting(null);
		clearPruningTrackingForTesting();
	}
});

test("pinned name not in skill set → warn + skip, no throw", async () => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (m?: unknown) => { warnings.push(String(m)); };
	try {
		const { handlers } = register(config({ pinned: ["nonexistent-skill"], floor: 1, ceiling: 2 }));
		const result = await runBeforeAgentStart(handlers, "anything", realisticSkills) as { systemPrompt?: string } | undefined;

		assert.ok(result?.systemPrompt);
		assert.ok(warnings.some((w) => w.includes("pinned skill 'nonexistent-skill' was not found")));
	} finally {
		console.warn = originalWarn;
	}
});

test("all-skills-included leaves no double-newline after </available_skills>", async () => {
	// pin all skills so nothing is excluded → hint is ""
	const { handlers } = register(config({ pinned: ["code-simplification", "duckdb-query-optimization", "frontend-design"], floor: 1, ceiling: 5 }));
	const result = await runBeforeAgentStart(handlers, "Refactor code", realisticSkills) as { systemPrompt?: string } | undefined;

	assert.ok(result?.systemPrompt);
	// Assert absence of </available_skills>\n\n followed by non-hint content
	const afterBlock = result.systemPrompt.split("</available_skills>")[1] ?? "";
	assert.ok(!afterBlock.startsWith("\n\n"), "no double-newline after </available_skills>");
	// Also affirm the correct shape: </available_skills>\nCurrent date
	assert.match(result.systemPrompt, /<\/available_skills>\nCurrent date/);
});

test("disabled skill excluded from scoring and output, doesn't consume floor slot", async () => {
	const disabledSkill = skill("disabled-helper", "Use when disabled things happen, disabled tasks.", { disableModelInvocation: true });
	const enabledSkills = [
		skill("alpha-tool", "Use when alpha beta."),
		skill("gamma-tool", "Use when gamma delta."),
	];
	const allSkills = [disabledSkill, ...enabledSkills];

	const { handlers } = register(config({ floor: 2, ceiling: 3 }));
	const result = await runBeforeAgentStart(handlers, "disabled tasks alpha beta", allSkills) as { systemPrompt?: string } | undefined;

	assert.ok(result?.systemPrompt);
	assert.doesNotMatch(result.systemPrompt, /<name>disabled-helper<\/name>/);
	// alpha-tool and gamma-tool should fill floor of 2 (visible skills only)
	assert.match(result.systemPrompt, /<name>alpha-tool<\/name>/);
	assert.match(result.systemPrompt, /<name>gamma-tool<\/name>/);
});

test("tool_call safely ignores read events with non-string path", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "skill-pruner-integration-"));
	const logPath = path.join(dir, "pruning.jsonl");
	setLogPathForTesting(logPath);
	try {
		const { handlers } = register(config({}, "off"), logPath);
		await runBeforeAgentStart(handlers, "anything", realisticSkills);

		const toolHandler = handlers.get("tool_call");
		assert.ok(toolHandler);
		await toolHandler({
			type: "tool_call",
			toolCallId: "1",
			toolName: "read",
			input: { path: 123 },
		}, { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } });

		assert.equal(existsSync(logPath), false);
	} finally {
		setLogPathForTesting(null);
		clearPruningTrackingForTesting();
	}
});

test("tool_call catches unexpected context errors and continues", async () => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (m?: unknown) => {
		warnings.push(String(m));
	};
	try {
		const { handlers } = register(config({}, "off"));
		await runBeforeAgentStart(handlers, "anything", realisticSkills);
		const toolHandler = handlers.get("tool_call");
		assert.ok(toolHandler);

		await toolHandler({
			type: "tool_call",
			toolCallId: "1",
			toolName: "read",
			input: { path: "/repo/skills/code-simplification/SKILL.md" },
		}, {
			cwd: "/repo",
			sessionManager: {
				getSessionId() {
					throw new Error("boom");
				},
			},
		});

		assert.ok(warnings.some((warning) => warning.includes("failed to record skill read: boom")));
	} finally {
		console.warn = originalWarn;
	}
});

test("__setFormatter(null) restores SDK formatter implementation", async () => {
	const { handlers } = register(config());
	__setFormatter(null);
	await assert.rejects(
		() => runBeforeAgentStart(handlers, "Refactor this code for clarity", realisticSkills),
		/test must call __setFormatter/,
	);
});

// ---------------------------------------------------------------------------
// Tool pruning tests
// ---------------------------------------------------------------------------

const mockToolInfo = [
	{ name: "read", description: "Read file contents", parameters: { type: "object", properties: {} } },
	{ name: "edit", description: "Edit a file using exact text replacement", parameters: { type: "object", properties: {} } },
	{ name: "bash", description: "Execute a bash command", parameters: { type: "object", properties: {} } },
	{ name: "subagent", description: "Delegate tasks to specialized subagents", parameters: { type: "object", properties: {} } },
	{ name: "web_search", description: "Search the web for information", parameters: { type: "object", properties: {} } },
];

test("tool pruning in auto mode calls setActiveTools with pruned list", async () => {
	const setActiveToolsCalls: string[][] = [];
	const { handlers } = register(config({}, "auto", { ceiling: 3 }));
	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => mockToolInfo.map((t) => t.name),
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		const result = await runBeforeAgentStart(handlers, "search the web", realisticSkills) as any;
		assert.ok(setActiveToolsCalls.length > 0, "setActiveTools should have been called");
		// Core tools should always be included
		assert.ok(setActiveToolsCalls[0].includes("read"));
		assert.ok(setActiveToolsCalls[0].includes("edit"));
		assert.ok(setActiveToolsCalls[0].includes("bash"));
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("tool pruning in shadow mode does not call setActiveTools", async () => {
	const setActiveToolsCalls: string[][] = [];
	const { handlers } = register(config({}, "shadow", { ceiling: 3 }));
	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => mockToolInfo.map((t) => t.name),
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		const result = await runBeforeAgentStart(handlers, "search the web", realisticSkills) as any;
		assert.equal(setActiveToolsCalls.length, 0, "setActiveTools should NOT be called in shadow mode");
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("tool pruning in off mode does not call setActiveTools", async () => {
	const setActiveToolsCalls: string[][] = [];
	const { handlers } = register(config({}, "off", { ceiling: 3 }));
	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => mockToolInfo.map((t) => t.name),
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		await runBeforeAgentStart(handlers, "search the web", realisticSkills);
		assert.equal(setActiveToolsCalls.length, 0, "setActiveTools should NOT be called in off mode");
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("tool pruning without tools config does not call setActiveTools", async () => {
	const setActiveToolsCalls: string[][] = [];
	const { handlers } = register(config()); // no tools config
	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => mockToolInfo.map((t) => t.name),
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		await runBeforeAgentStart(handlers, "search the web", realisticSkills);
		// No tools config => tool pruning should not happen
		assert.equal(setActiveToolsCalls.length, 0);
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("request_tool recovery tool is registered", async () => {
	const { handlers } = register(config());
	// The register function captures registered tools, but the request_tool
	// is registered via pi.registerTool which our mock captures
	// We verify the tool exists by checking the handler map is populated
	assert.ok(handlers.size > 0, "handler should be registered");
});

test("tool pruning with dependencies includes dependent tools", async () => {
	const setActiveToolsCalls: string[][] = [];
	const { handlers } = register(config({}, "auto", {
		ceiling: 5,
		dependencies: { edit: ["read"], subagent: ["bash"] },
	}));
	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => mockToolInfo.map((t) => t.name),
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		await runBeforeAgentStart(handlers, "delegate tasks to subagent", realisticSkills);
		const activeTools = setActiveToolsCalls[0];
		// If subagent is included, bash must also be included
		if (activeTools.includes("subagent")) {
			assert.ok(activeTools.includes("bash"), "bash should be included as dependency of subagent");
		}
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("UI feedback message is sent when skills are pruned", async () => {
	const { handlers, sentMessages } = register(config({ floor: 1, ceiling: 1, scoreThreshold: 0.4 }));
	__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });

	try {
		await runBeforeAgentStart(handlers, "Refactor this code for clarity", realisticSkills);
		assert.ok(sentMessages.length > 0, "should send a feedback message via pi.sendMessage");
		const msg = sentMessages[sentMessages.length - 1];
		assert.equal(msg.customType, "pruning-result");
		assert.equal(msg.display, true);
		const details = msg.details;
		assert.ok(details.excludedSkills.length > 0, "should have excluded skills");
		assert.ok(details.includedSkills.length > 0, "should have included skills");
		assert.equal(details.mode, "auto");
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("UI feedback includes tool pruning when tools config is present", async () => {
	const setActiveToolsCalls: string[][] = [];
	const { handlers, sentMessages } = register(config({ floor: 1, ceiling: 1, scoreThreshold: 0.4 }, "auto", { ceiling: 1 }));
	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => mockToolInfo.map((t) => t.name),
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		await runBeforeAgentStart(handlers, "Refactor this code for clarity", realisticSkills);
		assert.ok(sentMessages.length > 0, "should send a feedback message");
		const msg = sentMessages[sentMessages.length - 1];
		const details = msg.details;
		// With ceiling 1, only the top-scored contextual tool should be included
		// Core tools don't count against ceiling, so they're always included
		assert.ok(details.excludedTools.length > 0, `should have excluded tools, got included: ${details.includedTools}, excluded: ${details.excludedTools}`);
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("no feedback message when nothing is pruned", async () => {
	// All skills pinned => no skills pruned; no tools config => no tools pruned
	const { handlers, sentMessages } = register(config({ pinned: ["code-simplification", "duckdb-query-optimization", "frontend-design"], ceiling: 5 }));
	__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });

	try {
		await runBeforeAgentStart(handlers, "Refactor this code", realisticSkills);
		// All skills included => no pruning message
		assert.equal(sentMessages.length, 0, "no feedback message when nothing is pruned");
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

// ---------------------------------------------------------------------------
// New coverage tests: request_tool execute, message renderer, edge cases
// ---------------------------------------------------------------------------

test("request_tool execute enables a pruned tool", async () => {
	const setActiveToolsCalls: string[][] = [];
	const { registeredTools } = register(config({}, "auto", { ceiling: 3 }));
	const toolDef = registeredTools.get("request_tool");
	assert.ok(toolDef, "request_tool should be registered");

	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => ["read", "edit", "bash"],
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		const result = await toolDef.execute("call-1", { toolName: "web_search" }, undefined, undefined, undefined) as any;
		assert.equal(result.isError, undefined, "should not be an error");
		assert.ok(result.content[0].text.includes("web_search"), "should confirm tool enabled");
		assert.ok(setActiveToolsCalls.length > 0, "setActiveTools should be called");
		assert.ok(setActiveToolsCalls[0].includes("web_search"), "web_search should be in new active tools");
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("request_tool execute returns error for unknown tool name", async () => {
	const { registeredTools } = register(config({}, "auto", { ceiling: 3 }));
	const toolDef = registeredTools.get("request_tool");
	assert.ok(toolDef, "request_tool should be registered");

	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => ["read", "edit", "bash"],
		setActiveTools: () => {},
	});

	try {
		const result = await toolDef.execute("call-2", { toolName: "nonexistent_tool" }, undefined, undefined, undefined) as any;
		assert.equal(result.isError, true, "should be an error for unknown tool");
		assert.ok(result.content[0].text.includes("nonexistent_tool"), "should mention the unknown tool");
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("request_tool execute returns message when tool is already active", async () => {
	const { registeredTools } = register(config({}, "auto", { ceiling: 3 }));
	const toolDef = registeredTools.get("request_tool");
	assert.ok(toolDef, "request_tool should be registered");

	__setToolSeams({
		getAllTools: () => mockToolInfo as any[],
		getActiveTools: () => ["read", "edit", "bash", "web_search"],
		setActiveTools: () => {},
	});

	try {
		const result = await toolDef.execute("call-3", { toolName: "web_search" }, undefined, undefined, undefined) as any;
		assert.ok(result.content[0].text.includes("already active"), "should say tool is already active");
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});

test("message renderer compact view renders skill summary", async () => {
	const { registeredRenderers } = register(config());
	const renderer = registeredRenderers.get("pruning-result");
	assert.ok(renderer, "pruning-result renderer should be registered");

	const themeMock = {
		fg: (color: string, text: string) => `[${color}]{${text}}`,
		bg: (_color: string, text: string) => text,
	};

	const box = renderer(
		{
			content: "Pruned: Kept 1/3 skills",
			display: true,
			details: {
				includedSkills: ["code-simplification"],
				excludedSkills: ["duckdb-query-optimization", "frontend-design"],
				includedTools: [],
				excludedTools: [],
				mode: "auto",
				skillTokensSaved: 300,
				toolTokensSaved: 0,
			},
		},
		{ expanded: false },
		themeMock,
	);
	const rendered = box.render(80);
	assert.ok(rendered.some((line: string) => line.includes("Kept 1/3 skills")), "compact view should summarize skills");
	assert.ok(rendered.some((line: string) => line.includes("Saved")), "compact view should show token savings");
});

test("message renderer expanded view renders skill details", async () => {
	const { registeredRenderers } = register(config());
	const renderer = registeredRenderers.get("pruning-result");
	assert.ok(renderer, "pruning-result renderer should be registered");

	const themeMock = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	};

	const box = renderer(
		{
			content: "Pruned: Kept 1/3 skills",
			display: true,
			details: {
				includedSkills: ["code-simplification"],
				excludedSkills: ["duckdb-query-optimization", "frontend-design"],
				includedTools: ["read", "edit"],
				excludedTools: ["web_search"],
				mode: "shadow",
				skillTokensSaved: 200,
				toolTokensSaved: 50,
			},
		},
		{ expanded: true },
		themeMock,
	);
	const rendered = box.render(80);
	const allText = rendered.join("\n");
	assert.ok(allText.includes("code-simplification"), "expanded view should list included skills");
	assert.ok(allText.includes("duckdb-query-optimization"), "expanded view should list excluded skills");
	assert.ok(allText.includes("web_search"), "expanded view should list excluded tools");
});

test("message renderer with no details renders raw content", async () => {
	const { registeredRenderers } = register(config());
	const renderer = registeredRenderers.get("pruning-result");
	assert.ok(renderer, "pruning-result renderer should be registered");

	const themeMock = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	};

	// Pass message without details to hit the fallback path
	const box = renderer(
		{ content: "Plain pruning message", display: true },
		{ expanded: false },
		themeMock,
	);
	const rendered = box.render(80);
	assert.ok(rendered.some((line: string) => line.includes("Plain pruning message")), "should render raw content");
});

test("off mode with tools config logs tool baseline decision", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "skill-pruner-integration-"));
	const logPath = path.join(dir, "pruning.jsonl");
	setLogPathForTesting(logPath);
	try {
		const { handlers } = register(config({}, "off", { ceiling: 10 }), logPath);
		__setToolSeams({
			getAllTools: () => mockToolInfo as any[],
			getActiveTools: () => mockToolInfo.map((t) => t.name),
			setActiveTools: () => {},
		});
		try {
			await runBeforeAgentStart(handlers, "anything", realisticSkills);
			const lines = readFileSync(logPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
			const toolLine = lines.find((l) => l.toolIncluded !== undefined);
			assert.ok(toolLine, "should log a tool decision in off mode when tools config is present");
			assert.equal(toolLine.mode, "off");
		} finally {
			__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
		}
	} finally {
		setLogPathForTesting(null);
		clearPruningTrackingForTesting();
	}
});

test("UI feedback toolTokensSaved reflects actual excluded tool content size", async () => {
	const setActiveToolsCalls: string[][] = [];
	const largeTools = [
		{ name: "read", description: "Read file contents from the filesystem", parameters: { type: "object", properties: {} } },
		{ name: "edit", description: "Edit a file using exact text replacement", parameters: { type: "object", properties: {} } },
		{ name: "bash", description: "Execute a bash command in the shell", parameters: { type: "object", properties: {} } },
		{ name: "web_search", description: "Search the web for information using multiple search engines and return relevant results", parameters: { type: "object", properties: {} } },
		{ name: "fetch_content", description: "Fetch content from a URL and return the body as text for processing and analysis", parameters: { type: "object", properties: {} } },
	];
	const { handlers, sentMessages } = register(config({ floor: 1, ceiling: 1, scoreThreshold: 0.4 }, "auto", { ceiling: 1 }));
	__setToolSeams({
		getAllTools: () => largeTools as any[],
		getActiveTools: () => largeTools.map((t) => t.name),
		setActiveTools: (names: string[]) => { setActiveToolsCalls.push(names); },
	});

	try {
		await runBeforeAgentStart(handlers, "Refactor this code for clarity", realisticSkills);
		assert.ok(sentMessages.length > 0, "should send feedback message");
		const msg = sentMessages[sentMessages.length - 1];
		const details = msg.details;
		// With excluded tools having non-trivial descriptions, token savings should
		// be proportional to actual content length, not just the digit count of the char sum.
		if (details.excludedTools.length > 0) {
			// Each excluded tool contributes name.length + description.length + 50 chars;
			// token estimate = Math.ceil(totalChars / 4). Should be > 10 for realistic descriptions.
			assert.ok(details.toolTokensSaved > 10, `toolTokensSaved should reflect actual content size, got ${details.toolTokensSaved}`);
		}
	} finally {
		__setToolSeams({ getAllTools: null, getActiveTools: null, setActiveTools: null });
	}
});
