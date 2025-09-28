import { Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload } from '@ng-icons/lucide';
import { FileI } from '../../../features/messages/interfaces/message.interface';
import { FileSizePipe } from '../../pipes/file-size.pipe';
import { environment } from '../../../../environments/environment';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-file-viewer',
  templateUrl: './file-viewer.html',
  imports: [NgIcon, HlmIcon, FileSizePipe],
  providers: [
    provideIcons({
      lucideDownload,
    }),
  ],
})
export class FileViewer {
  readonly apiUrl = environment.apiUrl;
  file = input<FileI>();
}
