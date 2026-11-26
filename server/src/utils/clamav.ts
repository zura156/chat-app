import NodeClam from 'clamscan';
import { Readable } from 'stream';
import config from '../config/config';

// @types/clamscan incorrectly types init() as Promise<void>
// Runtime returns Promise<NodeClam> — using type assertion as workaround
type ClamScanInstance = Omit<NodeClam, 'init'>;

let clamInstance: ClamScanInstance | null = null;

export const getClamAV = async (): Promise<ClamScanInstance> => {
  if (clamInstance) return clamInstance;

  clamInstance = (await new NodeClam().init({
    removeInfected: false,
    quarantineInfected: false,
    scanLog: undefined,
    debugMode: false,
    clamdscan: {
      host: config.clamavHost,
      port: config.clamavPort,
      timeout: 120_000,
      localFallback: false,
      multiscan: true,
    },
    preference: 'clamdscan',
  })) as unknown as ClamScanInstance;

  return clamInstance;
};

export interface ScanResult {
  isInfected: boolean;
  viruses: string[];
}

// What clamscan's scanStream really resolves with. @types/clamscan says
// `isInfected: boolean`, but clamscan 2.4 resolves `null` whenever clamd's
// reply is neither "OK", "FOUND" nor "ERROR": "COMMAND READ TIMED OUT", or an
// empty reply from a clamd that went away after the last byte was sent.
interface RawScanResult {
  isInfected: boolean | null | undefined;
  viruses?: string[];
  resultString?: string;
}

/**
 * Scans a stream through clamd. Only an explicit verdict counts: anything else
 * throws, so BullMQ retries the job and its last failure marks the upload
 * failed. This used to read a missing verdict as clean (`isInfected ?? false`),
 * which stored the file as scanned when it never was (SECURITY-FIXES.md 2.3a).
 */
export const scanStream = async (stream: Readable): Promise<ScanResult> => {
  const clam = await getClamAV();
  const result = (await clam.scanStream(stream)) as RawScanResult;

  if (result.isInfected === true) {
    return { isInfected: true, viruses: result.viruses ?? [] };
  }
  if (result.isInfected === false) {
    return { isInfected: false, viruses: [] };
  }

  // clamd's own reply, which names no user data ("stream: ..."), cut short so
  // a runaway one can't flood the job's failedReason.
  const reply = JSON.stringify((result.resultString ?? '').slice(0, 120));
  throw new Error(`ClamAV gave no verdict (reply ${reply})`);
};
