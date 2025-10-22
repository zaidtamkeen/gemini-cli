/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import type { Key } from '../../hooks/useKeypress.js';
import { Text, Box } from 'ink';
import { useKeypress } from '../../hooks/useKeypress.js';
import chalk from 'chalk';
import { theme } from '../../semantic-colors.js';

export interface TextInputProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  mask?: string;
  focus?: boolean;
}

export function TextInput({
  value,
  placeholder = '',
  onChange,
  onSubmit,
  onCancel,
  mask,
  focus = true,
}: TextInputProps): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // When the controlled value changes, update the cursor position if it's
    // out of bounds. This can happen if the parent component changes the
    // value programmatically.
    if (cursorOffset > value.length) {
      setCursorOffset(value.length);
    }
  }, [value, cursorOffset]);

  useEffect(() => {
    if (isExiting && onCancel) {
      // Give Ink a moment to run the useInput cleanup before we trigger the
      // parent state change that unmounts this component.
      const timer = setTimeout(() => {
        onCancel();
      }, 0);
      return () => clearTimeout(timer);
    }
    return;
  }, [isExiting, onCancel]);

  useKeypress(
    useCallback(
      (key: Key) => {
        if (key.name === 'escape') {
          setIsExiting(true);
          return;
        }

        if (key.name === 'return') {
          onSubmit?.(value);
          return;
        }

        if (key.name === 'backspace' || key.name === 'delete') {
          if (cursorOffset > 0) {
            const newValue =
              value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
            setCursorOffset(cursorOffset - 1);
            onChange(newValue);
          }
          return;
        }

        if (key.name === 'left') {
          if (cursorOffset > 0) {
            setCursorOffset(cursorOffset - 1);
          }
          return;
        }

        if (key.name === 'right') {
          if (cursorOffset < value.length) {
            setCursorOffset(cursorOffset + 1);
          }
          return;
        }

        // Normal character input
        if (key.sequence && !key.ctrl && !key.meta) {
          const newValue =
            value.slice(0, cursorOffset) +
            key.sequence +
            value.slice(cursorOffset);
          setCursorOffset(cursorOffset + key.sequence.length);
          onChange(newValue);
        }
      },
      [value, cursorOffset, onChange, onSubmit, setIsExiting],
    ),
    { isActive: focus && !isExiting },
  );

  const renderedValue = mask ? mask.repeat(value.length) : value;
  const placeholderText =
    value.length === 0 && placeholder ? (
      <Text color={theme.text.secondary}>{placeholder}</Text>
    ) : null;

  // Render cursor
  let textWithCursor;
  if (focus) {
    const charAtCursor = renderedValue[cursorOffset] || ' ';
    textWithCursor = (
      <Text>
        {renderedValue.slice(0, cursorOffset)}
        {chalk.inverse(charAtCursor)}
        {renderedValue.slice(cursorOffset + 1)}
      </Text>
    );
  } else {
    textWithCursor = <Text>{renderedValue}</Text>;
  }

  return (
    <Box>
      {placeholderText ? (
        focus ? (
          <Text>
            {chalk.inverse(placeholder[0] || ' ')}
            <Text color={theme.text.secondary}>{placeholder.slice(1)}</Text>
          </Text>
        ) : (
          placeholderText
        )
      ) : (
        textWithCursor
      )}
    </Box>
  );
}
