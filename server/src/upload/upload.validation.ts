import {
  ALLOWED_MIME_PREFIXES,
  MAX_FILES_PER_MESSAGE,
  SIZE_LIMITS,
} from '../config/upload.config';

export interface FileInput {
  name: string;
  mimeType: string;
  size: number;
}

export function getSizeLimit(mimeType: string): number {
  const prefix = mimeType.split('/')[0];
  return SIZE_LIMITS[prefix] ?? SIZE_LIMITS['default'];
}

export function validateFiles(files: FileInput[]): string | null {
  if (!Array.isArray(files) || files.length === 0) {
    return 'No files provided';
  }
  if (files.length > MAX_FILES_PER_MESSAGE) {
    return `Max ${MAX_FILES_PER_MESSAGE} files per message`;
  }
  for (const file of files) {
    const allowed = ALLOWED_MIME_PREFIXES.some((p) =>
      file.mimeType.startsWith(p),
    );
    if (!allowed) {
      return `Unsupported type: ${file.mimeType}`;
    }
    const limit = getSizeLimit(file.mimeType);
    if (file.size > limit) {
      return `${file.name} exceeds limit (${Math.round(limit / 1024 / 1024)}MB)`;
    }
  }
  return null;
}
