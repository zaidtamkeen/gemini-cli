/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GEMINI_CLI_PATH = join(
  __dirname,
  '..',
  'packages',
  'cli',
  'dist',
  'index.js',
);

test('should exit with a non-zero status code on API error', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Internal Server Error' } }));
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  const args = ['--prompt', 'test prompt'];

  const child = spawn('node', [GEMINI_CLI_PATH, ...args], {
    env: {
      ...process.env,
      GEMINI_API_ENDPOINT: `http://localhost:${port}`,
    },
  });

  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

  server.close();

  expect(stderr).toContain('An API error occurred: 500 Internal Server Error');
  expect(exitCode).not.toBe(0);
});
