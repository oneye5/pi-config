import test from "node:test";
import assert from "node:assert/strict";
import type { Model } from "@mariozechner/pi-ai";
import { resolveExecutionModel } from "../model-resolution.js";

function model(provider: string, id: string): Model<any> {
	return { provider, id } as Model<any>;
}

function registry(models: Model<any>[]) {
	return {
		getAvailable: () => models,
		getAll: () => models,
		find: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
	};
}

test("resolveExecutionModel uses the requested model instead of inheriting the caller model", () => {
	const models = [
		model("github-copilot", "gpt-5.4"),
		model("github-copilot", "claude-opus-4.6"),
	];

	const result = resolveExecutionModel(
		registry(models),
		model("github-copilot", "gpt-5.4"),
		"claude-opus-4.6",
	);

	assert.equal(result.resolvedModel?.id, "claude-opus-4.6");
	assert.equal(result.actualModelId, "claude-opus-4.6");
	assert.equal(result.diagnostic, undefined);
});

test("resolveExecutionModel also resolves agent-frontmatter model requests", () => {
	const models = [
		model("github-copilot", "gpt-5.4"),
		model("ollama", "qwen3.5:cloud"),
	];

	const result = resolveExecutionModel(
		registry(models),
		model("github-copilot", "gpt-5.4"),
		"qwen3.5:cloud",
	);

	assert.equal(result.resolvedModel?.id, "qwen3.5:cloud");
	assert.equal(result.actualModelId, "qwen3.5:cloud");
});

test("resolveExecutionModel falls back to the caller model with a diagnostic when the request is missing", () => {
	const models = [model("github-copilot", "gpt-5.4")];

	const result = resolveExecutionModel(
		registry(models),
		model("github-copilot", "gpt-5.4"),
		"claude-opus-4.6",
	);

	assert.equal(result.resolvedModel?.id, "gpt-5.4");
	assert.equal(result.actualModelId, "gpt-5.4");
	assert.match(result.diagnostic ?? "", /claude-opus-4\.6/);
	assert.match(result.diagnostic ?? "", /Falling back to caller\/default model/);
});
