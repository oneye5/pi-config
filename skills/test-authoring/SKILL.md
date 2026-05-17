---
name: test-authoring
description: Guides writing effective tests for this project. Use when writing new tests, fixing broken tests, or adding regression coverage for bug fixes. Do not use for reviewing code, designing APIs, or writing application logic — this is exclusively for test implementation.
---

# Test Authoring

## Overview

Write maintainable, high-signal tests using Node.js built-in tooling. Tests should find bugs, not confirm happy paths.

## When to Use

- Writing new tests for any package
- Adding regression coverage for a bug fix
- Fixing broken or flaky tests
- Reviewing test quality

## Required Artifacts

- `test/*.test.ts` — Test files co-located with package code
- `test/helpers.ts` — Shared test utilities for the package
- `test/_helpers/` — Framework-specific helpers (extension uses this)

## Core Rules

**ALWAYS use:**
- `import test, { describe, it, beforeEach, afterEach } from 'node:test'`
- `import assert from 'node:assert/strict'`
- `tsx --test ./test/**/*.test.ts` for execution
- `npm run test -- --package <id>` to scope to one package

**NEVER use:**
- jest, vitest, or mocha
- chai, expect, should assertions
- Mock libraries outside node:test

## Test File Structure

```typescript
import assert from 'node:assert/strict';
import test, { describe, it, beforeEach } from 'node:test';

describe('UnitName', () => {
  // Optional shared state setup
  let subject: MyClass;

  beforeEach(() => {
    subject = new MyClass();
  });

  it('does expected thing', () => {
    const result = subject.doThing('input');
    assert.equal(result, 'expected');
  });

  it('handles empty input', () => {
    const result = subject.doThing('');
    assert.equal(result, '');
  });

  it('throws on invalid input', () => {
    assert.throws(() => subject.doThing(null!), /Null.*not allowed/);
  });
});
```

## Import Patterns

```typescript
// node:test primitives
import test, { describe, it, beforeEach, afterEach, mock } from 'node:test';

// Assertions — ALWAYS strict mode
import assert from 'node:assert/strict';
// NOT: import assert from 'node:assert' (permissive mode)

 // Mocking
import { mock } from 'node:test';
// Use mock.fn(), mock.method(), or t.mock.method() for auto-cleanup
```

## Test Naming

```typescript
// Good: describes the behavior, not the implementation
it('returns empty array when no results')
it('throws ValidationError when required field missing')
it('merges overlapping time ranges correctly')

// Bad: implementation-focused or vague
it('handles data')
it('test for function X')
it('returns correct value')
```

## Mocking with node:test

```typescript
test('calls callback with parsed result', (t) => {
  const handler = mock.fn((result: string) => result.toUpperCase());
  
  const parser = new ResultParser(handler);
  parser.parse('hello');

  assert.equal(handler.mock.calls.length, 1);
  assert.equal(handler.mock.calls[0].arguments[0], 'hello');
});
```

Use `t.mock.method()` when you need automatic cleanup after the test:
```typescript
it('retries on failure', (t) => {
  const retry = mock.fn(() => Promise.reject(new Error('fail')));
  t.mock.method(Math, 'random', () => 0.1); // auto-cleaned after test
});
```

## Test Structure: Arrange-Act-Assert

```typescript
it('correctly formats timestamp for display', () => {
  // Arrange
  const formatter = new TimestampFormatter('en-US');
  const timestamp = Date.parse('2026-05-17T12:00:00Z');

  // Act
  const formatted = formatter.format(timestamp);

  // Assert
  assert.equal(formatted, 'May 17, 2026, 12:00 PM');
  assert.match(formatted, /\d{1,2}:\d{2} [AP]M/);
});
```

## Edge Case Coverage

Write tests that break, not tests that confirm. Cover:
- Empty inputs, null, undefined
- Boundary values (0, -1, max int, empty string)
- Invalid inputs (wrong types, out-of-range values)
- Error paths and exceptions
- Concurrent/modified state

