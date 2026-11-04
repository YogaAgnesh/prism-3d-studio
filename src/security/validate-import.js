import { MAX_WORKBOOK_BYTES, SUPPORTED_FILE_PATTERN, SUPPORTED_FILE_MESSAGE } from '../import/limits.js';
export { MAX_WORKBOOK_BYTES } from '../import/limits.js';
export const MAX_PROJECT_BYTES = 10 * 1024 * 1024;


export function validateImportFile(file) {
  if (!file || typeof file.name !== 'string') return { ok: false, message: 'Choose a workbook or CSV file.' };
  if (!SUPPORTED_FILE_PATTERN.test(file.name)) return { ok: false, message: SUPPORTED_FILE_MESSAGE };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, message: 'The selected file is empty.' };
  if (file.size > MAX_WORKBOOK_BYTES) return { ok: false, message: 'This file exceeds the 250 MB local import limit.' };
  return { ok: true };
}

export function validateProjectBytes(bytes) {
  const size = bytes?.byteLength ?? bytes?.length ?? 0;
  if (!size) return { ok: false, message: 'The selected project is empty.' };
  if (size > MAX_PROJECT_BYTES) return { ok: false, message: 'This project exceeds the 10 MB import limit.' };
  return { ok: true };
}
