import { Component, inject, OnInit } from '@angular/core';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { MessageService } from '../../services/message.service';
import { environment } from '../../../../../environments/environment';
import {
  MediaItem,
  MediaViewerService,
} from '../../../../shared/services/media-viewer.service';
import { AttachmentI } from '../../interfaces/message.interface';
import { AttachmentPlaceholder } from '../../../../shared/components/attachment-placeholder/attachment-placeholder';
import { AudioPlayer } from '../../../../shared/components/audio-player/audio-player';
import { FileViewer } from '../../../../shared/components/file-viewer/file-viewer';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucideCirclePlay } from '@ng-icons/lucide';

@Component({
  selector: 'app-media-files-list',
  templateUrl: './media-files-list.component.html',
  imports: [
    HlmTabsImports,
    HlmSpinner,
    AudioPlayer,
    AttachmentPlaceholder,
    FileViewer,
    NgIcon,
    HlmIcon,
  ],
  providers: [provideIcons({ lucideCirclePlay })],
})
export class MediaFilesListComponent implements OnInit {
  private messageService = inject(MessageService);
  private mediaViewerService = inject(MediaViewerService);

  apiUrl = environment.apiUrl;

  mediaMessages = this.messageService.activeMediaMessages;
  mediaMessagesResource = this.messageService.activeMediaMessagesResource;

  fileMessages = this.messageService.activeFileMessages;
  fileMessagesResource = this.messageService.activeFileMessagesResource;

  ngOnInit(): void {
    this.messageService.fetchMediaMessages();
  }

  fetchMedia(): void {
    this.messageService.fetchMediaMessages();
  }

  fetchFiles(): void {
    this.messageService.fetchFileMessages();
  }
  /**
   * The clicked item's position is derived from its uploadId against the
   * flattened gallery, not from the template's `$index` — those index different
   * things (one attachment within a message, versus the gallery as a whole), so
   * the parameter was both unused and misleading.
   */
  openMedia(attachment: AttachmentI) {
    if (attachment.context === 'dm-file' || attachment.context === 'dm-audio') {
      return;
    }

    const items: MediaItem[] = this.mediaMessages().flatMap((message) =>
      (message.attachments ?? [])
        .filter(
          (a) =>
            a.status === 'ready' &&
            a.variants &&
            (a.context === 'dm-image' || a.context === 'dm-video'),
        )
        .map((a) => ({
          _id: String(message._id),
          uploadId: a.uploadId,
          type: (a.context === 'dm-image' ? 'image' : 'video') as
            | 'image'
            | 'video',
          url:
            a.context === 'dm-image'
              ? (a.variants?.large ?? a.variants?.medium ?? '')
              : (a.variants?.original ?? a.variants?.hls ?? ''),
          thumbnail: a.variants?.thumbnail,
          thumb: a.variants?.thumb,
          name: a.originalName,
          size: a.fileSize,
        })),
    );

    if (!items.length) return;

    const clickedIndex = Math.max(
      0,
      items.findIndex((m) => m.uploadId === attachment.uploadId),
    );

    this.mediaViewerService.openGallery(items, clickedIndex);
  }
}
