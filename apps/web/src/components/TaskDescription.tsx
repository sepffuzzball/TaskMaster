import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function TaskDescription({ description, id, hidden }: { description: string; id?: string; hidden?: boolean }) {
  return (
    <div className="task-description" id={id} hidden={hidden}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
    </div>
  );
}
