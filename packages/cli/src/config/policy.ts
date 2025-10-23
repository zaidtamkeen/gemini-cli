/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PolicyEngineConfig,
  PolicyDecision,
  type PolicyRule,
  ApprovalMode,
  type PolicyEngine,
  type MessageBus,
  MessageBusType,
  type UpdatePolicy,
  Storage,
} from '@google/gemini-cli-core';
import { type Settings, getSystemSettingsPath } from './settings.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import toml from '@iarna/toml';
import { z } from 'zod';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPolicyDirectories(): string[] {
  const DEFAULT_POLICIES_DIR = path.resolve(__dirname, 'policies');
  const USER_POLICIES_DIR = Storage.getUserPoliciesDir();
  const systemSettingsPath = getSystemSettingsPath();
  const ADMIN_POLICIES_DIR = path.join(
    path.dirname(systemSettingsPath),
    'policies',
  );

  return [
    DEFAULT_POLICIES_DIR,
    USER_POLICIES_DIR,
    ADMIN_POLICIES_DIR,
  ].reverse();
}

const PolicyRuleSchema = z.object({
  toolName: z.string().optional(),
  argsPattern: z.string().optional(),
  decision: z.nativeEnum(PolicyDecision),
  priority: z.number(),
});

const PolicyFileSchema = z.object({
  rule: z.array(PolicyRuleSchema),
});

async function loadPoliciesFromConfig(
  approvalMode: ApprovalMode,
  policyDirs: string[],
): Promise<PolicyRule[]> {
  const filesToLoad: string[] = ['read-only.toml'];

  if (approvalMode !== ApprovalMode.YOLO) {
    filesToLoad.push('write.toml');
  }

  if (approvalMode === ApprovalMode.YOLO) {
    filesToLoad.push('default.toml');
  } else if (approvalMode === ApprovalMode.AUTO_EDIT) {
    filesToLoad.push('auto-edit.toml');
  }

  let rules: PolicyRule[] = [];

  for (const dir of policyDirs) {
    for (const file of filesToLoad) {
      const filePath = path.join(dir, file);
      try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const parsed = toml.parse(fileContent);
        const validationResult = PolicyFileSchema.safeParse(parsed);
        if (!validationResult.success) {
          // Ideally, we should have better error handling here
          console.error(
            `Failed to parse policy file ${file}:`,
            validationResult.error,
          );
          continue;
        }
        // Convert argsPattern strings to RegExp objects
        const parsedRules: PolicyRule[] = validationResult.data.rule.map(
          (rule) => {
            if (rule.argsPattern) {
              return {
                ...rule,
                argsPattern: new RegExp(rule.argsPattern),
              };
            }
            return rule as PolicyRule;
          },
        );
        rules = rules.concat(parsedRules);
      } catch (e) {
        const error = e as NodeJS.ErrnoException;
        // Ignore if the file doesn't exist
        if (error.code !== 'ENOENT') {
          console.error(`Failed to read policy file ${filePath}:`, error);
        }
      }
    }
  }

  return rules;
}

export async function createPolicyEngineConfig(
  settings: Settings,
  approvalMode: ApprovalMode,
): Promise<PolicyEngineConfig> {
  const policyDirs = getPolicyDirectories();

  const rules: PolicyRule[] = await loadPoliciesFromConfig(
    approvalMode,
    policyDirs,
  );

  // Priority system for policy rules:
  // - Higher priority numbers win over lower priority numbers
  // - When multiple rules match, the highest priority rule is applied
  // - Rules are evaluated in order of priority (highest first)
  //
  // Priority levels used in this configuration:
  //   0: Default allow-all (YOLO mode only)
  //   10: Write tools default to ASK_USER
  //   15: Auto-edit tool override
  //   50: Auto-accept read-only tools
  //   85: MCP servers allowed list
  //   90: MCP servers with trust=true
  //   100: Explicitly allowed individual tools
  //   195: Explicitly excluded MCP servers
  //   199: Tools that the user has selected as "Always Allow" in the interactive UI.
  //   200: Explicitly excluded individual tools (highest priority)

  // MCP servers that are explicitly allowed in settings.mcp.allowed
  // Priority: 85 (lower than trusted servers)
  if (settings.mcp?.allowed) {
    for (const serverName of settings.mcp.allowed) {
      rules.push({
        toolName: `${serverName}__*`,
        decision: PolicyDecision.ALLOW,
        priority: 85,
      });
    }
  }

  // MCP servers that are trusted in the settings.
  // Priority: 90 (higher than general allowed servers but lower than explicit tool allows)
  if (settings.mcpServers) {
    for (const [serverName, serverConfig] of Object.entries(
      settings.mcpServers,
    )) {
      if (serverConfig.trust) {
        // Trust all tools from this MCP server
        // Using pattern matching for MCP tool names which are formatted as "serverName__toolName"
        rules.push({
          toolName: `${serverName}__*`,
          decision: PolicyDecision.ALLOW,
          priority: 90,
        });
      }
    }
  }

  // Tools that are explicitly allowed in the settings.
  // Priority: 100
  if (settings.tools?.allowed) {
    for (const tool of settings.tools.allowed) {
      rules.push({
        toolName: tool,
        decision: PolicyDecision.ALLOW,
        priority: 100,
      });
    }
  }

  // Tools that are explicitly excluded in the settings.
  // Priority: 200
  if (settings.tools?.exclude) {
    for (const tool of settings.tools.exclude) {
      rules.push({
        toolName: tool,
        decision: PolicyDecision.DENY,
        priority: 200,
      });
    }
  }

  // MCP servers that are explicitly excluded in settings.mcp.excluded
  // Priority: 195 (high priority to block servers)
  if (settings.mcp?.excluded) {
    for (const serverName of settings.mcp.excluded) {
      rules.push({
        toolName: `${serverName}__*`,
        decision: PolicyDecision.DENY,
        priority: 195,
      });
    }
  }

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
  };
}

export function createPolicyUpdater(
  policyEngine: PolicyEngine,
  messageBus: MessageBus,
) {
  messageBus.subscribe(
    MessageBusType.UPDATE_POLICY,
    (message: UpdatePolicy) => {
      const toolName = message.toolName;

      policyEngine.addRule({
        toolName,
        decision: PolicyDecision.ALLOW,
        priority: 199, // High priority, but lower than explicit DENY (200)
      });
    },
  );
}
