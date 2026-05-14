/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { ChatPrefs, ModelInfo, ThinkingLevel } from '../../../shared/protocol';

import { ComposerSettingsMenu } from './settings-menu';

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Max',
};

interface ComposerToolbarStatus {
  text: string;
  tone: string;
  title: string;
}

interface ComposerToolbarProps {
  prefs: ChatPrefs;
  onSetPrefs: (prefs: Partial<ChatPrefs>) => void;
  availableModels: ModelInfo[];
  selectedModel: string;
  selectedLevel: ThinkingLevel;
  supportsReasoning: boolean;
  contextIndicator: { label: string | null; ariaLabel: string; severity: string | null } | null;
  contextBreakdownTitle: string | null;
  runStatus: ComposerToolbarStatus | null;
  onModelChange: (model: string, thinkingLevel: ThinkingLevel) => void;
}

export function ComposerToolbar({
  prefs,
  onSetPrefs,
  availableModels,
  selectedModel,
  selectedLevel,
  supportsReasoning,
  contextIndicator,
  contextBreakdownTitle,
  runStatus,
  onModelChange,
}: ComposerToolbarProps) {
  const contextIndicatorClass = contextIndicator?.severity ? ` ${contextIndicator.severity}` : '';

  return (
    <div class="composer-toolbar">
      <ComposerSettingsMenu prefs={prefs} onSetPrefs={onSetPrefs} />

      {availableModels.length > 0 ? (
        <select
          class="model-select"
          value={selectedModel}
          onChange={(e) => {
            const target = e.target as HTMLSelectElement;
            onModelChange(target.value, selectedLevel);
          }}
          aria-label="Model"
          title="Select model"
        >
          {availableModels.map((model) => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
      ) : selectedModel ? (
        <span class="model-select-static" title={selectedModel}>{selectedModel}</span>
      ) : null}

      {supportsReasoning && (
        <select
          class="model-select model-select-sm"
          value={selectedLevel}
          onChange={(e) => {
            const target = e.target as HTMLSelectElement;
            onModelChange(selectedModel, target.value as ThinkingLevel);
          }}
          aria-label="Reasoning level"
          title="Reasoning level"
        >
          {(Object.keys(THINKING_LEVEL_LABELS) as ThinkingLevel[]).map((level) => (
            <option key={level} value={level}>{THINKING_LEVEL_LABELS[level]}</option>
          ))}
        </select>
      )}

      {contextIndicator?.label && contextBreakdownTitle && (
        <div class="context-window-indicator-anchor">
          <span
            class={`model-select-static context-window-indicator${contextIndicatorClass}`}
            aria-label={contextIndicator.ariaLabel}
            aria-description={contextBreakdownTitle}
            title={contextBreakdownTitle}
          >
            {contextIndicator.label}
          </span>
        </div>
      )}

      {runStatus && (
        <div class="composer-run-controls">
          <span
            class={`composer-meta-chip ${runStatus.tone}`}
            title={runStatus.title}
          >
            {runStatus.text}
          </span>
        </div>
      )}
    </div>
  );
}
