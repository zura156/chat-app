import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'fileType',
})
export class FileTypePipe implements PipeTransform {
  // Map common MIME types and extensions to clean display names
  private readonly typeMap: Record<string, string> = {
    // MIME Types
    'application/pdf': 'PDF Document',
    'application/msword': 'Word Document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'Word Document',
    'application/vnd.ms-excel': 'Excel Spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      'Excel Spreadsheet',
    'application/vnd.ms-powerpoint': 'PowerPoint Presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'PowerPoint Presentation',
    'application/zip': 'ZIP Archive',
    'application/x-zip-compressed': 'ZIP Archive',
    'application/json': 'JSON File',
    'text/plain': 'Text File',
    'text/csv': 'CSV File',
    'text/html': 'HTML Document',
    'image/jpeg': 'JPEG Image',
    'image/png': 'PNG Image',
    'image/gif': 'GIF Image',
    'image/svg+xml': 'SVG Image',
    'image/webp': 'WebP Image',
    'audio/mpeg': 'Audio File',
    'video/mp4': 'Video File',

    // Raw Extensions
    pdf: 'PDF Document',
    doc: 'Word Document',
    docx: 'Word Document',
    xls: 'Excel Spreadsheet',
    xlsx: 'Excel Spreadsheet',
    ppt: 'PowerPoint Presentation',
    pptx: 'PowerPoint Presentation',
    jpg: 'JPEG Image',
    jpeg: 'JPEG Image',
    png: 'PNG Image',
    svg: 'SVG Image',
    txt: 'Text File',
    csv: 'CSV File',
    zip: 'ZIP Archive',
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
