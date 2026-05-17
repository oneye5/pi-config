/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { SystemPromptMessage } from '../../system-prompts';
import { registerRowRenderer, type RowRendererProps } from '../registry';

function renderSystemPrompts({ systemPrompts, pruningResult }: RowRendererProps) {
  return <SystemPromptMessage prompts={systemPrompts} pruningResult={pruningResult} />;
}

registerRowRenderer('systemPrompts', renderSystemPrompts);
