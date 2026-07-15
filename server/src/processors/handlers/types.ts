export interface JobPayload {
  uploadId: string;
  userId: string;
  context: string;
  resourceId: string | null;
  fileKey: string;
  mimeType: string;
}

export interface ProcessResult {
  variants: Record<string, string>; // CDN URLs
  duration?: number; // audio/video length in seconds, when known
  finalBucket: string;
  finalKey: string;
}

export type ContextHandler = (payload: JobPayload) => Promise<ProcessResult>;

export interface ContextHandlerConfig {
  handler: ContextHandler;
  onComplete: (payload: JobPayload, result: ProcessResult) => Promise<void>;
}
