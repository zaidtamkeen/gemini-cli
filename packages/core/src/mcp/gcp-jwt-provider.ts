/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { GoogleAuth } from 'google-auth-library';
import { OAuthUtils } from './oauth-utils.js';
import type { MCPServerConfig } from '../config/config.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';

const fiveMinBufferMs = 5 * 60 * 1000;

export class GcpJwtProvider implements OAuthClientProvider {
  private readonly resourceUrl: string;
  private readonly auth: GoogleAuth;
  private cachedToken?: OAuthTokens;
  private tokenExpiryTime?: number;

  // Properties required by OAuthClientProvider, with no-op values
  readonly redirectUrl = '';
  readonly clientMetadata: OAuthClientMetadata = {
    client_name: 'Gemini CLI (GCP JWT)',
    redirect_uris: [],
    grant_types: [],
    response_types: [],
    token_endpoint_auth_method: 'none',
  };
  private _clientInformation?: OAuthClientInformationFull;

  constructor(private readonly config: MCPServerConfig) {
    if (!this.config.httpUrl && !this.config.url) {
      throw new Error(
        'A url or httpUrl must be provided for the GCP JWT provider',
      );
    }
    this.resourceUrl = this.config.httpUrl || this.config.url!;
    this.auth = new GoogleAuth();
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this._clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    this._clientInformation = clientInformation;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    // Check for non-expired token
    if (
      this.cachedToken &&
      this.tokenExpiryTime &&
      Date.now() < this.tokenExpiryTime - fiveMinBufferMs
    ) {
      return this.cachedToken;
    }

    // Clear cache if expired or missing
    this.cachedToken = undefined;
    this.tokenExpiryTime = undefined;

    // 3. Fetch a new ID token.
    let idToken: string;
    try {
      const client = await this.auth.getIdTokenClient(this.resourceUrl);
      idToken = await client.idTokenProvider.fetchIdToken(this.resourceUrl);

      if (!idToken || idToken.length === 0) {
        console.error('Failed to get ID token from Google');
        return undefined;
      }
    } catch (e) {
      console.error('Failed to fetch ID token from Google:', e);
      return undefined;
    }

    // Note: We are placing the OIDC ID Token into the `access_token` field.
    // This is because the CLI uses this field to construct the
    // `Authorization: Bearer <token>` header, which is the correct way to
    // present an ID token.
    const newTokens: OAuthTokens = {
      access_token: idToken,
      token_type: 'Bearer',
    };

    const expiryTime = OAuthUtils.parseTokenExpiry(idToken);
    if (expiryTime) {
      this.tokenExpiryTime = expiryTime;
      this.cachedToken = newTokens;
    }

    return newTokens;
  }

  saveTokens(_tokens: OAuthTokens): void {
    // No-op
  }

  redirectToAuthorization(_authorizationUrl: URL): void {
    // No-op
  }

  saveCodeVerifier(_codeVerifier: string): void {
    // No-op
  }

  codeVerifier(): string {
    // No-op
    return '';
  }
}
