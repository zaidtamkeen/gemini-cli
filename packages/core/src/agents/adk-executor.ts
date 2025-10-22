/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgentId, type IAgentExecutor } from './executor.js';
import { TASK_COMPLETE_TOOL_NAME } from './executor.js';
import type {
  AgentDefinition,
  AgentInputs,
  OutputObject,
  OutputConfig,
} from './types.js';
import { AgentTerminateMode } from './types.js';
import {
  LlmAgent,
  InMemoryRunner,
  getFunctionCalls,
  getFunctionResponses,
  type Event,
} from '@google/adk';
import type { z } from 'zod';
import { type Config } from '../config/config.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_TEMP,
  DEFAULT_TOP_P,
} from '../config/models.js';
import type { Part, FunctionDeclaration, Schema } from '@google/genai';
import { BaseTool as AdkBaseTool, type RunAsyncToolRequest } from '@google/adk';
import { convertInputConfigToGenaiSchema } from './schema-converter.js';
import type { AnyDeclarativeTool } from '../tools/tools.js';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ActivityCallback } from './executor.js';
import type { SubagentActivityEvent } from './types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildSystemPrompt } from './prompt-builder.js';
import { Type } from '@google/genai';
import { parseThought } from '../utils/thoughtUtils.js';
import { templateString } from './utils.js';
import { logAgentStart, logAgentFinish } from '../telemetry/loggers.js';
import { AgentStartEvent, AgentFinishEvent } from '../telemetry/types.js';

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

async function createAdkAgent<TOutput extends z.ZodTypeAny>(
  config: Config,
  definition: AgentDefinition<TOutput>,
  inputs: AgentInputs,
): Promise<LlmAgent> {
  const tools = await prepareTools(config, definition);
  const { name, description, modelConfig, subagentConfig } = definition;

  let subagents: LlmAgent[] = [];
  if (subagentConfig) {
    subagents = await Promise.all(
      subagentConfig.subagents.map((subAgentDef) =>
        createAdkAgent(config, subAgentDef, inputs),
      ),
    );
  }

  const model =
    modelConfig?.model ||
    (config.getModel() === 'auto' ? DEFAULT_GEMINI_MODEL : config.getModel());
  return new LlmAgent({
    name,
    description,
    instruction: await buildSystemPrompt(inputs, definition, config),
    model,
    tools,
    subAgents: subagents,
    generateContentConfig: {
      temperature: modelConfig?.temp ?? DEFAULT_TEMP,
      topP: modelConfig?.top_p ?? DEFAULT_TOP_P,
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: modelConfig?.thinkingBudget ?? -1,
      },
    },
    inputSchema: convertInputConfigToGenaiSchema(definition.inputConfig),
  });
}

async function prepareTools<TOutput extends z.ZodTypeAny>(
  config: Config,
  definition: AgentDefinition<TOutput>,
): Promise<AdkToolAdapter[]> {
  const toolRegistry = await config.getToolRegistry();
  const { toolConfig, outputConfig } = definition;
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

/**
 * An agent executor that integrates with the ADK.
 */
export class AdkAgentExecutor<TOutput extends z.ZodTypeAny>
  implements IAgentExecutor
{
  private readonly definition: AgentDefinition<TOutput>;
  private readonly config: Config;
  private readonly onActivity?: ActivityCallback;
  private readonly agentId: string;

  constructor(
    definition: AgentDefinition<TOutput>,
    config: Config,
    onActivity?: ActivityCallback,
  ) {
    this.definition = definition;
    this.config = config;
    this.onActivity = onActivity;
    this.agentId = createAgentId(this.definition.name);
  }

  static async create<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
    config: Config,
    onActivity?: ActivityCallback,
  ): Promise<AdkAgentExecutor<TOutput>> {
    return new AdkAgentExecutor(definition, config, onActivity);
  }

  /** Emits an activity event to the configured callback. */
  private emitActivity(
    type: SubagentActivityEvent['type'],
    data: Record<string, unknown>,
  ): void {
    if (this.onActivity) {
      const event: SubagentActivityEvent = {
        isSubagentActivityEvent: true,
        agentName: this.definition.name,
        type,
        data,
      };
      this.onActivity(event);
    }
  }

  async run(inputs: AgentInputs, signal: AbortSignal): Promise<OutputObject> {
    const startTime = Date.now();
    let terminateReason: AgentTerminateMode = AgentTerminateMode.ERROR;

    logAgentStart(
      this.config,
      new AgentStartEvent(this.agentId, this.definition.name),
    );

    try {
      const adkAgent = await createAdkAgent(
        this.config,
        this.definition,
        inputs,
      );

      const sessionId = this.config.getSessionId();
      const userId = os.userInfo().username || randomUUID();

      const runner = new InMemoryRunner({
        agent: adkAgent,
        appName: this.agentId,
      });

      await runner.sessionService.createSession({
        appName: this.agentId,
        userId,
        sessionId,
      });

      const query = this.definition.promptConfig.query
        ? templateString(this.definition.promptConfig.query, inputs)
        : 'Get Started!';
      const content = {
        role: 'user',
        parts: [{ text: query }],
      };

      const { outputConfig } = this.definition;
      const eventStream = await runner.runAsync({
        userId,
        sessionId,
        newMessage: content,
      });

      const finalResult = await this.processEventStream(
        eventStream,
        outputConfig,
      );

      if (signal.aborted) {
        return {
          result: 'Execution aborted.',
          terminate_reason: AgentTerminateMode.ABORTED,
        };
      }

      terminateReason = AgentTerminateMode.GOAL;
      return {
        result: finalResult,
        terminate_reason: terminateReason,
      };
    } finally {
      logAgentFinish(
        this.config,
        new AgentFinishEvent(
          this.agentId,
          this.definition.name,
          Date.now() - startTime,
          -1, // turnCounter is not available in AdkAgentExecutor
          terminateReason,
        ),
      );
    }
  }

  private async processEventStream(
    eventStream: AsyncGenerator<Event>,
    outputConfig: OutputConfig<TOutput> | undefined,
  ): Promise<string> {
    let finalResult = '';

    for await (const event of eventStream) {
      const functionCalls = getFunctionCalls(event);
      if (functionCalls.length > 0) {
        for (const call of functionCalls) {
          this.emitActivity('TOOL_CALL_START', {
            name: call.name,
            args: call.args,
          });
        }
      }

      const functionResponses = getFunctionResponses(event);
      if (functionResponses.length > 0) {
        for (const response of functionResponses) {
          this.emitActivity('TOOL_CALL_END', {
            name: response.name,
            output: JSON.stringify(response.response),
          });
        }
      }

      if (event.content?.parts) {
        const { subject } = parseThought(
          event.content.parts?.find((p) => p.thought)?.text || '',
        );
        if (subject) {
          this.emitActivity('THOUGHT_CHUNK', { text: subject });
        }
      }

      if (event.content?.parts) {
        if (outputConfig) {
          for (const part of event.content.parts) {
            if (
              part.functionResponse &&
              part.functionResponse.name === TASK_COMPLETE_TOOL_NAME
            ) {
              const response = part.functionResponse.response as {
                result: string;
              };
              const result = JSON.parse(response.result);
              const validationResult = outputConfig.schema.safeParse(result);
              if (validationResult.success) {
                if (this.definition.processOutput) {
                  finalResult = this.definition.processOutput(
                    validationResult.data,
                  );
                } else {
                  finalResult = JSON.stringify(part.functionResponse.response);
                }
              } else {
                finalResult = JSON.stringify(validationResult.error.flatten());
              }
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
    return finalResult;
  }
}
