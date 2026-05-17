import path from 'node:path';

const REPORT_PREFIX = '__PI_TEST_SUMMARY__';

function normalizeSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const counts = summary.counts && typeof summary.counts === 'object'
    ? {
        tests: Number(summary.counts.tests ?? 0),
        failed: Number(summary.counts.failed ?? 0),
        passed: Number(summary.counts.passed ?? 0),
        cancelled: Number(summary.counts.cancelled ?? 0),
        skipped: Number(summary.counts.skipped ?? 0),
        todo: Number(summary.counts.todo ?? 0),
        topLevel: Number(summary.counts.topLevel ?? 0),
        suites: Number(summary.counts.suites ?? 0),
      }
    : null;

  return {
    success: Boolean(summary.success),
    counts,
    durationMs: Number(summary.duration_ms ?? 0),
  };
}

function aggregateFileSummaries(fileSummaries) {
  if (fileSummaries.length === 0) {
    return null;
  }

  const counts = {
    tests: 0,
    failed: 0,
    passed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    topLevel: 0,
    suites: 0,
  };

  let durationMs = 0;
  for (const summary of fileSummaries) {
    const normalized = normalizeSummary(summary);
    if (!normalized?.counts) {
      continue;
    }
    counts.tests += normalized.counts.tests;
    counts.failed += normalized.counts.failed;
    counts.passed += normalized.counts.passed;
    counts.cancelled += normalized.counts.cancelled;
    counts.skipped += normalized.counts.skipped;
    counts.todo += normalized.counts.todo;
    counts.topLevel += normalized.counts.topLevel;
    counts.suites += normalized.counts.suites;
    durationMs += normalized.durationMs;
  }

  return {
    success: counts.failed === 0 && counts.cancelled === 0,
    counts,
    durationMs,
  };
}

function normalizeCoverage(coverageSummary) {
  const totals = coverageSummary?.totals;
  if (!totals || typeof totals !== 'object') {
    return null;
  }

  return {
    totalLineCount: Number(totals.totalLineCount ?? 0),
    totalBranchCount: Number(totals.totalBranchCount ?? 0),
    totalFunctionCount: Number(totals.totalFunctionCount ?? 0),
    coveredLineCount: Number(totals.coveredLineCount ?? 0),
    coveredBranchCount: Number(totals.coveredBranchCount ?? 0),
    coveredFunctionCount: Number(totals.coveredFunctionCount ?? 0),
    coveredLinePercent: Number(totals.coveredLinePercent ?? 0),
    coveredBranchPercent: Number(totals.coveredBranchPercent ?? 0),
    coveredFunctionPercent: Number(totals.coveredFunctionPercent ?? 0),
  };
}

function resolveFailureMessage(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const cause = error.cause;
  if (cause && typeof cause === 'object' && typeof cause.message === 'string' && cause.message.trim().length > 0) {
    return cause.message.trim();
  }

  if (typeof cause === 'string' && cause.trim().length > 0 && cause !== 'test failed') {
    return cause.trim();
  }

  if (typeof error.message === 'string' && error.message.trim().length > 0 && error.message !== 'test failed') {
    return error.message.trim();
  }

  if (typeof error.code === 'string' && error.code.length > 0) {
    return error.code;
  }

  return null;
}

function normalizeFailure(data) {
  const details = data?.details && typeof data.details === 'object' ? data.details : {};
  const error = details.error && typeof details.error === 'object' ? details.error : null;

  return {
    name: typeof data?.name === 'string' ? data.name : '(unnamed test)',
    file: typeof data?.file === 'string' ? data.file : null,
    line: Number.isInteger(data?.line) ? data.line : null,
    column: Number.isInteger(data?.column) ? data.column : null,
    durationMs: Number(details.duration_ms ?? 0),
    failureType: typeof error?.failureType === 'string' ? error.failureType : null,
    code: typeof error?.code === 'string' ? error.code : null,
    message: resolveFailureMessage(error),
  };
}

function normalizePathForComparison(value) {
  return typeof value === 'string' ? value.replace(/\\/g, '/').toLowerCase() : '';
}

function isWrapperFailure(failure) {
  const file = normalizePathForComparison(failure.file);
  const name = normalizePathForComparison(failure.name);
  if (!file || !name) {
    return false;
  }

  if (name === file) {
    return true;
  }

  const basename = path.posix.basename(file);
  return name === basename || name.endsWith(`/${basename}`);
}

function dedupeFailures(failures) {
  const seen = new Set();
  const deduped = [];
  for (const failure of failures) {
    const key = [failure.name, failure.file ?? '', failure.line ?? '', failure.column ?? ''].join('::');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(failure);
  }
  return deduped;
}

function finalizeFailures(failures) {
  const deduped = dedupeFailures(failures);
  const hasSpecificFailure = deduped.some((failure) => !isWrapperFailure(failure));
  return hasSpecificFailure ? deduped.filter((failure) => !isWrapperFailure(failure)) : deduped;
}

export default async function* reporter(source) {
  const failures = [];
  const fileSummaries = [];
  let globalSummary = null;
  let coverage = null;

  for await (const event of source) {
    switch (event.type) {
      case 'test:fail':
        failures.push(normalizeFailure(event.data));
        break;
      case 'test:summary':
        if (event.data?.file === undefined) {
          globalSummary = normalizeSummary(event.data);
        } else {
          fileSummaries.push(event.data);
        }
        break;
      case 'test:coverage':
        coverage = normalizeCoverage(event.data?.summary);
        break;
      default:
        break;
    }
  }

  const summary = globalSummary ?? aggregateFileSummaries(fileSummaries);
  const report = {
    summary,
    coverage,
    failures: finalizeFailures(failures),
  };

  yield `${REPORT_PREFIX}${JSON.stringify(report)}\n`;
}
