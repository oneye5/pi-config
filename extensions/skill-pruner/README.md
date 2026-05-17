# skill-pruner

Reduces prompt noise by showing only the skills and tools most relevant to the current user prompt. Purely programmatic—no LLM calls.

## Behavior

### Skill Pruning (Phase 1)

- Scores each available skill using trigger phrases, keyword overlap, and skill-name matching
- Keeps a configurable floor/ceiling of visible skills
- Always includes pinned skills
- Adds a hidden recovery hint listing pruned skill names
- Logs pruning decisions and skill reads to `data/pruning.jsonl`

### Tool Pruning (Phase 2)

- Classifies tools into tiers: `core` (always active), `contextual` (scored and pruned), `rare` (off by default)
- Scores contextual tools using keyword overlap and name matching against the user prompt
- Expands dependency chains (e.g., if `edit` is active → force-include `read`)
- Respects a configurable ceiling for contextual tools
- Removes pruned tools from the active set for the current turn
- Provides a `request_tool` recovery tool so the agent can re-enable a pruned tool mid-turn

### UI Feedback

- Injects a `pruning-result` custom message after each user prompt showing what was pruned
- Compact view shows summary: "Pruned: Kept 3/8 skills, 4/6 tools · Saved ~310 tokens"
- Expanded view shows detailed included/excluded lists with color-coded rendering
- No message is injected when nothing is pruned (all skills included, no tool pruning)

## Configuration

Add an optional `pruning` block to the root `settings.json`:

```json
{
  "pruning": {
    "mode": "auto",
    "skills": {
      "ceiling": 5,
      "floor": 2,
      "scoreThreshold": 0.4,
      "gapThreshold": 0.3,
      "pinned": ["debugging-and-error-recovery"]
    },
    "tools": {
      "tiers": {
        "read": "core",
        "edit": "core",
        "write": "core",
        "bash": "core",
        "subagent": "contextual",
        "web_search": "contextual",
        "code_search": "contextual",
        "fetch_content": "contextual",
        "get_search_content": "contextual"
      },
      "dependencies": {
        "edit": ["read"],
        "subagent": ["bash"]
      },
      "ceiling": 5
    }
  }
}
```

If the `tools` block is missing, default tool tiers and dependencies are used. User-supplied tier values override defaults; unknown tool names are accepted (they default to `contextual` if not specified).

### Tool Tiers

- **core** — Always active. These tools are never pruned (e.g., `read`, `edit`, `write`, `bash`).
- **contextual** — Scored against the user prompt. Only the top-N contextual tools (up to `ceiling`) are kept active. The rest are pruned.
- **rare** — Off by default. Only available via the `request_tool` recovery tool.

### Dependencies

If a tool is active, its declared dependencies are also force-included. For example:
- If `edit` is active → `read` must also be active
- If `subagent` is active → `bash` must also be active

This prevents the agent from having tools that require other tools to function correctly.

## Modes

- **auto** — actively prunes skills and tools, modifies the system prompt, and adjusts the active tool set
- **shadow** — computes and logs pruning decisions but leaves the prompt and tool set unchanged
- **off** — disables pruning; skill reads are still logged as baseline data

## Recovery

### Skill Recovery

- Use `/skill:name` to explicitly request a pruned skill on the next turn
- Pin must-have skills in `settings.json`
- Switch `pruning.mode` to `shadow` to audit decisions without changing prompts
- Switch `pruning.mode` to `off` to disable the extension

### Tool Recovery

- The `request_tool` tool is always registered and available even when tools are pruned
- Call `request_tool` with a `toolName` parameter to re-enable a pruned tool for the remainder of the session
- Example: the agent may call `request_tool({ toolName: "web_search" })` when it needs web search capability

## Analysis (deferred)

A batch-analysis script is planned for Phase 1.5. It will read `data/pruning.jsonl`
across sessions and produce:

- Overall skill-miss rate (auto mode) and shadow-miss-candidate rate
- Comparative skill usage: skills read in `off` mode but not `auto` mode → pruning impact
- Per-skill miss frequency (often missed → description quality problem)
- Per-skill inclusion rate (always included → pinning candidate; never included → removal candidate)
- Score distribution histograms for threshold tuning
- Rolling 200-query window for rate stability
- Mode-comparison outcome analysis (auto vs off toggles)