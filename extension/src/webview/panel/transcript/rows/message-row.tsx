/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { MessageItem } from '../message-item';
import { registerRowRenderer, type RowRendererProps } from '../registry';

function renderMessage({
  row,
  busy,
  overlay,
  prefs,
  workingDirectory,
  editingId,
  isLastRow,
  onEditRequest,
  onEditConfirm,
  onEditCancel,
  onOpenFile,
  onContextMenu,
  renderToolCall,
}: RowRendererProps) {
  if (row.kind !== 'message') return null;

  const overlayParts = overlay.partsByMessage.get(row.message.id);
  const isStreaming = busy && row.message.role === 'assistant' && row.message.status === 'streaming';
  const isLastAssistantMessage = busy && row.message.role === 'assistant' && isLastRow;

  return (
    <MessageItem
      key={row.message.id}
      message={row.message}
      overlayParts={overlayParts}
      isStreaming={isStreaming}
      prefs={prefs}
      readonly={busy}
      workingDirectory={workingDirectory}
      editingId={editingId}
      onEditRequest={onEditRequest}
      onEditConfirm={onEditConfirm}
      onEditCancel={onEditCancel}
      onOpenFile={onOpenFile}
      onContextMenu={onContextMenu}
      renderToolCall={renderToolCall}
      isLastAssistantMessage={isLastAssistantMessage}
    />
  );
}

registerRowRenderer('message', renderMessage);
