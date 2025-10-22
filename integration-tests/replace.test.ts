/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig } from './test-helper.js';

describe('replace', () => {
  it('should be able to replace content in a file', async () => {
    const rig = new TestRig();
    await rig.setup('should be able to replace content in a file');

    const fileName = 'file_to_replace.txt';
    const originalContent = 'foo content';
    const expectedContent = 'bar content';

    rig.createFile(fileName, originalContent);

    await rig.run(`Replace 'foo' with 'bar' in the file 'file_to_replace.txt'`);

    const foundToolCall = await rig.waitForToolCall('replace');
    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

    expect(rig.readFile(fileName)).toContain(expectedContent);
    expect(rig.readFile(fileName)).not.toContain('foo');
  });

  it('should handle $ literally when replacing text ending with $', async () => {
    const rig = new TestRig();
    await rig.setup(
      'should handle $ literally when replacing text ending with $',
    );

    const fileName = 'regex.yml';
    const originalContent = "| select('match', '^[sv]d[a-z]$')";
    const expectedContent = "| select('match', '^[sv]d[a-z]$') # updated";

    rig.createFile(fileName, originalContent);

    await rig.run(
      `In the file ${fileName}, find the line with the *exact* content: "${originalContent}" and replace that entire line with the *exact* content: "${expectedContent}".`,
    );

    const foundToolCall = await rig.waitForToolCall('replace');
    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

    const newContent = rig.readFile(fileName);
    const trimmedContent = newContent.trim();
    expect(trimmedContent).toContain(expectedContent);
    expect(trimmedContent).not.toBe(originalContent);
  });

  it('should insert a multi-line block of text', async () => {
    const rig = new TestRig();
    await rig.setup('should insert a multi-line block of text');
    const fileName = 'insert_block.txt';
    const originalContent = 'Line A\n<INSERT_TEXT_HERE>\nLine C';
    const newBlock = 'First line\nSecond line\nThird line';

    rig.createFile(fileName, originalContent);
    const prompt = `In ${fileName}, replace the exact string "<INSERT_TEXT_HERE>" with the following multi-line text block:
  \`\`\`
  First line
  Second line
  Third line
  \`\`\``;
    await rig.run(prompt);

    const foundToolCall = await rig.waitForToolCall('replace');
    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

    const newContent = rig.readFile(fileName);
    expect(newContent).toContain('Line A');
    expect(newContent).toContain('Line C');
    expect(newContent).toContain('First line');
    expect(newContent).toContain('Second line');
    expect(newContent).toContain('Third line');
    expect(newContent).not.toContain('<INSERT_TEXT_HERE>');
    expect(newContent).toContain(newBlock);
  });

  it('should delete a block of text', async () => {
    const rig = new TestRig();
    await rig.setup('should delete a block of text');
    const fileName = 'delete_block.txt';
    const blockToDelete =
      '## DELETE THIS ##\nThis is a block of text to delete.\n## END DELETE ##';
    const originalContent = `Hello\n${blockToDelete}\nWorld`;
    rig.createFile(fileName, originalContent);

    await rig.run(
      `In ${fileName}, **replace** the entire block of text that starts with "## DELETE THIS ##" and ends with "## END DELETE ##" **with an empty string**. The replacement must include both the markers and all text located between them.`,
    );

    const foundToolCall = await rig.waitForToolCall('replace');
    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

    const newContent = rig.readFile(fileName);
    expect(newContent).not.toContain('## DELETE THIS ##');
    expect(newContent).not.toContain('This is a block of text to delete.');
    expect(newContent).not.toContain('## END DELETE ##');
    expect(newContent).toContain('Hello');
    expect(newContent).toContain('World');
  });
});
