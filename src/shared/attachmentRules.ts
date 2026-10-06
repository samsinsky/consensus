import type { AttachmentKind } from './types.js';

/** File rules shared by the server and the page, so the page can refuse a file before uploading it. */
export const ATTACHMENT_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  chars: 100_000,
  perMessage: 10,
};

export const TEXT_TYPES: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html',
};
export const DOC_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
};
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function kindOf(ext: string): AttachmentKind | undefined {
  if (IMAGE_TYPES[ext]) return 'image';
  if (TEXT_TYPES[ext] || DOC_TYPES[ext]) return 'text';
  return undefined;
}

/** Why a file can't be attached, or undefined when it can. */
export function checkFile(name: string, size: number): string | undefined {
  const ext = extensionOf(name);
  const kind = kindOf(ext);
  if (!kind) return `Consensus can't read ${ext || 'files without an extension'}. Attach text, Word, PDF or image files.`;
  const limit = kind === 'image' ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.fileBytes;
  if (size > limit) return `${name.split(/[\\/]/).pop()} is larger than ${limit / 1024 / 1024}MB.`;
  return undefined;
}
