import JSZip from 'jszip'
import type { SourceFile } from './files.js'

/** Every entry gets this date, so the same files always pack to the same bytes. */
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1))

/** The package as the ZIP that goes to the machine: sorted, fixed dates, scripts 0700 and other files 0600. */
export async function packFiles(files: SourceFile[]): Promise<Buffer> {
  const out = new JSZip()
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    out.file(f.path, f.bytes, { unixPermissions: f.exec ? 0o100700 : 0o100600, createFolders: false, date: FIXED_DATE })
  }
  return out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' })
}
