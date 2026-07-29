import * as XLSX from 'xlsx'

export function downloadExcelWorkbook(
  rows: unknown[][],
  filename: string,
  sheetName = 'Sheet1',
): void {
  downloadExcelWorkbookSheets([{ name: sheetName, rows }], filename)
}

export function downloadExcelWorkbookSheets(
  sheets: { name: string; rows: unknown[][] }[],
  filename: string,
): void {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name.slice(0, 31))
  }
  const safeName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  XLSX.writeFile(workbook, safeName)
}
