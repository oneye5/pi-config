/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { useState } from 'preact/hooks';

import type { PruningResult } from '../../shared/protocol';

interface PruningBannerProps {
  pruningResult: PruningResult;
}

/**
 * Compact, collapsible banner that surfaces skill-pruner results.
 * Appears above the system-prompts section when pruning occurred.
 */
export function PruningBanner({ pruningResult }: PruningBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const {
    skillsKept,
    skillsTotal,
    toolsKept,
    toolsTotal,
    tokensSaved,
    hasSkillPruning,
    hasToolPruning,
  } = pruningResult;

  const summaryParts: string[] = [];
  if (skillsTotal > 0) summaryParts.push(`${skillsKept}/${skillsTotal} skills kept`);
  if (toolsTotal > 0) summaryParts.push(`${toolsKept}/${toolsTotal} tools kept`);
  const summaryCore = summaryParts.join(' · ');
  const tokenSuffix = tokensSaved > 0
    ? `${summaryCore ? ' · ' : ''}~${tokensSaved} tokens saved`
    : '';
  const summaryText = `${summaryCore}${tokenSuffix}`;

  const skillsDetail =
    hasSkillPruning
      ? 'Skills pruned by relevance score (low-scoring skills removed before injection)'
      : 'No skills were pruned';

  const toolsDetail =
    hasToolPruning
      ? 'Tools pruned by tier (only high-tier request_tools included)'
      : 'No tools were pruned';

  return (
    <div
      class={`pruning-banner${expanded ? ' pruning-banner-expanded' : ' pruning-banner-collapsed'}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
    >
      <div class="pruning-banner-summary">
        <span class="pruning-banner-icon" aria-hidden="true">✂</span>
        <span class="pruning-banner-text">{summaryText}</span>
        <span class="pruning-banner-chevron" aria-hidden="true">
          {expanded ? '▲' : '▼'}
        </span>
      </div>
      {expanded && (
        <div class="pruning-banner-detail">
          <div class="pruning-banner-detail-row">
            <span class="pruning-banner-hint">Skill pruning</span>
            <span class="pruning-banner-detail-text">{skillsDetail}</span>
          </div>
          <div class="pruning-banner-detail-row">
            <span class="pruning-banner-hint">Tool pruning</span>
            <span class="pruning-banner-detail-text">{toolsDetail}</span>
          </div>
        </div>
      )}
    </div>
  );
}