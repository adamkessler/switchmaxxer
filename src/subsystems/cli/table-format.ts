export type TableColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

function formatCell(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

export function formatColumnAlignedTable<T>(rows: T[], columns: Array<TableColumn<T>>): string {
  const renderedRows = rows.map((row) => columns.map((column) => formatCell(column.value(row))));
  const widths = columns.map((column, index) => {
    const headerWidth = formatCell(column.header).length;
    const valueWidth = renderedRows.reduce((max, row) => Math.max(max, row[index]?.length ?? 0), 0);
    return Math.max(headerWidth, valueWidth);
  });

  const renderLine = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();

  return [
    renderLine(columns.map((column) => formatCell(column.header))),
    ...renderedRows.map(renderLine)
  ].join("\n");
}