```typescript
// Edge case test example
it('handles concurrent state modification', async () => {
  const store = new Store();
  
  await Promise.all([
    store.update({ id: 1, value: 'a' }),
    store.update({ id: 1, value: 'b' }),
    store.update({ id: 1, value: 'c' }),
  ]);

  // At least one update should have been applied
  const final = await store.get(1);
  assert.ok(['a', 'b', 'c'].includes(final?.value));
});
```

## Extension Webview Tests

For UI components tested in the extension package, use `happy-dom` helpers:

```typescript
import { JSDOM } from 'happy-dom';
import { withDocument } from './test/_helpers/dom.ts';

test('button triggers handler on click', async () => {
  await withDocument(async (document) => {
    const btn = document.createElement('button');
    let clicked = false;
    btn.onclick = () => { clicked = true; };

    document.body.appendChild(btn);
    btn.click();

    assert.equal(clicked, true);
  });
});
```

## Test Isolation Rules

1. **No shared mutable state** between tests
2. **Each test is independent** — can run in any order
3. **Clean up side effects** in afterEach or use temp directories
4. **Don't depend on test execution order**

```typescript
describe('DataStore', () => {
  // Good: fresh instance per test
  let store: DataStore;

  beforeEach(() => {
    store = new DataStore();
  });

  // Good: isolated temp directory
  it('writes to disk correctly', async (t) => {
    const dir = await createTempDir();
    const store = new DataStore(dir);
    await store.save({ key: 'value' });
    assert.equal(await fs.readFile(path.join(dir, 'key.json')), '{"key":"value"}');
  });
});
```

## Running Tests

```bash
# Run all tests
npm run test

# Run specific package
npm run test -- --package analysis
npm run test -- --package extension

# With coverage
npm run test -- --package <id>
```

## Coverage Gates

Tests must pass the package's coverage thresholds. Check `run-tests.mjs` for current limits (typically 70% lines, 60% branches). If coverage fails:

1. Identify uncovered branches (look for "if" statements without coverage)
2. Add edge case tests for those branches
3. Don't mock too much — test real behavior

## Common Pitfalls

| Pitfall | Why It Fails | Fix |
|---------|-------------|-----|
| Testing happy path only | Misses edge cases users hit in production | Add empty/null/boundary tests |
| Mocking everything | Tests pass but code is broken | Test real behavior, mock only external I/O |
| Shared mutable state | Tests fail in random order | Reset state in beforeEach |
| Implementation detail testing | Tests break on refactor | Test observable behavior, not internals |
| Too many assertions in one test | Hard to diagnose failures | One logical assertion per test |
| No teardown | State leaks between tests | Use afterEach or temp directories |

## When a Test Fails

Tests verify code. If a test fails:

1. **Fix the code first** — not the test
2. The test is telling you the code has a bug
3. Only modify the test if the spec changed
4. "Failing tests are the spec" — they document expected behavior

```typescript
// Wrong: weakening assertions to pass
// assert.ok(result.length > 0);  // too weak
// assert.equal(result.length, 3);  // correct

// Wrong: removing edge case tests
// it('throws on null', () => { /* removed */ });

// Correct: fix the code until tests pass
// The test correctly caught a bug in the implementation
```

## Verification

- [ ] Test file is `*.test.ts` in the package's `test/` directory
- [ ] Uses `node:assert/strict` for all assertions
- [ ] Uses `node:test` primitives (describe, it, beforeEach, mock)
- [ ] Test names describe expected behavior, not implementation
- [ ] Tests use arrange-act-assert structure
- [ ] Edge cases covered (empty, null, invalid, boundary)
- [ ] Tests are isolated — no shared mutable state
- [ ] `npm run test -- --package <id>` passes
- [ ] Coverage thresholds met
- [ ] No flaky tests (run twice to verify)