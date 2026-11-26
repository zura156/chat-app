import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The scan wrapper must fail closed. clamscan resolves `isInfected: null` when
 * clamd's reply is neither OK, FOUND nor ERROR (a read timeout, or an empty
 * reply from a clamd that went away mid-scan), and the wrapper used to read
 * that as clean, storing an unscanned file as scanned (SECURITY-FIXES.md 2.3a).
 *
 * clamscan is mocked: a real clamd can't be made to give no verdict on cue.
 */

const scan = vi.fn();
vi.mock('clamscan', () => ({
  default: class {
    async init() {
      return { scanStream: scan };
    }
  },
}));

import { scanStream } from '../../utils/clamav';

const file = () => Readable.from([Buffer.from('hello')]);

describe('scanStream', () => {
  // A block, not `() => scan.mockReset()`: vitest calls a function returned
  // from beforeEach as the test's teardown, and mockReset returns the mock.
  beforeEach(() => {
    scan.mockReset();
  });

  it('passes a clean verdict through', async () => {
    scan.mockResolvedValue({ isInfected: false, viruses: [] });
    await expect(scanStream(file())).resolves.toEqual({
      isInfected: false,
      viruses: [],
    });
  });

  it('passes an infected verdict through with the virus names', async () => {
    scan.mockResolvedValue({
      isInfected: true,
      viruses: ['Eicar-Signature'],
    });
    await expect(scanStream(file())).resolves.toEqual({
      isInfected: true,
      viruses: ['Eicar-Signature'],
    });
  });

  it('throws when clamd gives no verdict, instead of calling it clean', async () => {
    scan.mockResolvedValue({
      isInfected: null,
      viruses: [],
      resultString: 'COMMAND READ TIMED OUT',
    });
    await expect(scanStream(file())).rejects.toThrow(
      'ClamAV gave no verdict (reply "COMMAND READ TIMED OUT")',
    );
  });

  it('throws on an empty reply', async () => {
    scan.mockResolvedValue({ isInfected: null, viruses: [], resultString: '' });
    await expect(scanStream(file())).rejects.toThrow('ClamAV gave no verdict');
  });

  it('throws when the verdict is missing altogether', async () => {
    scan.mockResolvedValue({ viruses: [] });
    await expect(scanStream(file())).rejects.toThrow('ClamAV gave no verdict');
  });

  it('lets a connection error through as it is', async () => {
    scan.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(scanStream(file())).rejects.toThrow('ECONNREFUSED');
  });
});
