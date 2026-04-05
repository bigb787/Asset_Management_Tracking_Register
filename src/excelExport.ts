import ExcelJS from 'exceljs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Asset, ExportResult } from './types';

const BUCKET = process.env.S3_EXPORTS_BUCKET!;
const REGION = process.env.AWS_REGION ?? 'ap-south-1';

const s3 = new S3Client({ region: REGION });

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF185FA5' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};
const ALT_ROW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF0F7FF' },
};
const BORDER_STYLE: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFDDDDDD' } };
const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: BORDER_STYLE, left: BORDER_STYLE,
  bottom: BORDER_STYLE, right: BORDER_STYLE,
};

function applyHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = CELL_BORDER;
  });
  row.height = 22;
}

function applyDataRow(row: ExcelJS.Row, isAlt: boolean) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (isAlt) cell.fill = ALT_ROW_FILL;
    cell.border = CELL_BORDER;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 18;
}

// ---------------------------------------------------------------------------
// Tab 1 — All Assets
// ---------------------------------------------------------------------------
function buildAllAssetsSheet(wb: ExcelJS.Workbook, assets: Asset[]) {
  const ws = wb.addWorksheet('All Assets');

  ws.columns = [
    { header: '#',             key: 'idx',          width: 5  },
    { header: 'Asset ID',      key: 'assetId',      width: 38 },
    { header: 'Asset Name',    key: 'assetName',    width: 28 },
    { header: 'Type',          key: 'assetType',    width: 18 },
    { header: 'Manufacturer',  key: 'manufacturer', width: 18 },
    { header: 'Model',         key: 'model',        width: 18 },
    { header: 'Serial No',     key: 'serialNumber', width: 20 },
    { header: 'Location',      key: 'location',     width: 12 },
    { header: 'Assigned To',   key: 'assignedTo',   width: 22 },
    { header: 'Department',    key: 'department',   width: 18 },
    { header: 'Status',        key: 'status',       width: 14 },
    { header: 'Purchase Date', key: 'purchaseDate', width: 14 },
    { header: 'Warranty Exp',  key: 'warrantyExpiry', width: 14 },
    { header: 'Notes',         key: 'notes',        width: 35 },
    { header: 'Created At',    key: 'createdAt',    width: 22 },
  ];

  applyHeaderRow(ws.getRow(1));

  assets.forEach((a, i) => {
    const row = ws.addRow({
      idx: i + 1,
      assetId: a.assetId,
      assetName: a.assetName,
      assetType: a.assetType,
      manufacturer: a.manufacturer ?? '',
      model: a.model ?? '',
      serialNumber: a.serialNumber ?? '',
      location: a.location,
      assignedTo: a.assignedTo ?? '',
      department: a.department ?? '',
      status: a.status,
      purchaseDate: a.purchaseDate ?? '',
      warrantyExpiry: a.warrantyExpiry ?? '',
      notes: a.notes ?? '',
      createdAt: a.createdAt,
    });
    applyDataRow(row, i % 2 === 1);
  });

  ws.autoFilter = { from: 'A1', to: 'O1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ---------------------------------------------------------------------------
// Tab 2 — By Asset Type
// ---------------------------------------------------------------------------
function buildByTypeSheet(wb: ExcelJS.Workbook, assets: Asset[]) {
  const ws = wb.addWorksheet('By Type');
  const grouped = assets.reduce<Record<string, Asset[]>>((acc, a) => {
    (acc[a.assetType] ??= []).push(a);
    return acc;
  }, {});

  let rowIndex = 1;
  for (const [type, items] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
    // Group header
    const groupRow = ws.getRow(rowIndex++);
    groupRow.getCell(1).value = `${type}  (${items.length} item${items.length !== 1 ? 's' : ''})`;
    groupRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D9E75' } };
    groupRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    groupRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    ws.mergeCells(rowIndex - 1, 1, rowIndex - 1, 7);
    groupRow.height = 20;

    // Column headers
    const headerRow = ws.getRow(rowIndex++);
    ['Asset Name', 'Serial No', 'Location', 'Assigned To', 'Status', 'Purchase Date', 'Warranty Exp'].forEach(
      (h, ci) => {
        const cell = headerRow.getCell(ci + 1);
        cell.value = h;
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.border = CELL_BORDER;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      },
    );
    headerRow.height = 20;

    items.forEach((a, i) => {
      const row = ws.getRow(rowIndex++);
      [a.assetName, a.serialNumber ?? '', a.location, a.assignedTo ?? '', a.status, a.purchaseDate ?? '', a.warrantyExpiry ?? ''].forEach(
        (v, ci) => {
          row.getCell(ci + 1).value = v;
          row.getCell(ci + 1).border = CELL_BORDER;
          if (i % 2 === 1) row.getCell(ci + 1).fill = ALT_ROW_FILL;
        },
      );
      row.height = 18;
    });

    rowIndex++; // blank separator row
  }

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 14;
  ws.getColumn(7).width = 14;
}

// ---------------------------------------------------------------------------
// Tab 3 — By Location
// ---------------------------------------------------------------------------
function buildByLocationSheet(wb: ExcelJS.Workbook, assets: Asset[]) {
  const ws = wb.addWorksheet('By Location');
  const grouped = assets.reduce<Record<string, Asset[]>>((acc, a) => {
    (acc[a.location] ??= []).push(a);
    return acc;
  }, {});

  const locOrder = ['India', 'US', 'UK', 'Sweden'];
  const sortedEntries = Object.entries(grouped).sort(
    ([a], [b]) => locOrder.indexOf(a) - locOrder.indexOf(b),
  );

  ws.columns = [
    { header: 'Location', key: 'location', width: 12 },
    { header: 'Asset Name', key: 'assetName', width: 28 },
    { header: 'Type', key: 'assetType', width: 18 },
    { header: 'Assigned To', key: 'assignedTo', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Department', key: 'department', width: 18 },
  ];
  applyHeaderRow(ws.getRow(1));
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  let rowIdx = 2;
  for (const [loc, items] of sortedEntries) {
    items.forEach((a, i) => {
      const row = ws.addRow({
        location: i === 0 ? loc : '',
        assetName: a.assetName,
        assetType: a.assetType,
        assignedTo: a.assignedTo ?? '',
        status: a.status,
        department: a.department ?? '',
      });
      applyDataRow(row, i % 2 === 1);
      rowIdx++;
    });
  }

  ws.autoFilter = { from: 'A1', to: 'F1' };
}

// ---------------------------------------------------------------------------
// Tab 4 — Summary
// ---------------------------------------------------------------------------
function buildSummarySheet(wb: ExcelJS.Workbook, assets: Asset[]) {
  const ws = wb.addWorksheet('Summary');

  const byType = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.assetType] = (acc[a.assetType] ?? 0) + 1;
    return acc;
  }, {});
  const byStatus = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const byLocation = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.location] = (acc[a.location] ?? 0) + 1;
    return acc;
  }, {});

  let r = 1;

  // Title
  ws.mergeCells(r, 1, r, 4);
  const titleCell = ws.getCell(r, 1);
  titleCell.value = 'Asset Register — Summary Report';
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF185FA5' } };
  titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 28;
  r += 2;

  // Total
  ws.getCell(r, 1).value = 'Total Assets';
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = assets.length;
  ws.getCell(r, 2).font = { bold: true, color: { argb: 'FF185FA5' } };
  r += 2;

  const writeSection = (title: string, data: Record<string, number>) => {
    ws.mergeCells(r, 1, r, 2);
    const hCell = ws.getCell(r, 1);
    hCell.value = title;
    hCell.fill = HEADER_FILL;
    hCell.font = HEADER_FONT;
    hCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(r).height = 20;
    const rStart = r;
    r++;
    let alt = false;
    for (const [k, v] of Object.entries(data).sort(([, a], [, b]) => b - a)) {
      ws.getCell(r, 1).value = k;
      ws.getCell(r, 2).value = v;
      if (alt) {
        ws.getCell(r, 1).fill = ALT_ROW_FILL;
        ws.getCell(r, 2).fill = ALT_ROW_FILL;
      }
      [1, 2].forEach((c) => (ws.getCell(r, c).border = CELL_BORDER));
      r++;
      alt = !alt;
    }
    r++;
  };

  writeSection('By Asset Type', byType);
  writeSection('By Status', byStatus);
  writeSection('By Location', byLocation);

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 14;

  // Footer
  r += 1;
  ws.getCell(r, 1).value = `Generated: ${new Date().toISOString()}`;
  ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF888888' }, size: 9 };
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------
export async function generateAndUploadExcel(assets: Asset[]): Promise<ExportResult> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Asset Manager';
  wb.created = new Date();

  buildAllAssetsSheet(wb, assets);
  buildByTypeSheet(wb, assets);
  buildByLocationSheet(wb, assets);
  buildSummarySheet(wb, assets);

  const buffer = await wb.xlsx.writeBuffer() as Buffer;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `asset-export-${timestamp}.xlsx`;
  const s3Key = `exports/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ServerSideEncryption: 'AES256',
      ContentDisposition: `attachment; filename="${fileName}"`,
    }),
  );

  const expiresIn = 3600; // 1 hour
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }),
    { expiresIn },
  );

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return { url, fileName, expiresAt };
}
