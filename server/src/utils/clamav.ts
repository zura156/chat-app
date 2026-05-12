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

export const scanStream = async (stream: Readable): Promise<ScanResult> => {
  const clam = await getClamAV();
  const { isInfected, viruses } = await clam.scanStream(stream);
  return { isInfected: isInfected ?? false, viruses: viruses ?? [] };
};
