export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 100;
export const MAX_WORKBOOK_BYTES = 250 * 1024 * 1024;
export const MAX_CELL_LENGTH = 65_536;
export const MAX_SOURCE_ROWS = 200_000;
export const SUPPORTED_FILE_PATTERN = /\.(xlsx|xlsm|xls|ods|csv|tsv|json|ndjson|jsonl)$/i;
export const SUPPORTED_FILE_MESSAGE = 'Choose an xlsx, xlsm, xls, ods, csv, tsv, json, or ndjson file.';

export function normalizeImportOptions(options = {}) {
  const headerRow = Number(options.headerRow ?? 0);
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow > 1_000) throw new Error('Header row must be Auto (0) or a row between 1 and 1,000.');
  return {
    headerRow, headerless: options.headerless === true,
    delimiter: [',', ';', '\t', '|'].includes(options.delimiter) ? options.delimiter : 'auto',
    numericLocale: ['decimal-dot', 'decimal-comma'].includes(options.numericLocale) ? options.numericLocale : 'auto',
    dateOrder: ['dmy', 'mdy'].includes(options.dateOrder) ? options.dateOrder : 'iso',
    percentScale: options.percentScale === 'whole' ? 'whole' : 'fraction',
  };
}
