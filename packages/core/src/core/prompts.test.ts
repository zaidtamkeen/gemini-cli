/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCoreSystemPrompt, resolvePathFromEnv } from './prompts.js';
import { isGitRepository } from '../utils/gitUtils.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../config/config.js';
import { CodebaseInvestigatorAgent } from '../agents/codebase-investigator.js';
import { GEMINI_DIR } from '../utils/paths.js';

// Mock tool names if they are dynamically generated or complex
vi.mock('../tools/ls', () => ({ LSTool: { Name: 'list_directory' } }));
vi.mock('../tools/edit', () => ({ EditTool: { Name: 'replace' } }));
vi.mock('../tools/glob', () => ({ GlobTool: { Name: 'glob' } }));
vi.mock('../tools/grep', () => ({ GrepTool: { Name: 'search_file_content' } }));
vi.mock('../tools/read-file', () => ({ ReadFileTool: { Name: 'read_file' } }));
vi.mock('../tools/read-many-files', () => ({
  ReadManyFilesTool: { Name: 'read_many_files' },
}));
vi.mock('../tools/shell', () => ({
  ShellTool: { Name: 'run_shell_command' },
}));
vi.mock('../tools/write-file', () => ({
  WriteFileTool: { Name: 'write_file' },
}));
vi.mock('../agents/codebase-investigator.js', () => ({
  CodebaseInvestigatorAgent: { name: 'codebase_investigator' },
}));
vi.mock('../utils/gitUtils', () => ({
  isGitRepository: vi.fn(),
}));
vi.mock('node:fs');

