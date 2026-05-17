/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { registerRowRenderer, type RowRendererProps } from '../registry';

function renderBottomGap({ isLoadingNewer, onRequestNewer }: RowRendererProps) {
  return (
    <div class="transcript-gap-row transcript-gap-row-bottom">
      <button type="button" class="transcript-gap-btn" disabled={isLoadingNewer} onClick={onRequestNewer}>
        {isLoadingNewer ? 'Loading newer messages…' : 'Load newer messages'}
      </button>
    </div>
  );
}

registerRowRenderer('bottomGap', renderBottomGap);
