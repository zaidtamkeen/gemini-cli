/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IAgentExecutor } from './executor.js';
import { TASK_COMPLETE_TOOL_NAME } from './executor.js';
import type { AgentDefinition, AgentInputs, OutputObject } from './types.js';
import { AgentTerminateMode } from './types.js';
import { LlmAgent, InMemoryRunner } from '@google/adk';
import type { z } from 'zod';
import type { Config } from '../config/config.js';
import type { Part, FunctionDeclaration, Schema } from '@google/genai';
import { BaseTool as AdkBaseTool, type RunAsyncToolRequest } from '@google/adk';
import { convertInputConfigToGenaiSchema } from './schema-converter.js';
import type { AnyDeclarativeTool } from '../tools/tools.js';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildSystemPrompt } from './prompt-builder.js';
import { Type } from '@google/genai';

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

  private async prepareTools(): Promise<AdkToolAdapter[]> {
    const toolRegistry = await this.config.getToolRegistry();
    const { toolConfig, outputConfig } = this.definition;
    const toolsList: AdkToolAdapter[] = [];

    if (toolConfig) {
      const toolNamesToLoad: string[] = [];
      for (const toolRef of toolConfig.tools) {
        if (typeof toolRef === 'string') {
          toolNamesToLoad.push(toolRef);
        } else {
          toolsList.push(new AdkToolAdapter(toolRef as AnyDeclarativeTool));
        }
      }
      toolsList.push(
        ...toolRegistry
          .getAllTools()
          .filter((tool) => toolNamesToLoad.includes(tool.name))
          .map((tool) => new AdkToolAdapter(tool)),
      );
    }

    const completeTool = {
      name: TASK_COMPLETE_TOOL_NAME,
      description: outputConfig
        ? 'Call this tool to submit your final answer and complete the task. This is the ONLY way to finish.'
        : 'Call this tool to signal that you have completed your task. This is the ONLY way to finish.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: [],
      },
    };

    if (outputConfig) {
      const jsonSchema = zodToJsonSchema(outputConfig.schema);
      const { properties, required } = jsonSchema as {
        properties?: Record<string, Schema>;
        required?: string[];
      };

      if (properties) {
        completeTool.parameters.properties = properties;
      }
      if (required) {
        (completeTool.parameters.required as string[]).push(...required);
      }
    }

    toolsList.push(
      new AdkToolAdapter({
        name: TASK_COMPLETE_TOOL_NAME,
        description: completeTool.description,
        schema: completeTool as FunctionDeclaration,
        build: (args: Record<string, unknown>) => ({
          async execute() {
            return JSON.stringify(args);
          },
        }),
      } as unknown as AnyDeclarativeTool),
    );

    return toolsList;
  }

  async run(inputs: AgentInputs, signal: AbortSignal): Promise<OutputObject> {
    const { name, description, modelConfig } = this.definition;

    const tools = await this.prepareTools();

    const sessionId = this.config.getSessionId();
    const userId = os.userInfo().username || randomUUID();
    const appName = this.appName + '-' + name;

    const adkAgent = new LlmAgent({
      name,
      description,
      instruction: await buildSystemPrompt(
        inputs,
        this.definition,
        this.config,
      ),
      model: modelConfig.model,
      tools,
      generateContentConfig: {
        temperature: modelConfig.temp,
        topP: modelConfig.top_p,
      },
      inputSchema: convertInputConfigToGenaiSchema(this.definition.inputConfig),
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

    const { outputConfig } = this.definition;
    let finalResult = '';
    const eventStream = await runner.runAsync({
      userId,
      sessionId,
      newMessage: content,
    });

    for await (const event of eventStream) {
      if (event.content?.parts) {
        if (outputConfig) {
          for (const part of event.content.parts) {
            if (
              part.functionResponse &&
              part.functionResponse.name === TASK_COMPLETE_TOOL_NAME
            ) {
              finalResult = JSON.stringify(part.functionResponse.response);
              break;
            }
          }
        } else {
          finalResult += event.content.parts
            .map((part: Part) => part.text)
            .join('');
        }
      }
      if (finalResult && outputConfig) {
        break;
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
