import { useId, useMemo, useState } from 'react';
import type { Tag } from '../types';
import TagChip from './TagChip';

const VALID_TAG = /^[A-Za-z0-9_-]{1,32}$/;

export default function TagInput({ value, availableTags, onChange, label = 'Tags' }: {
  value: string[];
  availableTags: Tag[];
  onChange: (names: string[]) => void;
  label?: string;
}) {
  const id = useId();
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [feedback, setFeedback] = useState('');
  const selected = useMemo(() => new Set(value.map(name => name.toLowerCase())), [value]);
  const suggestions = useMemo(() => (Array.isArray(availableTags) ? availableTags : []).filter(tag =>
    !selected.has(tag.name.toLowerCase()) && tag.name.toLowerCase().includes(input.trim().toLowerCase())
  ), [availableTags, input, selected]);

  const commit = (raw: string) => {
    const name = raw.trim();
    if (!name) return false;
    if (value.length >= 10) { setFeedback('A task can have up to 10 tags.'); return false; }
    if (!VALID_TAG.test(name)) { setFeedback('Use 1-32 letters, numbers, hyphens, or underscores.'); return false; }
    if (selected.has(name.toLowerCase())) { setFeedback(`${name} is already selected.`); return false; }
    onChange([...value, name]);
    setInput('');
    setFeedback(`Added tag ${name}.`);
    setActiveIndex(0);
    return true;
  };
  const remove = (index: number) => {
    const name = value[index];
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
    setFeedback(`Removed tag ${name}.`);
  };
  const expanded = open && suggestions.length > 0;

  return (
    <div className="form-field tag-input-field">
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="tag-input-shell" onClick={event => (event.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
        {value.map((name, index) => {
          const tag = (Array.isArray(availableTags) ? availableTags : []).find(item => item.name.toLowerCase() === name.toLowerCase());
          return <TagChip key={name.toLowerCase()} name={name} color={tag?.color} onRemove={() => remove(index)} />;
        })}
        <input
          id={`${id}-input`}
          className="tag-input-control"
          value={input}
          onChange={event => { setInput(event.target.value); setOpen(true); setActiveIndex(0); setFeedback(''); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => (index + 1) % suggestions.length); }
            else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => (index - 1 + suggestions.length) % suggestions.length); }
            else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
            else if (event.key === 'Backspace' && !input && value.length) { event.preventDefault(); remove(value.length - 1); }
            else if (event.key === 'Enter') {
              event.preventDefault();
              const suggestion = expanded ? suggestions[activeIndex] : undefined;
              commit(suggestion?.name ?? input);
            } else if ((event.key === ' ' || event.key === ',') && !(event.nativeEvent as KeyboardEvent).isComposing) {
              event.preventDefault();
              commit(input);
            }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={expanded ? `${id}-option-${activeIndex}` : undefined}
          aria-describedby={`${id}-help ${id}-feedback`}
          placeholder={value.length ? 'Add another...' : 'Type a tag...'}
          autoComplete="off"
        />
      </div>
      {expanded && (
        <ul className="tag-suggestions" id={`${id}-listbox`} role="listbox">
          {suggestions.map((tag, index) => (
            <li
              key={tag.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'active' : ''}
              onMouseDown={event => event.preventDefault()}
              onClick={() => { commit(tag.name); setOpen(false); }}
            >
              <TagChip name={tag.name} color={tag.color} compact />
            </li>
          ))}
        </ul>
      )}
      <span id={`${id}-help`} className="field-help">Separate tags with Space or comma. {value.length}/10 selected.</span>
      <span id={`${id}-feedback`} className="field-feedback" aria-live="polite">{feedback}</span>
    </div>
  );
}
