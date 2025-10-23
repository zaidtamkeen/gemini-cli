/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GenerateContentResponse,
  CountTokensResponse,
  EmbedContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentParameters,
} from '@google/genai';
import { promises as fs } from 'node:fs';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import type { ContentGenerator } from './contentGenerator.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';

vi.mock('node:fs', () => ({
  promises: {
    writeFile: vi.fn(),
  },
}));

describe('RecordingContentGenerator', () => {
  let mockRealGenerator: ContentGenerator;
  let recorder: RecordingContentGenerator;

  beforeEach(() => {
    mockRealGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn(),
      embedContent: vi.fn(),
    };
    recorder = new RecordingContentGenerator(mockRealGenerator);
    vi.resetAllMocks();
  });

  it('should write responses to a file', async () => {
    const filePath = '/fake/path/responses.json';
    await recorder.writeResponses(filePath);
    expect(fs.writeFile).toHaveBeenCalledWith(
      filePath,
      safeJsonStringify({
        generateContent: [],
        generateContentStream: [],
        countTokens: [],
        embedContent: [],
      }),
    );
  });

  it('should record generateContent responses', async () => {
    const mockResponse = {
      candidates: [
        { content: { parts: [{ text: 'response' }], role: 'model' } },
      ],
      usageMetadata: { totalTokenCount: 10 },
    } as GenerateContentResponse;
    (mockRealGenerator.generateContent as Mock).mockResolvedValue(mockResponse);

    const response = await recorder.generateContent(
      {} as GenerateContentParameters,
      'id1',
    );
    expect(response).toEqual(mockResponse);
    expect(mockRealGenerator.generateContent).toHaveBeenCalledWith({}, 'id1');

    const filePath = '/fake/path/responses.json';
    await recorder.writeResponses(filePath);
    expect(fs.writeFile).toHaveBeenCalledWith(
      filePath,
      safeJsonStringify({
        generateContent: [
          {
            candidates: mockResponse.candidates,
            usageMetadata: mockResponse.usageMetadata,
          },
        ],
        generateContentStream: [],
        countTokens: [],
        embedContent: [],
      }),
    );
  });

  it('should record generateContentStream responses', async () => {
    const mockResponse1 = {
      candidates: [
        { content: { parts: [{ text: 'response1' }], role: 'model' } },
      ],
      usageMetadata: { totalTokenCount: 10 },
    } as GenerateContentResponse;
    const mockResponse2 = {
      candidates: [
        { content: { parts: [{ text: 'response2' }], role: 'model' } },
      ],
      usageMetadata: { totalTokenCount: 20 },
    } as GenerateContentResponse;

    async function* mockStream() {
      yield mockResponse1;
      yield mockResponse2;
    }

    (mockRealGenerator.generateContentStream as Mock).mockResolvedValue(
      mockStream(),
    );

    const stream = await recorder.generateContentStream(
      {} as GenerateContentParameters,
      'id1',
    );
    const responses = [];
    for await (const response of stream) {
      responses.push(response);
    }

    expect(responses).toEqual([mockResponse1, mockResponse2]);
    expect(mockRealGenerator.generateContentStream).toHaveBeenCalledWith(
      {},
      'id1',
    );

    const filePath = '/fake/path/responses.json';
    await recorder.writeResponses(filePath);
    expect(fs.writeFile).toHaveBeenCalledWith(
      filePath,
      safeJsonStringify({
        generateContent: [],
        generateContentStream: [
          [
            {
              candidates: mockResponse1.candidates,
              usageMetadata: mockResponse1.usageMetadata,
            },
            {
              candidates: mockResponse2.candidates,
              usageMetadata: mockResponse2.usageMetadata,
            },
          ],
        ],
        countTokens: [],
        embedContent: [],
      }),
    );
  });

  it('should record countTokens responses', async () => {
    const mockResponse = {
      totalTokens: 100,
      cachedContentTokenCount: 10,
    } as CountTokensResponse;
    (mockRealGenerator.countTokens as Mock).mockResolvedValue(mockResponse);

    const response = await recorder.countTokens({} as CountTokensParameters);
    expect(response).toEqual(mockResponse);
    expect(mockRealGenerator.countTokens).toHaveBeenCalledWith({});

    const filePath = '/fake/path/responses.json';
    await recorder.writeResponses(filePath);
    expect(fs.writeFile).toHaveBeenCalledWith(
      filePath,
      safeJsonStringify({
        generateContent: [],
        generateContentStream: [],
        countTokens: [
          {
            totalTokens: mockResponse.totalTokens,
            cachedContentTokenCount: mockResponse.cachedContentTokenCount,
          },
        ],
        embedContent: [],
      }),
    );
  });

  it('should record embedContent responses', async () => {
    const mockResponse = {
      embedding: { values: [1, 2, 3] },
    } as unknown as EmbedContentResponse;
    (mockRealGenerator.embedContent as Mock).mockResolvedValue(mockResponse);

    const response = await recorder.embedContent({} as EmbedContentParameters);
    expect(response).toEqual(mockResponse);
    expect(mockRealGenerator.embedContent).toHaveBeenCalledWith({});

    const filePath = '/fake/path/responses.json';
    await recorder.writeResponses(filePath);
    expect(fs.writeFile).toHaveBeenCalledWith(
      filePath,
      safeJsonStringify({
        generateContent: [],
        generateContentStream: [],
        countTokens: [],
        embedContent: [
          {
            embeddings: mockResponse.embeddings,
            metadata: mockResponse.metadata,
          },
        ],
      }),
    );
  });
});
