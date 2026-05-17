import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PruningConfig, PruningMode, ToolPruningConfig, ToolTier } from "./types.js";

/** Root of the pi-config repo, resolved from this extension's known position. */
const CONFIG_ROOT = path.resolve(import.meta.dirname, "..", "..");

export const DEFAULT_TOOL_CONFIG: ToolPruningConfig = {
	tiers: {
		read: "core",
		edit: "core",
		write: "core",
		bash: "core",
		subagent: "contextual",
		web_search: "contextual",
		code_search: "contextual",
		fetch_content: "contextual",
		get_search_content: "contextual",
	},
	dependencies: {
		edit: ["read"],
		subagent: ["bash"],
	},
	ceiling: 5,
};

export const DEFAULT_CONFIG: PruningConfig = {
	mode: "auto",
	skills: {
		ceiling: 5,
		floor: 2,
		scoreThreshold: 0.4,
		gapThreshold: 0.3,
		pinned: [],
	},
	tools: cloneDefaultToolConfig(),
};

const VALID_MODES = new Set<PruningMode>(["auto", "off", "shadow"]);

function cloneDefault(): PruningConfig {
	return {
		mode: DEFAULT_CONFIG.mode,
		skills: {
			ceiling: DEFAULT_CONFIG.skills.ceiling,
			floor: DEFAULT_CONFIG.skills.floor,
			scoreThreshold: DEFAULT_CONFIG.skills.scoreThreshold,
			gapThreshold: DEFAULT_CONFIG.skills.gapThreshold,
			pinned: [...DEFAULT_CONFIG.skills.pinned],
		},
		tools: cloneDefaultToolConfig(),
	};
}

function cloneDefaultToolConfig(): ToolPruningConfig {
	return {
		tiers: { ...DEFAULT_TOOL_CONFIG.tiers },
		dependencies: Object.fromEntries(
			Object.entries(DEFAULT_TOOL_CONFIG.dependencies).map(([k, v]) => [k, [...v]]),
		),
		ceiling: DEFAULT_TOOL_CONFIG.ceiling,
	};
}

function warn(message: string): void {
	console.warn(`[skill-pruner] ${message}`);
}

export function loadConfig(
	settingsPath = path.join(CONFIG_ROOT, "settings.json"),
): PruningConfig {
	if (!existsSync(settingsPath)) {
		warn(`settings.json not found at ${settingsPath}; using pruning defaults`);
		return cloneDefault();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch (error) {
		warn(`failed to parse settings.json at ${settingsPath}; using pruning defaults: ${error instanceof Error ? error.message : String(error)}`);
		return cloneDefault();
	}

	if (!parsed || typeof parsed !== "object" || !("pruning" in parsed)) {
		return cloneDefault();
	}

	const pruning = (parsed as { pruning?: unknown }).pruning;
	if (!pruning || typeof pruning !== "object") {
		warn("settings.pruning must be an object; using pruning defaults");
		return cloneDefault();
	}

	const raw = pruning as Record<string, unknown>;
	const rawSkills = raw.skills && typeof raw.skills === "object" ? raw.skills as Record<string, unknown> : {};
	const config = cloneDefault();

	if (raw.mode !== undefined) {
		if (typeof raw.mode === "string" && VALID_MODES.has(raw.mode as PruningMode)) {
			config.mode = raw.mode as PruningMode;
		} else {
			warn(`invalid pruning.mode '${String(raw.mode)}'; using default '${DEFAULT_CONFIG.mode}'`);
		}
	}

	const ceiling = rawSkills.ceiling ?? config.skills.ceiling;
	const floor = rawSkills.floor ?? config.skills.floor;
	if (rawSkills.ceiling !== undefined || rawSkills.floor !== undefined) {
		if (
			typeof ceiling === "number" &&
			Number.isFinite(ceiling) &&
			Number.isInteger(ceiling) &&
			typeof floor === "number" &&
			Number.isFinite(floor) &&
			Number.isInteger(floor) &&
			ceiling >= floor &&
			floor >= 1
		) {
			config.skills.ceiling = ceiling;
			config.skills.floor = floor;
		} else {
			warn("invalid pruning.skills ceiling/floor; using default ceiling and floor");
		}
	}

	if (rawSkills.scoreThreshold !== undefined) {
		if (typeof rawSkills.scoreThreshold === "number" && rawSkills.scoreThreshold >= 0 && rawSkills.scoreThreshold <= 1) {
			config.skills.scoreThreshold = rawSkills.scoreThreshold;
		} else {
			warn("invalid pruning.skills.scoreThreshold; using default");
		}
	}

	if (rawSkills.gapThreshold !== undefined) {
		if (typeof rawSkills.gapThreshold === "number" && rawSkills.gapThreshold >= 0 && rawSkills.gapThreshold <= 1) {
			config.skills.gapThreshold = rawSkills.gapThreshold;
		} else {
			warn("invalid pruning.skills.gapThreshold; using default");
		}
	}

	if (rawSkills.pinned !== undefined) {
		if (Array.isArray(rawSkills.pinned) && rawSkills.pinned.every((value) => typeof value === "string")) {
			config.skills.pinned = [...rawSkills.pinned];
		} else {
			warn("invalid pruning.skills.pinned; using default []");
		}
	}

	// Load tools config
	if (raw.tools != null && typeof raw.tools === 'object') {
		const rawTools = raw.tools as Record<string, unknown>;
		// Merge tiers
		const newTiers = { ...DEFAULT_TOOL_CONFIG.tiers };
		if (rawTools.tiers && typeof rawTools.tiers === 'object') {
			const userTiers = rawTools.tiers as Record<string, unknown>;
			for (const [tool, tier] of Object.entries(userTiers)) {
				if (typeof tier === 'string' && (tier === 'core' || tier === 'contextual' || tier === 'rare')) {
					newTiers[tool] = tier as ToolTier;
				} else {
					warn(`Invalid tier for tool '${tool}'; skipping`);
				}
			}
		}
		config.tools.tiers = newTiers;

		// Merge dependencies
		const newDependencies = { ...DEFAULT_TOOL_CONFIG.dependencies };
		if (rawTools.dependencies && typeof rawTools.dependencies === 'object') {
			const userDeps = rawTools.dependencies as Record<string, unknown>;
			for (const [tool, deps] of Object.entries(userDeps)) {
				if (Array.isArray(deps) && deps.every(d => typeof d === 'string')) {
					newDependencies[tool] = deps;
				} else {
					warn(`Invalid dependencies for tool '${tool}'; skipping`);
				}
			}
		}
		config.tools.dependencies = newDependencies;

		// Ceiling
		if (rawTools.ceiling !== undefined) {
			const ceiling = rawTools.ceiling;
			if (typeof ceiling === 'number' && Number.isInteger(ceiling) && ceiling > 0) {
				config.tools.ceiling = ceiling;
			} else {
				warn("Invalid pruning.tools.ceiling; must be a positive integer; using default");
			}
		}
	}

	return config;
}
