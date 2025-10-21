/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDefinition } from './types.js';
import { z } from 'zod';
import { getCoreSystemPrompt } from '../core/prompts.js';
import type { Config } from '../config/config.js';

const AdkMainLoopOutputSchema = z.object({
  FinalResult: z.string().describe('The final output of the main loop agent.'),
});

export const AdkMainLoopAgent: AgentDefinition<typeof AdkMainLoopOutputSchema> =
  {
    name: 'adk_main_loop',
    displayName: 'Main Loop Agent',
    description:
      'This agent has all necessary tools to complete end-to-end tasks.',
    inputConfig: {
      inputs: {
        objective: {
          description: 'The task as presented by the user.',
          type: 'string',
          required: true,
        },
      },
    },
    outputConfig: {
      outputName: 'report',
      description: 'Placeholder description.',
      schema: AdkMainLoopOutputSchema,
    },
    processOutput: (output) => JSON.stringify(output, null, 2),
    toolConfig: {
      tools: [], // Placeholder tools
    },
    promptConfig: {
      query: `\${objective}`,
      systemPrompt: (config: Config) => {
        const userMemory = config.getUserMemory();
        const systemInstruction = getCoreSystemPrompt(config, userMemory);
        return systemInstruction;
      },
    },
  };
