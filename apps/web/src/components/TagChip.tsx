import { X } from 'lucide-react';

export function readableTagText(color: string): '#000000' | '#ffffff' {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return '#ffffff';
  const channels = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

export default function TagChip({ name, color = '#596078', onRemove, compact = false }: {
  name: string;
  color?: string;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const foreground = readableTagText(color);
  return (
    <span className={`tag-chip ${compact ? 'tag-chip-compact' : ''}`} style={{ backgroundColor: color, color: foreground }}>
      <span className="tag-chip-name">{name}</span>
      {onRemove && (
        <button type="button" className="tag-chip-remove" onClick={onRemove} aria-label={`Remove tag ${name}`} style={{ color: foreground }}>
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
