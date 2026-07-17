import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskDescription from './TaskDescription';

describe('TaskDescription', () => {
  it('renders Markdown with semantic formatting', () => {
    render(<TaskDescription description={'Use **care**, not ~~haste~~:\n\n- Read the [guide](https://example.com)\n- Ship it'} />);

    expect(screen.getByText('care').tagName).toBe('STRONG');
    expect(screen.getByText('haste').tagName).toBe('DEL');
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'guide' })).toHaveAttribute('href', 'https://example.com');
  });

  it('does not mount raw HTML as DOM', () => {
    const { container } = render(<TaskDescription description={'<span data-testid="unsafe">Unsafe</span>'} />);

    expect(screen.getByText('<span data-testid="unsafe">Unsafe</span>')).toBeVisible();
    expect(screen.queryByTestId('unsafe')).toBeNull();
    expect(container.querySelector('span')).toBeNull();
  });
});
