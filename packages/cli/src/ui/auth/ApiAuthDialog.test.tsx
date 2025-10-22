/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ApiAuthDialog } from './ApiAuthDialog.js';
import { TextInput } from '../components/shared/TextInput.js';

// Mocks
vi.mock('../components/shared/TextInput.js', () => ({
  TextInput: vi.fn(() => null),
}));

const mockedTextInput = TextInput as Mock;

describe('ApiAuthDialog', () => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders correctly', () => {
    const { lastFrame } = render(
      <ApiAuthDialog onSubmit={onSubmit} onCancel={onCancel} />,
    );

    expect(lastFrame()).toMatchSnapshot();
  });

  it('renders with a defaultValue', () => {
    render(
      <ApiAuthDialog
        onSubmit={onSubmit}
        onCancel={onCancel}
        defaultValue="test-key"
      />,
    );

    expect(mockedTextInput).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'test-key',
      }),
      undefined,
    );
  });

  it('calls onSubmit when the text input is submitted', () => {
    render(<ApiAuthDialog onSubmit={onSubmit} onCancel={onCancel} />);

    const { onSubmit: onSubmitTextInput } = mockedTextInput.mock.calls[0][0];
    onSubmitTextInput('submitted-key');

    expect(onSubmit).toHaveBeenCalledWith('submitted-key');
  });

  it('calls onCancel when the text input is cancelled', () => {
    render(<ApiAuthDialog onSubmit={onSubmit} onCancel={onCancel} />);

    const { onCancel: onCancelTextInput } = mockedTextInput.mock.calls[0][0];
    onCancelTextInput();

    expect(onCancel).toHaveBeenCalled();
  });

  it('displays an error message', () => {
    const { lastFrame } = render(
      <ApiAuthDialog
        onSubmit={onSubmit}
        onCancel={onCancel}
        error="Invalid API Key"
      />,
    );

    expect(lastFrame()).toContain('Invalid API Key');
  });
});