describe('Core System Prompt (prompts.ts)', () => {
  let mockConfig: Config;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('GEMINI_SYSTEM_MD', undefined);
    vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', undefined);
    mockConfig = {
      getToolRegistry: vi.fn().mockReturnValue({
        getAllToolNames: vi.fn().mockReturnValue([]),
      }),
      getEnableShellOutputEfficiency: vi.fn().mockReturnValue(true),
      storage: {
        getProjectTempDir: vi.fn().mockReturnValue('/tmp/project-temp'),
      },
      isInteractive: vi.fn().mockReturnValue(true),
      isInteractiveShellEnabled: vi.fn().mockReturnValue(true),
    } as unknown as Config;
  });

  describe('user memory', () => {
    it.each([
      {
        name: 'should not include separator when no userMemory is provided',
        memory: undefined,
        shouldContain: [],
        shouldNotContain: ['---\n\n'],
      },
      {
        name: 'should not include separator when userMemory is an empty string',
        memory: '',
        shouldContain: [],
        shouldNotContain: ['---\n\n'],
      },
      {
        name: 'should not include separator when userMemory is whitespace',
        memory: '   \n  \t ',
        shouldContain: [],
        shouldNotContain: ['---\n\n'],
      },
      {
        name: 'should append userMemory with separator when provided',
        memory: 'This is custom user memory.\nBe extra polite.',
        shouldContain: [
          'You are an interactive CLI agent',
          '\n\n---\n\nThis is custom user memory.\nBe extra polite.',
        ],
        shouldNotContain: [],
      },
    ])('$name', ({ memory, shouldContain, shouldNotContain }) => {
      const prompt = getCoreSystemPrompt(mockConfig, memory);
      for (const text of shouldContain) {
        expect(prompt).toContain(text);
      }
      for (const text of shouldNotContain) {
        expect(prompt).not.toContain(text);
      }
      expect(prompt).toMatchSnapshot();
    });
  });

  describe('prompt content', () => {
    it.each([
      {
        name: 'should include sandbox instructions when SANDBOX is "true"',
        sandboxEnv: 'true',
        isGitRepo: false,
        shouldContain: ['# Sandbox'],
        shouldNotContain: ['# macOS Seatbelt', '# Outside of Sandbox'],
      },
      {
        name: 'should include seatbelt instructions when SANDBOX is "sandbox-exec"',
        sandboxEnv: 'sandbox-exec',
        isGitRepo: false,
        shouldContain: ['# macOS Seatbelt'],
        shouldNotContain: ['# Sandbox', '# Outside of Sandbox'],
      },
      {
        name: 'should include non-sandbox instructions when SANDBOX is not set',
        sandboxEnv: undefined,
        isGitRepo: false,
        shouldContain: ['# Outside of Sandbox'],
        shouldNotContain: ['# Sandbox', '# macOS Seatbelt'],
      },
      {
        name: 'should include git instructions when in a git repo',
        sandboxEnv: undefined,
        isGitRepo: true,
        shouldContain: ['# Git Repository'],
        shouldNotContain: [],
      },
      {
        name: 'should not include git instructions when not in a git repo',
        sandboxEnv: undefined,
        isGitRepo: false,
        shouldContain: [],
        shouldNotContain: ['# Git Repository'],
      },
    ])(
      '$name',
      ({ sandboxEnv, isGitRepo, shouldContain, shouldNotContain }) => {
        vi.stubEnv('SANDBOX', sandboxEnv);
        vi.mocked(isGitRepository).mockReturnValue(isGitRepo);
        const prompt = getCoreSystemPrompt(mockConfig);
        for (const text of shouldContain) {
          expect(prompt).toContain(text);
        }
        for (const text of shouldNotContain) {
          expect(prompt).not.toContain(text);
        }
        expect(prompt).toMatchSnapshot();
      },
    );
  });

  it('should return the interactive avoidance prompt when in non-interactive mode', () => {
    vi.stubEnv('SANDBOX', undefined);
    mockConfig.isInteractive = vi.fn().mockReturnValue(false);
    const prompt = getCoreSystemPrompt(mockConfig, '');
    expect(prompt).toContain('**Interactive Commands:**'); // Check for interactive prompt
    expect(prompt).toMatchSnapshot(); // Use snapshot for base prompt structure
  });

  describe('with CodebaseInvestigator enabled', () => {
    beforeEach(() => {
      mockConfig = {
        getToolRegistry: vi.fn().mockReturnValue({
          getAllToolNames: vi
            .fn()
            .mockReturnValue([CodebaseInvestigatorAgent.name]),
        }),
        getEnableShellOutputEfficiency: vi.fn().mockReturnValue(true),
        storage: {
          getProjectTempDir: vi.fn().mockReturnValue('/tmp/project-temp'),
        },
        isInteractive: vi.fn().mockReturnValue(false),
        isInteractiveShellEnabled: vi.fn().mockReturnValue(false),
      } as unknown as Config;
    });

    it('should include CodebaseInvestigator instructions in the prompt', () => {
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain(
        `your **first and primary tool** must be '${CodebaseInvestigatorAgent.name}'`,
      );
      expect(prompt).toContain(
        `do not ignore the output of '${CodebaseInvestigatorAgent.name}'`,
      );
      expect(prompt).not.toContain(
        "Use 'search_file_content' and 'glob' search tools extensively",
      );
    });
  });

  describe('with CodebaseInvestigator disabled', () => {
    // No beforeEach needed, will use the default from the parent describe
    it('should include standard tool instructions in the prompt', () => {
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).not.toContain(
        `your **first and primary tool** must be '${CodebaseInvestigatorAgent.name}'`,
      );
      expect(prompt).toContain(
        "Use 'search_file_content' and 'glob' search tools extensively",
      );
    });
  });

  describe('GEMINI_SYSTEM_MD environment variable', () => {
    it.each([
      { name: 'false', value: 'false', shouldRead: false },
      { name: '0', value: '0', shouldRead: false },
      {
        name: 'true',
        value: 'true',
        shouldRead: true,
        path: path.resolve(path.join(GEMINI_DIR, 'system.md')),
      },
      {
        name: '1',
        value: '1',
        shouldRead: true,
        path: path.resolve(path.join(GEMINI_DIR, 'system.md')),
      },
    ])(
      "should handle GEMINI_SYSTEM_MD='$value'",
      ({ value, shouldRead, path }) => {
        vi.stubEnv('GEMINI_SYSTEM_MD', value);
        if (shouldRead) {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue('custom system prompt');
          const prompt = getCoreSystemPrompt(mockConfig);
          expect(fs.readFileSync).toHaveBeenCalledWith(path, 'utf8');
          expect(prompt).toBe('custom system prompt');
        } else {
          const prompt = getCoreSystemPrompt(mockConfig);
          expect(fs.readFileSync).not.toHaveBeenCalled();
          expect(prompt).not.toContain('custom system prompt');
        }
      },
    );

    it('should read from custom path when GEMINI_SYSTEM_MD provides one, preserving case', () => {
      const customPath = path.resolve('/custom/path/SyStEm.Md');
      vi.stubEnv('GEMINI_SYSTEM_MD', customPath);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('custom system prompt');

      const prompt = getCoreSystemPrompt(mockConfig);
      expect(fs.readFileSync).toHaveBeenCalledWith(customPath, 'utf8');
      expect(prompt).toBe('custom system prompt');
    });

    it('should expand tilde in custom path when GEMINI_SYSTEM_MD is set', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
      const customPath = '~/custom/system.md';
      const expectedPath = path.join(homeDir, 'custom/system.md');
      vi.stubEnv('GEMINI_SYSTEM_MD', customPath);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('custom system prompt');

      const prompt = getCoreSystemPrompt(mockConfig);
      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.resolve(expectedPath),
        'utf8',
      );
      expect(prompt).toBe('custom system prompt');
    });
  });

  describe('GEMINI_WRITE_SYSTEM_MD environment variable', () => {
    it.each([
      { name: 'false', value: 'false', shouldWrite: false },
      { name: '0', value: '0', shouldWrite: false },
      {
        name: 'true',
        value: 'true',
        shouldWrite: true,
        path: path.resolve(path.join(GEMINI_DIR, 'system.md')),
      },
      {
        name: '1',
        value: '1',
        shouldWrite: true,
        path: path.resolve(path.join(GEMINI_DIR, 'system.md')),
      },
    ])(
      "should handle GEMINI_WRITE_SYSTEM_MD='$value'",
      ({ value, shouldWrite, path }) => {
        vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', value);
        getCoreSystemPrompt(mockConfig);
        if (shouldWrite) {
          expect(fs.writeFileSync).toHaveBeenCalledWith(
            path,
            expect.any(String),
          );
        } else {
          expect(fs.writeFileSync).not.toHaveBeenCalled();
        }
      },
    );

    it('should write to custom path when GEMINI_WRITE_SYSTEM_MD provides one', () => {
      const customPath = path.resolve('/custom/path/system.md');
      vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', customPath);
      getCoreSystemPrompt(mockConfig);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        customPath,
        expect.any(String),
      );
    });

    it('should expand tilde in custom path when GEMINI_WRITE_SYSTEM_MD is set', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
      const customPath = '~/custom/system.md';
      const expectedPath = path.join(homeDir, 'custom/system.md');
      vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', customPath);
      getCoreSystemPrompt(mockConfig);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(expectedPath),
        expect.any(String),
      );
    });

    it('should expand tilde in custom path when GEMINI_WRITE_SYSTEM_MD is just ~', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
      const customPath = '~';
      const expectedPath = homeDir;
      vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', customPath);
      getCoreSystemPrompt(mockConfig);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(expectedPath),
        expect.any(String),
      );
    });
  });
});

