import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function TaskDescription({ description }: { description: string }) {
  return (
    <div className="task-description">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
    </div>
  );
}
