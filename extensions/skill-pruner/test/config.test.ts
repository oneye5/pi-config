import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, DEFAULT_TOOL_CONFIG, loadConfig } from "../config.js";

function tempSettings(content: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), "skill-pruner-config-"));
	const settingsPath = path.join(dir, "settings.json");
	writeFileSync(settingsPath, content, "utf-8");
	return settingsPath;
}

function captureWarns<T>(fn: () => T): { result: T; warnings: string[] } {
	const original = console.warn;
	const warnings: string[] = [];
	console.warn = (message?: unknown) => { warnings.push(String(message)); };
	try {
		return { result: fn(), warnings };
	} finally {
		console.warn = original;
	}
}

test("loadConfig returns defaults for a missing settings file", () => {
	const { result, warnings } = captureWarns(() => loadConfig(path.join(tmpdir(), "missing-skill-pruner-settings.json")));
	assert.equal(result.mode, DEFAULT_CONFIG.mode);
	assert.deepEqual(result.skills, DEFAULT_CONFIG.skills);
	assert.deepEqual(result.tools!.tiers, DEFAULT_TOOL_CONFIG.tiers);
	assert.equal(result.tools!.ceiling, DEFAULT_TOOL_CONFIG.ceiling);
	assert.ok(warnings.some((warning) => warning.includes("settings.json not found")));
});

test("loadConfig returns defaults for malformed JSON", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings("{")));
	assert.equal(result.mode, DEFAULT_CONFIG.mode);
	assert.deepEqual(result.skills, DEFAULT_CONFIG.skills);
	assert.ok(warnings.some((warning) => warning.includes("failed to parse")));
});

test("loadConfig returns defaults when pruning key is absent", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings(JSON.stringify({ model: "example" }))));
	assert.equal(result.mode, DEFAULT_CONFIG.mode);
	assert.deepEqual(result.skills, DEFAULT_CONFIG.skills);
	assert.deepEqual(result.tools!.tiers, DEFAULT_TOOL_CONFIG.tiers);
	assert.equal(result.tools!.ceiling, DEFAULT_TOOL_CONFIG.ceiling);
	assert.deepEqual(warnings, []);
});

test("loadConfig parses a valid full config", () => {
	const settingsPath = tempSettings(JSON.stringify({
		pruning: {
			mode: "shadow",
			skills: {
				ceiling: 4,
				floor: 1,
				scoreThreshold: 0.7,
				gapThreshold: 0.2,
				pinned: ["debugging-and-error-recovery"],
			},
		},
	}));

	const result = loadConfig(settingsPath);
	assert.equal(result.mode, "shadow");
	assert.deepEqual(result.skills, {
		ceiling: 4,
		floor: 1,
		scoreThreshold: 0.7,
		gapThreshold: 0.2,
		pinned: ["debugging-and-error-recovery"],
	});
	assert.ok(result.tools);
	assert.deepEqual(result.tools.tiers, DEFAULT_TOOL_CONFIG.tiers);
	assert.equal(result.tools.ceiling, DEFAULT_TOOL_CONFIG.ceiling);
});

test("loadConfig defaults only invalid mode and warns", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings(JSON.stringify({
		pruning: { mode: "invalid", skills: { ceiling: 3, floor: 1 } },
	}))));
	assert.equal(result.mode, DEFAULT_CONFIG.mode);
	assert.equal(result.skills.ceiling, 3);
	assert.equal(result.skills.floor, 1);
	assert.ok(warnings.some((warning) => warning.includes("invalid pruning.mode")));
});

test("loadConfig resets invalid ceiling/floor to defaults", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings(JSON.stringify({
		pruning: { skills: { ceiling: 1, floor: 3 } },
	}))));
	assert.equal(result.skills.ceiling, DEFAULT_CONFIG.skills.ceiling);
	assert.equal(result.skills.floor, DEFAULT_CONFIG.skills.floor);
	assert.ok(warnings.some((warning) => warning.includes("ceiling/floor")));
});

test("loadConfig defaults thresholds outside [0,1]", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings(JSON.stringify({
		pruning: { skills: { scoreThreshold: -0.1, gapThreshold: 1.1 } },
	}))));
	assert.equal(result.skills.scoreThreshold, DEFAULT_CONFIG.skills.scoreThreshold);
	assert.equal(result.skills.gapThreshold, DEFAULT_CONFIG.skills.gapThreshold);
	assert.equal(warnings.length, 2);
});

test("loadConfig defaults invalid pinned values", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings(JSON.stringify({
		pruning: { skills: { pinned: ["valid", 42] } },
	}))));
	assert.deepEqual(result.skills.pinned, []);
	assert.ok(warnings.some((warning) => warning.includes("pinned")));
});

test("loadConfig loads tools config with custom tiers", () => {
	const settingsPath = tempSettings(JSON.stringify({
		pruning: {
			mode: "auto",
			skills: { ceiling: 5, floor: 2 },
			tools: {
				tiers: { read: "core", web_search: "rare" },
				ceiling: 3,
			},
		},
	}));
	const result = loadConfig(settingsPath);
	assert.ok(result.tools);
	assert.equal(result.tools.tiers.read, "core");
	assert.equal(result.tools.tiers.web_search, "rare");
	assert.equal(result.tools.ceiling, 3);
	assert.deepEqual(result.tools.dependencies.edit, ["read"]);
});

test("loadConfig defaults tools config when absent", () => {
	const settingsPath = tempSettings(JSON.stringify({ pruning: { mode: "auto" } }));
	const result = loadConfig(settingsPath);
	assert.ok(result.tools);
	assert.equal(result.tools.tiers.read, "core");
	assert.equal(result.tools.ceiling, 5);
});

test("loadConfig warns on invalid tools ceiling", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings(JSON.stringify({
		pruning: { tools: { ceiling: -1 } },
	}))));
	assert.ok(result.tools);
	assert.equal(result.tools.ceiling, 5); // falls back to default
	assert.ok(warnings.some((w) => w.includes("ceiling")));
});

test("loadConfig warns on invalid tool tier value", () => {
	const { result, warnings } = captureWarns(() => loadConfig(tempSettings(JSON.stringify({
		pruning: { tools: { tiers: { read: "invalid" } } },
	}))));
	assert.ok(result.tools);
	assert.ok(warnings.some((w) => w.includes("Invalid tier")));
});
