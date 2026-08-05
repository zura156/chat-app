import { ContextHandlerConfig } from './types';
import { imageHandler } from './image.handler';
import { dmImageHandler } from './dm-image.handler';
import { videoHandler } from './video.handler';
import { fileHandler } from './file.handler';
import {
  onAvatarComplete,
  onGroupAvatarComplete,
  onCoverPhotoComplete,
  onDmAttachmentComplete,
} from './side-effects';
import { audioHandler } from './audio.handler';

export const contextHandlers: Record<string, ContextHandlerConfig> = {
  avatar: { handler: imageHandler, onComplete: onAvatarComplete },
  'group-avatar': { handler: imageHandler, onComplete: onGroupAvatarComplete },
  'cover-photo': { handler: imageHandler, onComplete: onCoverPhotoComplete },
  'dm-image': { handler: dmImageHandler, onComplete: onDmAttachmentComplete },
  'dm-video': {
    handler: (p) => videoHandler(p, false),
    onComplete: onDmAttachmentComplete,
  },
  'dm-audio': { handler: audioHandler, onComplete: onDmAttachmentComplete },
  'dm-file': { handler: fileHandler, onComplete: onDmAttachmentComplete },
  // post-* and story-* handlers were dropped along with their upload contexts:
  // there is no posts or stories feature for them to complete into.
};
