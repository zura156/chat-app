import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'fileType',
})
export class FileTypePipe implements PipeTransform {
  // Map common MIME types and extensions to clean display names
  private readonly typeMap: Record<string, string> = {
    // MIME Types
    'application/pdf': 'PDF',
    'application/msword': 'Word',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'Word',
    'application/vnd.ms-excel': 'Excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      'Excel',
    'application/vnd.ms-powerpoint': 'PPT',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'PPT',
    'application/zip': 'ZIP',
    'application/x-zip-compressed': 'ZIP',
    'application/json': 'JSON',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'text/html': 'HTML',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/svg+xml': 'SVG',
    'image/webp': 'WebP',
    'audio/mpeg': 'Audio',
    'video/mp4': 'Video',

    // Raw Extensions
    pdf: 'PDF',
    doc: 'Word',
    docx: 'Word',
    xls: 'Excel',
    xlsx: 'Excel',
    ppt: 'PPT',
    pptx: 'PPT',
    jpg: 'JPEG',
    jpeg: 'JPEG',
    png: 'PNG',
    svg: 'SVG',
    txt: 'Text',
    csv: 'CSV',
    zip: 'ZIP',
  };

  transform(value: string | null | undefined): string {
    if (!value) {
      return 'Unknown File';
    }

    // Normalize: lowercase and strip leading dot if it's an extension like ".pdf"
    const normalizedValue = value.toLowerCase().replace(/^\./, '');

    // 1. Check exact match in dictionary
    if (this.typeMap[normalizedValue]) {
      return this.typeMap[normalizedValue];
    }

    // 2. Fallback for unmapped MIME types (e.g., "application/x-rar" -> "X RAR")
    if (normalizedValue.includes('/')) {
      const splitType = normalizedValue.split('/');
      const subType = splitType[splitType.length - 1]; // get the part after the slash
      // Clean up hyphens/pluses and capitalize
      return subType.replace(/[-+]/g, ' ').toUpperCase() + ' File';
    }

    // 3. Ultimate fallback: just capitalize the raw string
    return normalizedValue.toUpperCase() + ' File';
  }
}
