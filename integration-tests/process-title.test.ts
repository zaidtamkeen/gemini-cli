/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig, poll } from './test-helper.js';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';

const EXPECTED_TITLE = 'gemini-cli';

const isWindows = os.platform() === 'win32';

// Windows Task Manager ignores process.title overrides for node.exe, so we skip there.
(isWindows ? describe.skip : describe)('process title', () => {
  it('exposes gemini-cli process name in system process list', async () => {
    const rig = new TestRig();
    await rig.setup('process title integration test', {
      settings: { tools: { useRipgrep: false } },
    });

    const run = await rig.runInteractive();
    const pid = run.ptyProcess.pid;

    const foundTitle = await poll(
      () => {
        try {
          const output = execFileSync(
            'ps',
            ['-p', String(pid), '-o', 'comm='],
            { encoding: 'utf-8' },
          );
          const name = output.trim();
          return name === EXPECTED_TITLE;
        } catch {
          return false;
        }
      },
      10000,
      200,
    );

    expect(
      foundTitle,
      `Expected process ${pid} to appear as ${EXPECTED_TITLE}`,
    ).toBe(true);

    run.sendKeys('\x03');
    await run.expectText('Press Ctrl+C again to exit', 5000);
    run.sendKeys('\x03');
    const exitCode = await run.expectExit();
    expect(exitCode).toBe(0);
  });
});