describe('resolvePathFromEnv helper function', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('when envVar is undefined, empty, whitespace, or boolean-like', () => {
    it.each([
      {
        name: 'undefined',
        value: undefined,
        expected: { isSwitch: false, value: null, isDisabled: false },
      },
      {
        name: 'empty string',
        value: '',
        expected: { isSwitch: false, value: null, isDisabled: false },
      },
      {
        name: 'whitespace only',
        value: '   \n\t  ',
        expected: { isSwitch: false, value: null, isDisabled: false },
      },
      {
        name: '"0"',
        value: '0',
        expected: { isSwitch: true, value: '0', isDisabled: true },
      },
      {
        name: '"false"',
        value: 'false',
        expected: { isSwitch: true, value: 'false', isDisabled: true },
      },
      {
        name: '"1"',
        value: '1',
        expected: { isSwitch: true, value: '1', isDisabled: false },
      },
      {
        name: '"true"',
        value: 'true',
        expected: { isSwitch: true, value: 'true', isDisabled: false },
      },
      {
        name: '"FALSE"',
        value: 'FALSE',
        expected: { isSwitch: true, value: 'false', isDisabled: true },
      },
      {
        name: '"TRUE"',
        value: 'TRUE',
        expected: { isSwitch: true, value: 'true', isDisabled: false },
      },
    ])('should handle $name', ({ value, expected }) => {
      const result = resolvePathFromEnv(value);
      expect(result).toEqual(expected);
    });
  });

  describe('when envVar is a file path', () => {
    it('should resolve absolute paths', () => {
      const result = resolvePathFromEnv('/absolute/path/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve('/absolute/path/file.txt'),
        isDisabled: false,
      });
    });

    it('should resolve relative paths', () => {
      const result = resolvePathFromEnv('relative/path/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve('relative/path/file.txt'),
        isDisabled: false,
      });
    });

    it('should expand tilde to home directory', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);

      const result = resolvePathFromEnv('~/documents/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve(path.join(homeDir, 'documents/file.txt')),
        isDisabled: false,
      });
    });

    it('should handle standalone tilde', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);

      const result = resolvePathFromEnv('~');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve(homeDir),
        isDisabled: false,
      });
    });

    it('should handle os.homedir() errors gracefully', () => {
      vi.spyOn(os, 'homedir').mockImplementation(() => {
        throw new Error('Cannot resolve home directory');
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = resolvePathFromEnv('~/documents/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: null,
        isDisabled: false,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Could not resolve home directory for path: ~/documents/file.txt',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});
