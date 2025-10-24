/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PolicyEngineConfig,
  PolicyDecision,
  type PolicyRule,
  type ApprovalMode,
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
  toolName: z.union([z.string(), z.array(z.string())]).optional(),
  mcpName: z.string().optional(),
  argsPattern: z.string().optional(),
  decision: z.nativeEnum(PolicyDecision),
  priority: z.number(),
  modes: z.array(z.string()).optional(),
});

const PolicyFileSchema = z.object({
  rule: z.array(PolicyRuleSchema),
});

function getPolicyTier(dir: string): number {
  const DEFAULT_POLICIES_DIR = path.resolve(__dirname, 'policies');
  const USER_POLICIES_DIR = Storage.getUserPoliciesDir();
  const systemSettingsPath = getSystemSettingsPath();
  const ADMIN_POLICIES_DIR = path.join(
    path.dirname(systemSettingsPath),
    'policies',
  );

  // Normalize paths for comparison
  const normalizedDir = path.resolve(dir);
  const normalizedDefault = path.resolve(DEFAULT_POLICIES_DIR);
  const normalizedUser = path.resolve(USER_POLICIES_DIR);
  const normalizedAdmin = path.resolve(ADMIN_POLICIES_DIR);

  if (normalizedDir === normalizedDefault) return 1;
  if (normalizedDir === normalizedUser) return 2;
  if (normalizedDir === normalizedAdmin) return 3;

  // Default to tier 1 if unknown
  return 1;
}

function transformPriority(priority: number, tier: number): number {
  return tier + priority / 1000;
}

async function loadPoliciesFromConfig(
  approvalMode: ApprovalMode,
  policyDirs: string[],
): Promise<PolicyRule[]> {
  let rules: PolicyRule[] = [];

  for (const dir of policyDirs) {
    const tier = getPolicyTier(dir);

    // Scan directory for all .toml files
    let filesToLoad: string[];
    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      filesToLoad = dirEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.toml'))
        .map((entry) => entry.name);
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        // Directory doesn't exist, skip it
        continue;
      }
      console.error(`Error reading policy directory ${dir}:`, error);
      continue;
    }

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
        // Convert argsPattern strings to RegExp objects and filter by mode
        const parsedRules: PolicyRule[] = validationResult.data.rule
          .filter((rule) => {
            // If rule has no modes field, it applies to all modes
            if (!rule.modes || rule.modes.length === 0) {
              return true;
            }
            // Otherwise, check if current approval mode is in the rule's modes list
            return rule.modes.includes(approvalMode);
          })
          .flatMap((rule) => {
            // Normalize toolName to array for uniform processing
            const toolNames: Array<string | undefined> = rule.toolName
              ? Array.isArray(rule.toolName)
                ? rule.toolName
                : [rule.toolName]
              : [undefined];

            // Create a policy rule for each tool name
            return toolNames.map((toolName) => {
              // Transform mcpName field to composite toolName format
              let effectiveToolName: string | undefined;
              if (rule.mcpName && toolName) {
                // Both mcpName and toolName: create composite format
                effectiveToolName = `${rule.mcpName}__${toolName}`;
              } else if (rule.mcpName) {
                // Only mcpName: create server wildcard
                effectiveToolName = `${rule.mcpName}__*`;
              } else {
                // Only toolName or neither: use as-is
                effectiveToolName = toolName;
              }

              const policyRule: PolicyRule = {
                toolName: effectiveToolName,
                decision: rule.decision,
                priority: transformPriority(rule.priority, tier),
              };
              if (rule.argsPattern) {
                policyRule.argsPattern = new RegExp(rule.argsPattern);
              }
              return policyRule;
            });
          });
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
  // Priority bands (tiers):
  // - Default policies (TOML): 1 + priority/1000 (e.g., priority 100 → 1.100)
  // - User policies (TOML): 2 + priority/1000 (e.g., priority 100 → 2.100)
  // - Admin policies (TOML): 3 + priority/1000 (e.g., priority 100 → 3.100)
  //
  // This ensures Admin > User > Default hierarchy is always preserved,
  // while allowing user-specified priorities to work within each tier.
  //
  // Settings-based and dynamic rules (not transformed):
  //   2.95: Tools that the user has selected as "Always Allow" in the interactive UI
  //   85: MCP servers allowed list
  //   90: MCP servers with trust=true
  //   100: Explicitly allowed individual tools
  //   195: Explicitly excluded MCP servers
  //   200: Explicitly excluded individual tools
  //
  // TOML policy priorities (before transformation):
  //   10: Write tools default to ASK_USER
  //   15: Auto-edit tool override (becomes 1.015 in default tier)
  //   50: Read-only tools (becomes 1.05 in default tier)
  //   999: YOLO mode allow-all (becomes 1.999 in default tier)

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
        // User tier (2) + high priority (950/1000) = 2.95
        // This ensures user "always allow" selections are high priority
        // but still lose to admin policies (3.xxx) and settings excludes (200)
        priority: 2.95,
      });
    },
  );
}
