/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensResponse,
  GenerateContentParameters,
  GenerateContentResponse,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import { promises } from 'node:fs';
import type { ContentGenerator } from './contentGenerator.js';
import type { UserTierId } from '../code_assist/types.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import type { FakeResponses } from './fakeContentGenerator.js';

// A ContentGenerator that wraps another content generator and records all the
// responses, with the ability to write them out to a file. These files are
// intended to be consumed later on by a FakeContentGenerator, given the
// `--fake-responses` CLI argument.
//
// Note that only the "interesting" bits of the responses are actually kept.
export class RecordingContentGenerator implements ContentGenerator {
  private recordedResponses: FakeResponses = {
    generateContent: [],
    generateContentStream: [],
    countTokens: [],
    embedContent: [],
  };
  userTier?: UserTierId;

  constructor(private readonly realGenerator: ContentGenerator) {}

  async writeResponses(filePath: string): Promise<void> {
    await promises.writeFile(
      filePath,
      safeJsonStringify(this.recordedResponses),
    );
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const response = await this.realGenerator.generateContent(
      request,
      userPromptId,
    );
    this.recordedResponses.generateContent.push({
      candidates: response.candidates,
      usageMetadata: response.usageMetadata,
    } as GenerateContentResponse);
    return response;
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const streamResponses: GenerateContentResponse[] = [];
    this.recordedResponses.generateContentStream.push(streamResponses);

    const realResponses = await this.realGenerator.generateContentStream(
      request,
      userPromptId,
    );

    async function* stream() {
      for await (const response of realResponses) {
        streamResponses.push({
          candidates: response.candidates,
          usageMetadata: response.usageMetadata,
        } as GenerateContentResponse);
        yield response;
      }
    }

    return Promise.resolve(stream());
  }

  async countTokens(
    _request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const response = await this.realGenerator.countTokens(_request);
    this.recordedResponses.countTokens.push({
      totalTokens: response.totalTokens,
      cachedContentTokenCount: response.cachedContentTokenCount,
    });
    return response;
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    const response = await this.realGenerator.embedContent(_request);
    this.recordedResponses.embedContent.push({
      embeddings: response.embeddings,
      metadata: response.metadata,
    });
    return response;
  }
}
