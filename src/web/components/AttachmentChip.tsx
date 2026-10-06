import type { Attachment } from '../../shared/types.js';
import { api } from '../api.js';
import { formatSize } from '../format.js';

type Props = {
  threadId: string;
  name: string;
  size: number;
  attachment?: Attachment;
  status?: 'uploading' | 'ready' | 'error';
  error?: string;
  onRemove?: () => void;
};

export function AttachmentChip({ threadId, name, size, attachment, status = 'ready', error, onRemove }: Props) {
  const image = attachment?.kind === 'image';
  const meta =
    status === 'uploading' ? 'Uploading…' : status === 'error' ? error : `${formatSize(size)}${attachment?.truncated ? ' · cut to 100,000 characters' : ''}`;
  return (
    <div className={`att-chip ${status}`}>
      {image && attachment ? (
        <a href={api.attachmentUrl(threadId, attachment.id)} target="_blank" rel="noreferrer" title="Open full size">
          <img src={api.attachmentUrl(threadId, attachment.id)} alt={name} />
        </a>
      ) : (
        <span className="att-icon">📄</span>
      )}
      <span className="att-text">
        <span className="att-name">{name}</span>
        <span className="att-meta">{meta}</span>
      </span>
      {onRemove && <button className="ghost" onClick={onRemove} title="Remove">×</button>}
    </div>
  );
}
