import { describe, expect, it } from 'vitest';
import { FileVisualPipe } from './file-visual.pipe';

/*
 * Picks the icon, tint and short label for every non-media attachment — the
 * chip in a message bubble and the rows of the files panel both render straight
 * off this. It is fed `fileName` from an attachment record, which is whatever
 * the uploader's filesystem called it: no extension, several dots, uppercase,
 * or trailing junk from a paste.
 *
 * The mapping is grouped rather than per-extension — the spreadsheet formats
 * share a tint, the archives share another — so a wrong lookup shows a
 * plausible-looking icon in the wrong colour rather than an obvious break.
 */

const visual = (filename: string | null | undefined) =>
  new FileVisualPipe().transform(filename);

describe('FileVisualPipe', () => {
  it('renders the extension as the label, uppercased', () => {
    expect(visual('quarterly.pdf').ext).toBe('PDF');
    expect(visual('NOTES.TXT').ext).toBe('TXT');
  });

  it.each([
    ['report.pdf', 'lucideFileText'],
    ['brief.doc', 'lucideFileText'],
    ['brief.docx', 'lucideFileText'],
    ['notes.txt', 'lucideFileText'],
    ['budget.xls', 'lucideFileSpreadsheet'],
    ['budget.xlsx', 'lucideFileSpreadsheet'],
    ['export.csv', 'lucideFileSpreadsheet'],
    ['deck.ppt', 'lucideFileType'],
    ['deck.pptx', 'lucideFileType'],
    ['bundle.zip', 'lucideFileArchive'],
    ['bundle.7z', 'lucideFileArchive'],
    ['bundle.rar', 'lucideFileArchive'],
  ])('gives %s the %s icon', (filename, icon) => {
    expect(visual(filename).icon).toBe(icon);
  });

  it('tints a format the same as the others in its group', () => {
    // The grouping is the point: a spreadsheet reading as a document is not a
    // crash, just a quietly wrong colour, so it needs pinning rather than
    // eyeballing.
    expect(visual('a.xls').bg).toBe(visual('b.csv').bg);
    expect(visual('a.doc').bg).toBe(visual('b.docx').bg);
    expect(visual('a.zip').bg).toBe(visual('b.rar').bg);
    expect(visual('a.ppt').bg).toBe(visual('b.pptx').bg);
  });

  it('does not give the office formats the same tint as each other', () => {
    const bgs = ['a.pdf', 'a.doc', 'a.xls', 'a.ppt', 'a.zip'].map(
      (f) => visual(f).bg,
    );
    expect(new Set(bgs).size).toBe(bgs.length);
  });

  it('matches an extension regardless of case', () => {
    // Windows and older cameras hand over uppercase names, and macOS
    // round-trips mixed case; all three reach the uploader untouched.
    expect(visual('REPORT.PDF').icon).toBe('lucideFileText');
    expect(visual('Report.Pdf').icon).toBe('lucideFileText');
    expect(visual('bundle.ZIP').icon).toBe('lucideFileArchive');
  });

  it('reads the extension from the last dot, not the first', () => {
    expect(visual('archive.tar.gz').ext).toBe('GZ');
    expect(visual('my.report.final.pdf').icon).toBe('lucideFileText');
  });

  it('falls back to the generic file look for an unmapped type', () => {
    const unknown = visual('firmware.bin');
    expect(unknown.icon).toBe('lucideFile');
    expect(unknown.ext).toBe('BIN');
    // Still labelled with its own extension — the fallback is the icon, not
    // the text, so the user can still tell what they are looking at.
    expect(visual('data.parquet').ext).toBe('PARQUET');
  });

  it('labels a name with no extension with the whole name', () => {
    /*
     * Pinned as a limitation, not as intent. `'README'.split('.').pop()` is
     * the whole name, and the `'FILE'` fallback only covers an *empty*
     * extension — so an extensionless upload puts its full name into a slot
     * sized for three or four characters.
     *
     * Rare from a desktop file picker, routine from Linux and from
     * screenshots pasted without a name.
     */
    const none = visual('README');
    expect(none.ext).toBe('README');
    expect(none.icon).toBe('lucideFile');
  });

  it('falls back to "FILE" when the extension is genuinely empty', () => {
    // The reachable paths: a name ending in a dot, and no name at all.
    expect(visual('report.').ext).toBe('FILE');
    expect(visual('').ext).toBe('FILE');
  });

  it('survives a missing filename', () => {
    // Attachments still processing have no name yet, and the placeholder chip
    // renders before the upload record is complete.
    for (const value of [null, undefined, '']) {
      const result = visual(value);
      expect(result.ext).toBe('FILE');
      expect(result.icon).toBe('lucideFile');
      expect(result.bg).toBeTruthy();
    }
  });

  it('treats a dotfile as having no extension', () => {
    // `'.gitignore'.split('.')` is ['', 'gitignore'], so the "extension" is the
    // whole name. Pinned as-is: it labels the chip GITIGNORE, which is wrong
    // but harmless, and worth noticing if the parsing is ever tightened.
    expect(visual('.gitignore').ext).toBe('GITIGNORE');
  });

  it('always returns every field, so the template never renders undefined', () => {
    for (const name of ['a.pdf', 'a.unknown', '', null]) {
      const result = visual(name);
      expect(result).toEqual({
        icon: expect.any(String),
        bg: expect.any(String),
        ext: expect.any(String),
      });
    }
  });
});
