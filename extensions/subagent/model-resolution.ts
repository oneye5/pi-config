import type { Model } from "@mariozechner/pi-ai";

export interface ModelRegistryLike {
	getAvailable(): Model<any>[];
	getAll(): Model<any>[];
	find(provider: string, id: string): Model<any> | undefined;
}

export interface ResolvedExecutionModel {
	resolvedModel: Model<any> | undefined;
	actualModelId: string | undefined;
	diagnostic?: string;
}

/**
 * Resolve the requested subagent model against the registry.
 *
 * - When a requested model id is present, prefer the caller's provider when that
 *   provider exposes the same id.
 * - When the requested model cannot be found (or only exists on disabled
 *   providers), fall back to the caller model when possible and emit a diagnostic.
 * - When no requested model is present, inherit the caller model.
 */
export function resolveExecutionModel(
	modelRegistry: ModelRegistryLike,
	callerModel: Model<any> | undefined,
	requestedModel: string | undefined,
	disabledProviders?: Set<string>,
): ResolvedExecutionModel {
	const isProviderEnabled = (provider: string): boolean => !disabledProviders?.has(provider);
	const callerProviderEnabled = !callerModel || isProviderEnabled(callerModel.provider);
	let resolvedModel: Model<any> | undefined = callerProviderEnabled ? callerModel : undefined;
	let diagnostic: string | undefined;

	if (requestedModel) {
		const availableModels = modelRegistry.getAvailable();
		const allModels = modelRegistry.getAll();

		if (callerModel && isProviderEnabled(callerModel.provider)) {
			const sameProvider = modelRegistry.find(callerModel.provider, requestedModel);
			if (sameProvider && isProviderEnabled(sameProvider.provider)) {
				return { resolvedModel: sameProvider, actualModelId: sameProvider.id };
			}
		}

		const foundAvailable = availableModels.find((m) => m.id === requestedModel && isProviderEnabled(m.provider));
		if (foundAvailable) {
			return { resolvedModel: foundAvailable, actualModelId: foundAvailable.id };
		}

		const found = allModels.find((m) => m.id === requestedModel && isProviderEnabled(m.provider));
		if (found) {
			return { resolvedModel: found, actualModelId: found.id };
		}

		const disabledMatches = allModels
			.filter((m) => m.id === requestedModel && !isProviderEnabled(m.provider))
			.map((m) => m.provider);
		if (disabledMatches.length > 0) {
			diagnostic = `Requested model "${requestedModel}" is only available from disabled provider(s): ${[...new Set(disabledMatches)].join(", ")}. Falling back to caller/default model.`;
		} else {
			const allIds = allModels.map((m) => `${m.provider}/${m.id}`).slice(0, 10).join(", ");
			diagnostic = `Requested model "${requestedModel}" not found in registry. Available: ${allIds || "none"}. Falling back to caller/default model.`;
		}
	}

	return {
		resolvedModel,
		actualModelId: resolvedModel?.id,
		diagnostic,
	};
}
