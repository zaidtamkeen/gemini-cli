/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GcpIDTokenProvider } from './gcp-id-token-provider.js';
import type { MCPServerConfig } from '../config/config.js';

const mockFetchIdToken = vi.fn();
const mockGetIdTokenClient = vi.fn(() => ({
  idTokenProvider: {
    fetchIdToken: mockFetchIdToken,
  },
}));

// Mock the google-auth-library to use a shared mock function
vi.mock('google-auth-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('google-auth-library')>();
  return {
    ...actual,
    GoogleAuth: vi.fn().mockImplementation(() => ({
      getIdTokenClient: mockGetIdTokenClient,
    })),
  };
});

const defaultConfig: MCPServerConfig = {
  url: 'https://my-service.run.app',
};

describe('GcpIDTokenProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should throw an error if no URL is provided', () => {
    const config: MCPServerConfig = {};
    expect(() => new GcpIDTokenProvider(config)).toThrow(
      'A url or httpUrl must be provided for the GCP JWT provider',
    );
  });

  it('should correctly get tokens for a valid config', async () => {
    const mockToken = 'mock-id-token-123';
    mockFetchIdToken.mockResolvedValue(mockToken);

    const provider = new GcpIDTokenProvider(defaultConfig);
    const tokens = await provider.tokens();

    expect(tokens).toBeDefined();
    expect(tokens?.access_token).toBe(mockToken);
    expect(tokens?.token_type).toBe('Bearer');
  });

  it('should return undefined if token acquisition fails', async () => {
    mockFetchIdToken.mockResolvedValue(null);

    const provider = new GcpIDTokenProvider(defaultConfig);
    const tokens = await provider.tokens();

    expect(tokens).toBeUndefined();
  });

  it('should make a request with the correct parameters', async () => {
    mockFetchIdToken.mockResolvedValue('test-token');

    const provider = new GcpIDTokenProvider(defaultConfig);
    await provider.tokens();

    expect(mockGetIdTokenClient).toHaveBeenCalledWith(defaultConfig.url);
    expect(mockFetchIdToken).toHaveBeenCalledWith(defaultConfig.url);
  });

  it('should return a cached token if it is not expired', async () => {
    const provider = new GcpIDTokenProvider(defaultConfig);

    // jwt payload with exp set to 1 hour from now
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600 };
    const jwt = `header.${Buffer.from(JSON.stringify(payload)).toString(
      'base64',
    )}.signature`;
    mockFetchIdToken.mockResolvedValue(jwt);

    const firstTokens = await provider.tokens();
    expect(firstTokens?.access_token).toBe(jwt);
    expect(mockFetchIdToken).toHaveBeenCalledTimes(1);

    // Advance time by 30 minutes
    vi.advanceTimersByTime(1800 * 1000);

    // Return cached token
    const secondTokens = await provider.tokens();
    expect(secondTokens).toBe(firstTokens);
    expect(mockFetchIdToken).toHaveBeenCalledTimes(1);
  });

  it('should fetch a new token if the cached token is expired', async () => {
    const provider = new GcpIDTokenProvider(defaultConfig);

    // Get and cache a token that expires in 1 second
    const expiredPayload = { exp: Math.floor(Date.now() / 1000) + 1 };
    const expiredJwt = `header.${Buffer.from(
      JSON.stringify(expiredPayload),
    ).toString('base64')}.signature`;

    mockFetchIdToken.mockResolvedValue(expiredJwt);
    const firstTokens = await provider.tokens();
    expect(firstTokens?.access_token).toBe(expiredJwt);
    expect(mockFetchIdToken).toHaveBeenCalledTimes(1);

    // Prepare the mock for the *next* call
    const newPayload = { exp: Math.floor(Date.now() / 1000) + 3600 };
    const newJwt = `header.${Buffer.from(JSON.stringify(newPayload)).toString(
      'base64',
    )}.signature`;
    mockFetchIdToken.mockResolvedValue(newJwt);

    vi.advanceTimersByTime(1001);

    const newTokens = await provider.tokens();
    expect(newTokens?.access_token).toBe(newJwt);
    expect(newTokens?.access_token).not.toBe(expiredJwt);
    expect(mockFetchIdToken).toHaveBeenCalledTimes(2); // Confirms a new fetch
  });
});
