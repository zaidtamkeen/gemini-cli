/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InputConfig } from './types.js';
import { type Schema, Type } from '@google/genai';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { JsonSchema7Type } from 'zod-to-json-schema';

/**
 * Converts an internal `InputConfig` definition into a standard ADK Schema
 * object suitable for a tool's `FunctionDeclaration`.
 *
 * This utility ensures that the configuration for a subagent's inputs is
 * correctly translated into the format expected by the generative model.
 *
 * @param inputConfig The internal `InputConfig` to convert.
 * @returns A JSON Schema object representing the inputs.
 * @throws An `Error` if an unsupported input type is encountered, ensuring
 * configuration errors are caught early.
 */
export function convertInputConfigToAdkSchema(
  inputConfig: InputConfig,
): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const [name, definition] of Object.entries(inputConfig.inputs)) {
    const schemaProperty: Partial<Schema> = {
      description: definition.description,
    };

    switch (definition.type) {
      case 'string':
        schemaProperty.type = Type.STRING;
        break;
      case 'number':
        schemaProperty.type = Type.NUMBER;
        break;
      case 'integer':
        schemaProperty.type = Type.INTEGER;
        break;
      case 'boolean':
        schemaProperty.type = Type.BOOLEAN;
        break;
      case 'string[]':
        schemaProperty.type = Type.ARRAY;
        schemaProperty.items = { type: Type.STRING };
        break;
      case 'number[]':
        schemaProperty.type = Type.ARRAY;
        schemaProperty.items = { type: Type.NUMBER };
        break;
      default: {
        const exhaustiveCheck: never = definition.type;
        throw new Error(
          `Unsupported input type '${exhaustiveCheck}' for parameter '${name}'. ` +
            'Supported types: string, number, integer, boolean, string[], number[]',
        );
      }
    }

    properties[name] = schemaProperty as Schema;

    if (definition.required) {
      required.push(name);
    }
  }

  return {
    type: Type.OBJECT,
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

export function convertZodSchemaToAdkSchema(schema: z.ZodTypeAny): Schema {
  const jsonSchema = zodToJsonSchema(schema);
  // This is a simplified conversion. A more robust solution would handle
  // all JSON schema features.
  const convert = (s: JsonSchema7Type): Schema => {
    if (!s || typeof s !== 'object') return s as Schema;
    const newSchema: Partial<Schema> = {};
    if (s.type) {
      const schemaType = Array.isArray(s.type) ? s.type[0] : s.type;
      let newType: Type;
      switch (schemaType) {
        case 'string':
          newType = Type.STRING;
          break;
        case 'number':
          newType = Type.NUMBER;
          break;
        case 'integer':
          newType = Type.INTEGER;
          break;
        case 'boolean':
          newType = Type.BOOLEAN;
          break;
        case 'array':
          newType = Type.ARRAY;
          break;
        case 'object':
          newType = Type.OBJECT;
          break;
        default:
          newType = schemaType as Type;
      }
      newSchema.type = newType;
    }
    if (s.description) newSchema.description = s.description;
    if (s.required) newSchema.required = s.required;
    if (s.properties) {
      newSchema.properties = {};
      for (const [key, value] of Object.entries(s.properties)) {
        newSchema.properties[key] = convert(value as JsonSchema7Type);
      }
    }
    if (s.items) {
      newSchema.items = convert(s.items as JsonSchema7Type);
    }
    return newSchema as Schema;
  };
  return convert(jsonSchema);
}
