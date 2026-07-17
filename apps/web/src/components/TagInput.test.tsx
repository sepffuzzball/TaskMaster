import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import TagInput from './TagInput';

const tags = [{ id: '1', name: 'urgent', color: '#f4476b', version: 1, createdAt: '', updatedAt: '' }];

function Harness() {
  const [value, setValue] = useState<string[]>([]);
  return <TagInput value={value} availableTags={tags} onChange={setValue} />;
}

describe('TagInput', () => {
  it('commits comma and space separators and removes the last chip with Backspace', async () => {
    render(<Harness />);
    const user = await userEvent.setup();
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, 'alpha,');
    expect(screen.getByText('alpha')).toBeTruthy();
    await user.type(input, 'beta ');
    expect(screen.getByText('beta')).toBeTruthy();
    await user.keyboard('{Backspace}');
    expect(screen.queryByText('beta')).toBeNull();
  });

  it('uses keyboard-highlighted suggestions and exposes combobox semantics', async () => {
    render(<Harness />);
    const user = await userEvent.setup();
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, 'urg');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const option = screen.getByRole('option', { name: 'urgent' });
    expect(option.tagName).toBe('LI');
    expect(option.querySelector('button')).toBeNull();
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    await user.keyboard('{Enter}');
    expect(screen.getByText('urgent')).toBeTruthy();
    expect(screen.getByLabelText('Remove tag urgent')).toBeTruthy();
  });

  it('keeps input focus when a suggestion is selected with the mouse', async () => {
    render(<Harness />);
    const user = await userEvent.setup();
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, 'urg');
    const option = screen.getByRole('option', { name: 'urgent' });
    await user.click(option);
    expect(input).toHaveFocus();
    expect(screen.getByLabelText('Remove tag urgent')).toBeTruthy();
  });
});
