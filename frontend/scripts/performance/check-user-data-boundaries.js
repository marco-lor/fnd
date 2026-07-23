#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {frontendRoot} = require('./common');

const defaultSourceRoot = path.join(frontendRoot, 'src');
const defaultBaselinePath = path.join(
  frontendRoot,
  'scripts',
  'task05',
  'legacy-user-access-baseline.json'
);
const sourcePattern = /\.[jt]sx?$/;
const testPattern = /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[jt]sx?$/;
const allowedRelativePaths = new Set([
  path.normalize('data/userData/userDataRepository.js'),
]);
// These aggregate writes are an explicit, stage-gated compatibility seam for
// legacy-read/shadow-verify. They must be removed before the new-only gate.
const legacyAdapterRelativePaths = new Set([
  path.normalize('data/userData/legacyUserDataCommands.js'),
]);
const BASELINE_SCHEMA_VERSION = 2;
const FIRESTORE_OPERATION_NAMES = new Set([
  'addDoc',
  'deleteDoc',
  'getDoc',
  'getDocs',
  'onSnapshot',
  'query',
  'setDoc',
  'updateDoc',
]);
const FIRESTORE_MEMBER_OPERATION_NAMES = new Set([
  'delete',
  'get',
  'getAll',
  'set',
  'update',
]);
const FIRESTORE_MUTATION_NAMES = new Set([
  'addDoc',
  'delete',
  'deleteDoc',
  'set',
  'setDoc',
  'update',
  'updateDoc',
]);

