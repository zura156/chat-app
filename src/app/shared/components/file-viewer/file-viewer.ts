import { Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideFile,
  lucideFileArchive,
  lucideFileSpreadsheet,
  lucideFileText,
  lucideFileType,
} from '@ng-icons/lucide';
import { AttachmentI } from '../../../features/messages/interfaces/message.interface';
import { FileSizePipe } from '../../pipes/file-size.pipe';
import { FileVisualPipe } from '../../pipes/file-visual.pipe';
import { environment } from '../../../../environments/environment';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-file-viewer',
  templateUrl: './file-viewer.html',
  imports: [NgIcon, HlmIcon, FileSizePipe, FileVisualPipe],
  providers: [
    provideIcons({
      lucideDownload,
      lucideFile,
      lucideFileArchive,
      lucideFileSpreadsheet,
      lucideFileText,
      lucideFileType,
    }),
  ],
})
export class FileViewer {
  readonly apiUrl = environment.apiUrl;
  file = input<AttachmentI>();
}
