/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Schema } from '@google/genai';

export function convertInputConfigToGenaiSchema(inputConfig: {
  inputs: Record<
    string,
    { type: string; description: string; required?: boolean }
  >;
}): Schema {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const key in inputConfig.inputs) {
    properties[key] = {
      type: inputConfig.inputs[key].type,
      description: inputConfig.inputs[key].description,
    };
  }

  return {
    type: 'object',
    properties,
    required: Object.keys(inputConfig.inputs).filter(
      (key) => inputConfig.inputs[key].required,
    ),
  } as unknown as Schema;
}
