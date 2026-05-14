/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { ChatPrefs, ToolCall } from '../../../shared/protocol';
import { shouldOpenSubagentContextMenu } from '../transcript-interactions';
import { summarizeToolCall } from '../tool-call-summary';
import { getToolCallContextType } from '../chat-prefs';

import { MessageItem } from './message-item';
import {
  getRenderableSubagentResultFromToolCall,
  subagentSingleResultToChatMessages,
  type SubagentResult,
} from './subagent';
import { ToolCallCard } from './tool-call-card';
import type { RenderToolCall, TranscriptContextMenuHandler } from './types';
import { useDisclosureOpen } from './use-disclosure-open';

interface ToolCallItemProps {
  toolCall: ToolCall;
  prefs: ChatPrefs;
  workingDirectory: string | null;
  onOpenFile: (path: string) => void;
  onContextMenu: TranscriptContextMenuHandler;
  renderToolCall: RenderToolCall;
}

interface SubagentBlockProps {
  toolCall: ToolCall;
  subagentResult?: SubagentResult;
  prefs: ChatPrefs;
  workingDirectory: string | null;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: MouseEvent) => void;
  onNestedContextMenu: TranscriptContextMenuHandler;
  renderToolCall: RenderToolCall;
}

function SubagentBlock({
  toolCall,
  subagentResult,
  prefs,
  workingDirectory,
  onOpenFile,
  onContextMenu,
  onNestedContextMenu,
  renderToolCall,
}: SubagentBlockProps) {
  const [open, setOpen] = useDisclosureOpen(`subagent:${toolCall.id}`, prefs.autoExpandSubagentCalls);

  const result = subagentResult ?? getRenderableSubagentResultFromToolCall(toolCall);

  if (!result) {
    // Dispatch/setup failures may still have a failed top-level result but no child runs.
    return (
      <ToolCallCard
        toolCall={toolCall}
        autoExpand={prefs.autoExpandSubagentCalls}
        className="tool-call-subagent"
        workingDirectory={workingDirectory}
        onOpenFile={onOpenFile}
        onContextMenu={onContextMenu}
      />
    );
  }

  const agentNames = [...new Set(result.results.map((r) => r.agent))];
  const nameDisplay = agentNames.length === 1 ? agentNames[0] : `${agentNames.length} agents`;
  const multipleResults = result.results.length > 1;
  const summary = summarizeToolCall(toolCall);
  const nestedDisclosureDefaultsKey = `${prefs.autoExpandReasoning ? 'r1' : 'r0'}-${prefs.autoExpandToolCalls ? 't1' : 't0'}`;

  return (
    <div
      class={`tool-call tool-call-subagent ${toolCall.status}`}
      role="button"
      aria-expanded={open}
      tabIndex={0}
      onClick={() => setOpen((v) => !v)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e as unknown as MouseEvent); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
    >
      <div class="tool-call-header">
        <svg class={`thinking-block-chevron${open ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <polyline points="3,2 7,5 3,8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <div class={`tool-call-heading${!open && summary ? ' with-summary' : ''}`}>
          <span class={`tool-call-name${!open && summary ? ' with-summary' : ''}`}>{nameDisplay}</span>
          {!open && summary ? <span class="tool-call-summary">{summary}</span> : null}
        </div>
        <span class={`tool-call-status${toolCall.status === 'running' || toolCall.status === 'failed' ? ` ${toolCall.status}` : ' is-empty'}`} aria-hidden={toolCall.status === 'completed' ? 'true' : undefined}>
          {toolCall.status === 'running' ? 'Running' : toolCall.status === 'failed' ? 'Failed' : ''}
        </span>
      </div>
      {open && (
        <div
          class="subagent-messages"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            if (!shouldOpenSubagentContextMenu(e.target)) {
              e.stopPropagation();
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e as unknown as MouseEvent);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {result.results.map((singleResult, index) => {
            const messages = subagentSingleResultToChatMessages(singleResult, `${toolCall.id}-${index}`);
            return (
              <div key={index} class={`subagent-result${multipleResults ? ' labeled' : ''}`}>
                {multipleResults && (
                  <div class="subagent-result-label">{singleResult.agent}</div>
                )}
                {singleResult.runningTools && singleResult.runningTools.length > 0 && (
                  <div class="subagent-running-tools">
                    {singleResult.runningTools.map((runningTool, runningIndex) => (
                      <span key={runningIndex} class="subagent-running-tool">{runningTool}…</span>
                    ))}
                  </div>
                )}
                {messages.map((message) => (
                  <MessageItem
                    key={`${message.id}-${nestedDisclosureDefaultsKey}`}
                    message={message}
                    overlayParts={undefined}
                    isStreaming={false}
                    prefs={prefs}
                    readonly
                    workingDirectory={workingDirectory}
                    editingId={null}
                    onEditRequest={() => {}}
                    onEditConfirm={() => {}}
                    onEditCancel={() => {}}
                    onOpenFile={onOpenFile}
                    onContextMenu={onNestedContextMenu}
                    renderToolCall={renderToolCall}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ToolCallItem({
  toolCall,
  prefs,
  workingDirectory,
  onOpenFile,
  onContextMenu,
  renderToolCall,
}: ToolCallItemProps) {
  const subagentResult = getRenderableSubagentResultFromToolCall(toolCall);
  const isSubagent = toolCall.name === 'subagent' || !!subagentResult;
  const contextType = getToolCallContextType(isSubagent ? 'subagent' : toolCall.name);
  const handleContextMenu = (e: MouseEvent) => onContextMenu(
    contextType,
    JSON.stringify(toolCall, null, 2),
    e,
  );

  if (isSubagent) {
    return (
      <SubagentBlock
        toolCall={toolCall}
        subagentResult={subagentResult}
        prefs={prefs}
        workingDirectory={workingDirectory}
        onOpenFile={onOpenFile}
        onContextMenu={handleContextMenu}
        onNestedContextMenu={onContextMenu}
        renderToolCall={renderToolCall}
      />
    );
  }

  return (
    <ToolCallCard
      toolCall={toolCall}
      autoExpand={prefs.autoExpandToolCalls}
      workingDirectory={workingDirectory}
      onOpenFile={onOpenFile}
      onContextMenu={handleContextMenu}
    />
  );
}
