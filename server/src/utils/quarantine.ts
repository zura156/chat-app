import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3App, s3Quarantine } from '../config/s3';
import { Upload } from '../upload/upload.model';
import config from '../config/config';

export const moveToQuarantine = async (
  fileKey: string,
  uploadId: string,
  viruses: string[],
): Promise<void> => {
  const quarantineKey = `quarantine/${uploadId}/${fileKey.split('/').pop()}`;

  // copy to quarantine bucket using quarantine-writer key
  await s3Quarantine.send(
    new CopyObjectCommand({
      CopySource: `${config.s3TempBucket}/${fileKey}`,
      Bucket: config.s3QuarantineBucket,
      Key: quarantineKey,
      Metadata: {
        viruses: viruses.join(','),
        originalKey: fileKey,
        uploadId,
        quarantinedAt: new Date().toISOString(),
      },
      MetadataDirective: 'REPLACE',
    }),
  );

  // delete from temp
  await s3App.send(
    new DeleteObjectCommand({
      Bucket: config.s3TempBucket,
      Key: fileKey,
    }),
  );

  // update upload record
  await Upload.findByIdAndUpdate(uploadId, {
    status: 'infected',
    variants: null,
  });
};
