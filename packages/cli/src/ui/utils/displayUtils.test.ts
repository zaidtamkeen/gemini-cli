/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getStatusColor,
  TOOL_SUCCESS_RATE_HIGH,
  TOOL_SUCCESS_RATE_MEDIUM,
  USER_AGREEMENT_RATE_HIGH,
  USER_AGREEMENT_RATE_MEDIUM,
  CACHE_EFFICIENCY_HIGH,
  CACHE_EFFICIENCY_MEDIUM,
} from './displayUtils.js';
import { Colors } from '../colors.js';

describe('displayUtils', () => {
  describe('getStatusColor', () => {
    describe('with red threshold', () => {
      const thresholds = { green: 80, yellow: 50, red: 20 };

      it.each([
        {
          value: 90,
          expected: Colors.AccentGreen,
          description: 'above green threshold',
        },
        {
          value: 80,
          expected: Colors.AccentGreen,
          description: 'at green threshold',
        },
        {
          value: 79,
          expected: Colors.AccentYellow,
          description: 'below green, above yellow',
        },
        {
          value: 50,
          expected: Colors.AccentYellow,
          description: 'at yellow threshold',
        },
        {
          value: 49,
          expected: Colors.AccentRed,
          description: 'below yellow, above red',
        },
        {
          value: 20,
          expected: Colors.AccentRed,
          description: 'at red threshold',
        },
        {
          value: 19,
          expected: Colors.AccentRed,
          description: 'below red threshold',
        },
        {
          value: 0,
          expected: Colors.AccentRed,
          description: 'at minimum',
        },
      ])(
        'should return $expected for value $value ($description)',
        ({ value, expected }) => {
          expect(getStatusColor(value, thresholds)).toBe(expected);
        },
      );

      it.each([
        { value: 19, defaultColor: Colors.Foreground },
        { value: 0, defaultColor: Colors.Foreground },
      ])(
        'should use defaultColor for value $value when provided',
        ({ value, defaultColor }) => {
          expect(getStatusColor(value, thresholds, { defaultColor })).toBe(
            defaultColor,
          );
        },
      );
    });

    describe('when red threshold is not provided', () => {
      const thresholds = { green: 80, yellow: 50 };

      it.each([
        {
          value: 49,
          expected: Colors.AccentRed,
          description: 'below yellow threshold',
        },
      ])(
        'should return $expected for value $value ($description)',
        ({ value, expected }) => {
          expect(getStatusColor(value, thresholds)).toBe(expected);
        },
      );

      it.each([{ value: 49, defaultColor: Colors.Foreground }])(
        'should use defaultColor for value $value when provided',
        ({ value, defaultColor }) => {
          expect(getStatusColor(value, thresholds, { defaultColor })).toBe(
            defaultColor,
          );
        },
      );
    });
  });

  describe('Threshold Constants', () => {
    it('should have the correct values', () => {
      expect(TOOL_SUCCESS_RATE_HIGH).toBe(95);
      expect(TOOL_SUCCESS_RATE_MEDIUM).toBe(85);
      expect(USER_AGREEMENT_RATE_HIGH).toBe(75);
      expect(USER_AGREEMENT_RATE_MEDIUM).toBe(45);
      expect(CACHE_EFFICIENCY_HIGH).toBe(40);
      expect(CACHE_EFFICIENCY_MEDIUM).toBe(15);
    });
  });
});
