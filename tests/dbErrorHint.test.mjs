import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/dbErrorHint.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleExports = {};
new Function('exports', compiled)(moduleExports);
const { classifyDbError } = moduleExports;

test('rejected keys point at the API key, not the migrations', () => {
  assert.equal(classifyDbError('Unregistered API key'), 'key');
  assert.equal(classifyDbError('Invalid API key'), 'key');
  assert.equal(classifyDbError('No API key found in request'), 'key');
  assert.equal(classifyDbError('JWSError JWSInvalidSignature'), 'key');
});

test('missing tables point at the migrations', () => {
  assert.equal(classifyDbError('relation "public.family_members" does not exist'), 'schema');
  assert.equal(
    classifyDbError("Could not find the table 'public.family_members' in the schema cache"),
    'schema',
  );
});

test('network failures and anything else', () => {
  assert.equal(classifyDbError('TypeError: Failed to fetch'), 'network');
  assert.equal(classifyDbError('Load failed'), 'network');
  assert.equal(classifyDbError('permission denied for table family_members'), 'unknown');
});
