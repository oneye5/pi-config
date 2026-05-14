-- Compare prompt/tool/skill treatment mixes with sample counts.
SELECT
  COALESCE(prompt_family, '(none)') AS prompt_family,
  prompt_hash_prefix,
  tool_set_hash_prefix,
  skill_set_hash_prefix,
  COALESCE(experiment_assignment, '(none)') AS experiment_assignment,
  mixed_treatment_config,
  COUNT(*) AS run_count,
  COUNT(*) FILTER (WHERE satisfaction IS NOT NULL) AS scored_run_count,
  ROUND(AVG(satisfaction), 2) AS average_satisfaction,
  COUNT(*) FILTER (WHERE resolution = 'resolved') AS resolved_count,
  COUNT(*) FILTER (WHERE resolution = 'partially_resolved') AS partially_resolved_count,
  COUNT(*) FILTER (WHERE resolution = 'unresolved') AS unresolved_count
FROM runs
WHERE status <> 'open'
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY run_count DESC, prompt_family, experiment_assignment;
