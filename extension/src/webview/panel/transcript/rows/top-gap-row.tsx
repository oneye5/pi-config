/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { registerRowRenderer, type RowRendererProps } from '../registry';

function renderTopGap({ isLoadingOlder, onRequestOlder }: RowRendererProps) {
  return (
    <div class="transcript-gap-row">
      <button type="button" class="transcript-gap-btn" disabled={isLoadingOlder} onClick={onRequestOlder}>
        {isLoadingOlder ? 'Loading older messages…' : 'Load older messages'}
      </button>
    </div>
  );
}

registerRowRenderer('topGap', renderTopGap);
