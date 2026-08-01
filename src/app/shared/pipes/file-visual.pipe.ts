import { Pipe, PipeTransform } from '@angular/core';

export interface FileVisual {
  icon: string;
  bg: string;
  ext: string;
}

const EXT_MAP: Record<string, Omit<FileVisual, 'ext'>> = {
  pdf: { icon: 'lucideFileText', bg: 'bg-red-500/10 text-red-500' },
  doc: { icon: 'lucideFileText', bg: 'bg-blue-500/10 text-blue-500' },
  docx: { icon: 'lucideFileText', bg: 'bg-blue-500/10 text-blue-500' },
  xls: { icon: 'lucideFileSpreadsheet', bg: 'bg-emerald-500/10 text-emerald-500' },
  xlsx: { icon: 'lucideFileSpreadsheet', bg: 'bg-emerald-500/10 text-emerald-500' },
  csv: { icon: 'lucideFileSpreadsheet', bg: 'bg-emerald-500/10 text-emerald-500' },
  ppt: { icon: 'lucideFileType', bg: 'bg-orange-500/10 text-orange-500' },
  pptx: { icon: 'lucideFileType', bg: 'bg-orange-500/10 text-orange-500' },
  txt: { icon: 'lucideFileText', bg: 'bg-slate-500/10 text-slate-500' },
  zip: { icon: 'lucideFileArchive', bg: 'bg-amber-500/10 text-amber-500' },
  '7z': { icon: 'lucideFileArchive', bg: 'bg-amber-500/10 text-amber-500' },
  rar: { icon: 'lucideFileArchive', bg: 'bg-amber-500/10 text-amber-500' },
};

const DEFAULT: Omit<FileVisual, 'ext'> = {
  icon: 'lucideFile',
  bg: 'bg-slate-500/10 text-slate-500',
};

// Covers every type in file-picker.ts's `dm-file` allowlist. Extend EXT_MAP
// if that allowlist grows.
@Pipe({ name: 'fileVisual' })
export class FileVisualPipe implements PipeTransform {
  transform(filename: string | null | undefined): FileVisual {
    const ext = (filename?.split('.').pop() || '').toLowerCase();
    return { ...(EXT_MAP[ext] ?? DEFAULT), ext: ext ? ext.toUpperCase() : 'FILE' };
  }
}
