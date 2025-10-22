/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { TextInput } from './TextInput.js';
import { useKeypress } from '../../hooks/useKeypress.js';

// Mocks
vi.mock('../../hooks/useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

const mockedUseKeypress = useKeypress as Mock;

describe('TextInput', () => {
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders with an initial value', () => {
    const { lastFrame } = render(
      <TextInput value="test" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain('test');
  });

  it('renders a placeholder', () => {
    const { lastFrame } = render(
      <TextInput value="" placeholder="testing" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain('testing');
  });

  it('handles character input', () => {
    const onChange = vi.fn();
    render(<TextInput value="" onChange={onChange} />);
    const keypressHandler = mockedUseKeypress.mock.calls[0][0];

    keypressHandler({ name: 'a', sequence: 'a' });

    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('handles backspace', () => {
    const onChange = vi.fn();
    render(<TextInput value="test" onChange={onChange} />);
    const keypressHandler = mockedUseKeypress.mock.calls[0][0];

    keypressHandler({ name: 'backspace' });

    expect(onChange).toHaveBeenCalledWith('tes');
  });

  it('handles left arrow', () => {
    const { lastFrame } = render(
      <TextInput value="test" onChange={() => {}} />,
    );
    const keypressHandler = mockedUseKeypress.mock.calls[0][0];

    keypressHandler({ name: 'left' });

    // Cursor moves from end to before 't'
    expect(lastFrame()).toMatchSnapshot();
  });

  it('handles right arrow', () => {
    const { lastFrame } = render(
      <TextInput value="test" onChange={() => {}} />,
    );
    const keypressHandler = mockedUseKeypress.mock.calls[0][0];

    // Move cursor to the left first
    keypressHandler({ name: 'left' });
    keypressHandler({ name: 'left' });

    // Now move right
    keypressHandler({ name: 'right' });

    expect(lastFrame()).toMatchSnapshot();
  });

  it('calls onSubmit on return', () => {
    const onSubmit = vi.fn();
    render(<TextInput value="test" onSubmit={onSubmit} onChange={() => {}} />);
    const keypressHandler = mockedUseKeypress.mock.calls[0][0];

    keypressHandler({ name: 'return' });

    expect(onSubmit).toHaveBeenCalledWith('test');
  });

  it('calls onCancel on escape', async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <TextInput value="" onCancel={onCancel} onChange={() => {}} />,
    );
    const keypressHandler = mockedUseKeypress.mock.calls[0][0];

    keypressHandler({ name: 'escape' });
    rerender(<TextInput value="" onCancel={onCancel} onChange={() => {}} />);
    await vi.runAllTimersAsync();

    expect(onCancel).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('masks the input value', () => {
    const { lastFrame } = render(
      <TextInput value="secret" mask="*" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain('******');
  });

  it('does not show cursor when not focused', () => {
    const { lastFrame } = render(
      <TextInput value="test" focus={false} onChange={() => {}} />,
    );
    expect(lastFrame()).not.toContain('\u001b[7m'); // Inverse video chalk
  });
});
