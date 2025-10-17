/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IAgentExecutor } from './executor.js';
import type { AgentDefinition, AgentInputs, OutputObject } from './types.js';
import { AgentTerminateMode } from './types.js';
import { LlmAgent, InMemoryRunner } from '@google/adk';
import type { z } from 'zod';
import type { Config } from '../config/config.js';
import type { Part, FunctionDeclaration } from '@google/genai';
import { BaseTool as AdkBaseTool, type RunAsyncToolRequest } from '@google/adk';
import type { AnyDeclarativeTool } from '../tools/tools.js';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * An adapter that wraps a gemini-cli DeclarativeTool to make it compatible
 * with the adk LlmAgent.
 */
export class AdkToolAdapter extends AdkBaseTool {
  constructor(readonly tool: AnyDeclarativeTool) {
    super(tool);
  }

  override _getDeclaration(): FunctionDeclaration | undefined {
    return this.tool.schema;
  }

  async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    const invocation = this.tool.build(request.args);
    const abortController = new AbortController();
    const result = await invocation.execute(abortController.signal);
    return result;
  }
}

/**
 * An agent executor that integrates with the ADK.
 */
export class AdkAgentExecutor<TOutput extends z.ZodTypeAny>
  implements IAgentExecutor
{
  private readonly appName: string = 'gemini-cli';
  private readonly definition: AgentDefinition<TOutput>;
  private readonly config: Config;

  constructor(definition: AgentDefinition<TOutput>, config: Config) {
    this.definition = definition;
    this.config = config;
  }

  static async create<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
    config: Config,
  ): Promise<AdkAgentExecutor<TOutput>> {
    return new AdkAgentExecutor(definition, config);
  }

  async run(inputs: AgentInputs, signal: AbortSignal): Promise<OutputObject> {
    const { name, description, promptConfig, modelConfig } = this.definition;

    const toolRegistry = await this.config.getToolRegistry();
    const tools = toolRegistry
      .getAllTools()
      .map((tool) => new AdkToolAdapter(tool as AnyDeclarativeTool));

    const sessionId = this.config.getSessionId();
    const userId = os.userInfo().username || randomUUID();
    const appName = this.appName + '-' + name;

    // TODO: handle input schema and output schema
    const adkAgent = new LlmAgent({
      name,
      description,
      instruction: promptConfig.systemPrompt,
      model: modelConfig.model,
      tools,
      generateContentConfig: {
        temperature: modelConfig.temp,
        topP: modelConfig.top_p,
      },
    });

    const runner = new InMemoryRunner({
      agent: adkAgent,
      appName,
    });

    await runner.sessionService.createSession({
      appName,
      userId,
      sessionId,
    });

    const content = {
      role: 'user',
      parts: [{ text: JSON.stringify(inputs['objective']) }],
    };

    let finalResult = '';
    const eventStream = await runner.runAsync({
      userId,
      sessionId,
      newMessage: content,
    });

    for await (const event of eventStream) {
      if (event.content?.parts) {
        finalResult += event.content.parts
          .map((part: Part) => part.text)
          .join('');
      }
    }

    if (signal.aborted) {
      return {
        result: 'Execution aborted.',
        terminate_reason: AgentTerminateMode.ABORTED,
      };
    }

    return {
      result: finalResult,
      terminate_reason: AgentTerminateMode.GOAL,
    };
  }
}