const directAccessPatterns = [
  {
    kind: 'modular-user-document',
    pattern: /\bdoc\s*\(\s*[^,\n]+,\s*(['"])users\1\s*,\s*[^,\n()]+\s*\)/g,
  },
  {
    kind: 'modular-users-collection',
    pattern: /\bcollection\s*\(\s*[^,\n]+,\s*(['"])users\1\s*\)/g,
  },
  {
    kind: 'template-user-document',
    pattern: /\b(?:doc|document)\s*\(\s*[^,\n]+,\s*`users\/\$\{[^}\n]+\}`\s*\)/g,
  },
  {
    kind: 'compat-users-collection',
    pattern: /\.collection\s*\(\s*(['"])users\1\s*\)/g,
  },
  {
    kind: 'compat-user-document',
    pattern: /\.doc\s*\(\s*`users\/\$\{[^}\n]+\}`\s*\)/g,
  },
];

const walk = (directoryPath) => fs.readdirSync(directoryPath, {withFileTypes: true})
  .flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    return sourcePattern.test(entry.name) ? [absolutePath] : [];
  });

const normalizeExpression = (expression) => expression.replace(/\s+/g, ' ').trim();
// Operation context is intentionally exact apart from platform line endings.
// Collapsing whitespace here would make payload values such as `'a  b'` and
// `'a b'` share a fingerprint even though Firestore would store different data.
const normalizeContextExpression = (expression) => expression
  .replace(/\r\n?/g, '\n')
  .trim();
const maskNonCode = (source) => {
  const chars = [...source];
  let state = 'code';
  let escaped = false;
  let regexCharacterClass = false;
  let previousSignificant = '';
  const canStartRegex = () => (
    !previousSignificant
    // `<` is deliberately excluded: in JSX, `</Element>` is a closing tag,
    // not a regular-expression literal.
    || /[=(:,!&|?{};\[\]+\-*%^~]/.test(previousSignificant)
  );

  for (let index = 0; index < chars.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (current === '\n') state = 'code';
      else chars[index] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      chars[index] = current === '\n' ? '\n' : ' ';
      if (current === '*' && next === '/') {
        chars[index + 1] = ' ';
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      chars[index] = current === '\n' ? '\n' : ' ';
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (
        (state === 'single' && current === "'")
        || (state === 'double' && current === '"')
        || (state === 'template' && current === '`')
      ) {
        state = 'code';
      }
      continue;
    }
    if (state === 'regex') {
      chars[index] = current === '\n' ? '\n' : ' ';
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '[') {
        regexCharacterClass = true;
      } else if (current === ']') {
        regexCharacterClass = false;
      } else if (current === '/' && !regexCharacterClass) {
        state = 'code';
      }
      continue;
    }
    if (current === '/' && next === '/') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      state = 'line-comment';
      continue;
    }
    if (current === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      state = 'block-comment';
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      chars[index] = ' ';
      state = current === "'" ? 'single' : current === '"' ? 'double' : 'template';
      escaped = false;
      continue;
    }
    // JSX self-closing tags (`/>`) can follow a quoted prop whose last code
    // token is `=`. Do not let that slash mask the remainder of the file as a
    // regular-expression literal.
    if (current === '/' && next !== '>' && canStartRegex()) {
      chars[index] = ' ';
      state = 'regex';
      escaped = false;
      regexCharacterClass = false;
      continue;
    }
    if (!/\s/.test(current)) previousSignificant = current;
  }
  return chars.join('');
};

const matchingParenIndex = (maskedSource, openIndex) => {
  let depth = 0;
  for (let index = openIndex; index < maskedSource.length; index += 1) {
    if (maskedSource[index] === '(') depth += 1;
    else if (maskedSource[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const splitCallArguments = (source, maskedSource, startIndex, endIndex) => {
  const argumentsFound = [];
  let argumentStart = startIndex;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    const current = maskedSource[index];
    if (current === '(') parenDepth += 1;
    else if (current === ')') parenDepth -= 1;
    else if (current === '[') bracketDepth += 1;
    else if (current === ']') bracketDepth -= 1;
    else if (current === '{') braceDepth += 1;
    else if (current === '}') braceDepth -= 1;
    else if (current === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      argumentsFound.push({
        start: argumentStart,
        end: index,
        expression: source.slice(argumentStart, index).trim(),
      });
      argumentStart = index + 1;
    }
  }
  const finalExpression = source.slice(argumentStart, endIndex).trim();
  if (finalExpression || argumentsFound.length) {
    argumentsFound.push({start: argumentStart, end: endIndex, expression: finalExpression});
  }
  return argumentsFound;
};

const collectCallExpressions = (source) => {
  const maskedSource = maskNonCode(source);
  const calls = [];
  const callPattern = /\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
  let match;
  while ((match = callPattern.exec(maskedSource)) !== null) {
    const openIndex = maskedSource.indexOf('(', match.index + match[1].length);
    const closeIndex = matchingParenIndex(maskedSource, openIndex);
    if (closeIndex < 0) continue;
    const callee = normalizeExpression(match[1]).replace(/\s*\.\s*/g, '.');
    const name = callee.split('.').pop();
    const memberCall = callee.includes('.');
    if (
      !FIRESTORE_OPERATION_NAMES.has(name)
      && !(memberCall && FIRESTORE_MEMBER_OPERATION_NAMES.has(name))
    ) continue;
    calls.push({
      start: match.index,
      end: closeIndex + 1,
      openIndex,
      closeIndex,
      callee,
      name,
      mutation: FIRESTORE_MUTATION_NAMES.has(name),
      args: splitCallArguments(source, maskedSource, openIndex + 1, closeIndex),
    });
  }
  return {calls, maskedSource};
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const expressionUsesIdentifier = (expression, identifier) => (
  new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(maskNonCode(expression))
);

const findBoundIdentifier = (source, maskedSource, expressionStart) => {
  const searchStart = Math.max(
    0,
    maskedSource.lastIndexOf(';', expressionStart - 1) + 1,
    maskedSource.lastIndexOf('{', expressionStart - 1) + 1,
    maskedSource.lastIndexOf('}', expressionStart - 1) + 1
  );
  const prefix = maskedSource.slice(searchStart, expressionStart);
  const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/;
  const declaration = prefix.match(declarationPattern);
  if (declaration) return declaration[1];
  const assignmentPattern = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/;
  return prefix.match(assignmentPattern)?.[1] || null;
};

const findStatementEnd = (maskedSource, startIndex, limitIndex) => {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = startIndex; index < limitIndex; index += 1) {
    const current = maskedSource[index];
    if (current === '(') parenDepth += 1;
    else if (current === ')') parenDepth -= 1;
    else if (current === '[') bracketDepth += 1;
    else if (current === ']') bracketDepth -= 1;
    else if (current === '{') braceDepth += 1;
    else if (current === '}') braceDepth -= 1;
    else if (current === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index + 1;
    }
  }
  return limitIndex;
};

const findPayloadBinding = (source, maskedSource, identifier, beforeIndex) => {
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(identifier)}\\s*=`, 'g');
  let latest = null;
  let match;
  while ((match = pattern.exec(maskedSource)) !== null && match.index < beforeIndex) latest = match;
  if (!latest) return null;
  const declarationEnd = findStatementEnd(maskedSource, latest.index, beforeIndex);
  const statements = [source.slice(latest.index, declarationEnd)];
  const assignmentPattern = new RegExp(
    `\\b${escapeRegExp(identifier)}(?:\\s*(?:\\.\\s*[A-Za-z_$][\\w$]*|\\[[^\\]\\n]+\\]))*\\s*=(?!=)`,
    'g'
  );
  assignmentPattern.lastIndex = declarationEnd;
  while ((match = assignmentPattern.exec(maskedSource)) !== null && match.index < beforeIndex) {
    const assignmentEnd = findStatementEnd(maskedSource, match.index, beforeIndex);
    statements.push(source.slice(match.index, assignmentEnd));
    assignmentPattern.lastIndex = Math.max(assignmentEnd, match.index + 1);
  }
  // Bind the initializer and subsequent direct assignments. This catches a
  // payload assembled over several statements without including unrelated
  // control flow, logging, or comments between those statements.
  return statements.map(normalizeContextExpression).join('\n');
};

const operationDescriptor = (source, maskedSource, call) => {
  const args = call.args.map(({expression}) => normalizeContextExpression(expression));
  const descriptor = {
    kind: call.mutation ? 'mutation' : (call.name === 'onSnapshot' ? 'subscription' : 'read'),
    operation: call.callee,
    target: args[0] || '',
  };
  if (call.name === 'query') descriptor.kind = 'query';
  if (call.mutation) {
    descriptor.payload = args.slice(1);
    descriptor.payloadBindings = call.args.slice(1)
      .map(({expression}) => expression.trim())
      .filter((expression) => /^[A-Za-z_$][\w$]*$/.test(expression))
      .map((identifier) => findPayloadBinding(source, maskedSource, identifier, call.start))
      .filter(Boolean);
  } else if (call.name === 'query' || call.name === 'getAll') {
    descriptor.arguments = args.slice(1);
  }
  return descriptor;
};

const collectOperationsForAccess = (source, match, calls, maskedSource) => {
  const relevantCalls = new Map();
  const identifiers = new Set();
  const boundIdentifier = findBoundIdentifier(source, maskedSource, match.index);
  if (boundIdentifier) identifiers.add(boundIdentifier);

  calls.forEach((call) => {
    if (call.start <= match.index && call.end >= match.endIndex) {
      relevantCalls.set(`${call.start}:${call.end}`, call);
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    calls.forEach((call) => {
      const usesTrackedIdentifier = [...identifiers].some((identifier) => (
        call.args.some(({expression}) => expressionUsesIdentifier(expression, identifier))
      ));
      if (!usesTrackedIdentifier) return;
      const key = `${call.start}:${call.end}`;
      if (!relevantCalls.has(key)) {
        relevantCalls.set(key, call);
        changed = true;
      }
      // `query(collectionRef, ...)` returns another Firestore reference. Read
      // and mutation calls return values/promises rather than references, so
      // treating those results as aliases would attach unrelated operations.
      const alias = call.name === 'query'
        ? findBoundIdentifier(source, maskedSource, call.start)
        : null;
      if (alias && !identifiers.has(alias)) {
        identifiers.add(alias);
        changed = true;
      }
    });
  }

  return {
    binding: boundIdentifier,
    operations: [...relevantCalls.values()]
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .map((call) => operationDescriptor(source, maskedSource, call)),
  };
};

const fingerprintAccessContexts = (matches) => crypto.createHash('sha256')
  .update(JSON.stringify(matches.map(({kind, expression, binding, operations}) => ({
    kind,
    expression,
    binding: binding || null,
    operations,
  }))))
  .digest('hex');

const findDirectAccessesInSource = (source) => {
  const matches = [];
  for (const {kind, pattern} of directAccessPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      matches.push({
        kind,
        expression: normalizeExpression(match[0]),
        line: source.slice(0, match.index).split('\n').length,
        index: match.index,
        endIndex: match.index + match[0].length,
      });
    }
    pattern.lastIndex = 0;
  }
  const sortedMatches = matches.sort((left, right) => (
    left.line - right.line
    || left.kind.localeCompare(right.kind)
    || left.expression.localeCompare(right.expression)
  ));
  const {calls, maskedSource} = collectCallExpressions(source);
  return sortedMatches.map((match) => ({
    ...match,
    ...collectOperationsForAccess(source, match, calls, maskedSource),
  }));
};

const scanDirectUserAccesses = (sourceRoot = defaultSourceRoot) => walk(sourceRoot)
  .filter((filePath) => !testPattern.test(filePath))
  .filter((filePath) => !allowedRelativePaths.has(path.normalize(path.relative(sourceRoot, filePath))))
  .filter((filePath) => !legacyAdapterRelativePaths.has(path.normalize(path.relative(sourceRoot, filePath))))
  .map((filePath) => {
    const matches = findDirectAccessesInSource(fs.readFileSync(filePath, 'utf8'));
    return {
      path: path.relative(sourceRoot, filePath).replaceAll('\\', '/'),
      count: matches.length,
      operationCount: matches.reduce((count, match) => count + match.operations.length, 0),
      contextFingerprint: fingerprintAccessContexts(matches),
      matches,
    };
  })
  .filter(({count}) => count > 0)
  .sort((left, right) => left.path.localeCompare(right.path));

const createBaseline = (accesses) => ({
  schemaVersion: BASELINE_SCHEMA_VERSION,
  purpose: 'Temporary Task 05 legacy aggregate accesses. Reference, operation, and mutation payload context are locked; new or changed accesses fail CI.',
  entries: accesses.map(({path: relativePath, count, operationCount, contextFingerprint}) => ({
    path: relativePath,
    count,
    operationCount,
    contextFingerprint,
  })),
});

const readBaseline = (baselinePath = defaultBaselinePath) => {
  if (!fs.existsSync(baselinePath)) throw new Error(`Legacy access baseline is missing: ${baselinePath}`);
  const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (parsed?.schemaVersion !== BASELINE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
    throw new Error('Legacy access baseline has an unsupported schema.');
  }
  if (parsed.entries.some((entry) => (
    typeof entry?.path !== 'string'
    || !Number.isInteger(entry.count)
    || !Number.isInteger(entry.operationCount)
    || typeof entry.contextFingerprint !== 'string'
  ))) throw new Error('Legacy access baseline has an invalid context entry.');
  return parsed;
};

const compareWithBaseline = (accesses, baseline) => {
  const current = new Map(accesses.map((entry) => [entry.path, entry]));
  const approved = new Map(baseline.entries.map((entry) => [entry.path, entry]));
  const violations = [];
  for (const access of accesses) {
    const entry = approved.get(access.path);
    if (!entry) {
      violations.push({path: access.path, reason: 'new-direct-access', count: access.count});
    } else if (
      entry.count !== access.count
      || entry.operationCount !== access.operationCount
      || entry.contextFingerprint !== access.contextFingerprint
    ) {
      violations.push({
        path: access.path,
        reason: 'legacy-access-changed',
        expectedCount: entry.count,
        actualCount: access.count,
        expectedOperationCount: entry.operationCount,
        actualOperationCount: access.operationCount,
      });
    }
  }
  for (const entry of baseline.entries) {
    if (!current.has(entry.path)) {
      violations.push({path: entry.path, reason: 'stale-baseline-entry'});
    }
  }
  return violations.sort((left, right) => left.path.localeCompare(right.path));
};

const main = () => {
  const printBaseline = process.argv.includes('--print-baseline');
  const accesses = scanDirectUserAccesses();
  if (printBaseline) {
    console.log(JSON.stringify(createBaseline(accesses), null, 2));
    return;
  }
  const baseline = readBaseline();
  const violations = compareWithBaseline(accesses, baseline);
  if (violations.length) {
    console.error('Task 05 direct users/{uid} access boundary changed:');
    for (const violation of violations) {
      console.error(` - ${violation.path}: ${violation.reason}`);
    }
    console.error('Use the V2 user-data repository. Remove stale baseline entries as legacy access is migrated.');
    process.exitCode = 1;
    return;
  }
  console.log(
    `Task 05 user-data boundary is stable (${accesses.length} explicitly tracked legacy files; reference operations and mutation payloads locked; ${legacyAdapterRelativePaths.size} stage-gated legacy adapter; no new direct access).`
  );
};

if (require.main === module) main();

module.exports = {
  allowedRelativePaths,
  BASELINE_SCHEMA_VERSION,
  legacyAdapterRelativePaths,
  collectCallExpressions,
  collectOperationsForAccess,
  compareWithBaseline,
  createBaseline,
  findDirectAccessesInSource,
  fingerprintAccessContexts,
  main,
  readBaseline,
  scanDirectUserAccesses,
};
