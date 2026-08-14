/**
 * Google Sheets API v4 client. Pure functions — scope/JIT/audit live in sheetsTool.service.
 */
import { googleApiFetch, GoogleApiError } from './googleApiFetch.js';

export { GoogleApiError as SheetsApiError };

const SHEETS_API = 'https://sheets.googleapis.com/v4';

export async function sheetsGetSpreadsheet(params: {
  accessToken: string;
  spreadsheetId: string;
}): Promise<{
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: Array<{ sheetId: number; title: string; rowCount: number; columnCount: number }>;
}> {
  const body = await googleApiFetch(
    params.accessToken,
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(params.spreadsheetId)}?fields=spreadsheetId,properties,spreadsheetUrl,sheets(properties)`,
  );
  const props = (body.properties as { title?: string } | undefined) ?? {};
  const sheetsRaw = Array.isArray(body.sheets) ? body.sheets : [];
  return {
    spreadsheetId: String(body.spreadsheetId ?? params.spreadsheetId),
    title: String(props.title ?? ''),
    spreadsheetUrl: String(body.spreadsheetUrl ?? ''),
    sheets: sheetsRaw.map((s) => {
      const p = (s as { properties?: Record<string, unknown> }).properties ?? {};
      const grid = (p.gridProperties as { rowCount?: number; columnCount?: number } | undefined) ?? {};
      return {
        sheetId: Number(p.sheetId ?? 0),
        title: String(p.title ?? ''),
        rowCount: Number(grid.rowCount ?? 0),
        columnCount: Number(grid.columnCount ?? 0),
      };
    }),
  };
}

export async function sheetsGetValues(params: {
  accessToken: string;
  spreadsheetId: string;
  range: string;
}): Promise<{ spreadsheetId: string; range: string; values: string[][] }> {
  const body = await googleApiFetch(
    params.accessToken,
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(params.range)}`,
  );
  const values = Array.isArray(body.values)
    ? (body.values as unknown[][]).map((row) => row.map((c) => String(c ?? '')))
    : [];
  return {
    spreadsheetId: params.spreadsheetId,
    range: String(body.range ?? params.range),
    values,
  };
}

export async function sheetsCreateSpreadsheet(params: {
  accessToken: string;
  title: string;
  sheetTitle?: string;
}): Promise<{ spreadsheetId: string; title: string; spreadsheetUrl: string }> {
  const body = await googleApiFetch(params.accessToken, `${SHEETS_API}/spreadsheets`, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: params.title },
      sheets: params.sheetTitle
        ? [{ properties: { title: params.sheetTitle } }]
        : undefined,
    }),
  });
  const spreadsheetId = String(body.spreadsheetId ?? '');
  if (!spreadsheetId) throw new GoogleApiError('Sheets create returned no spreadsheetId');
  const props = (body.properties as { title?: string } | undefined) ?? {};
  return {
    spreadsheetId,
    title: String(props.title ?? params.title),
    spreadsheetUrl: String(body.spreadsheetUrl ?? ''),
  };
}

export async function sheetsUpdateValues(params: {
  accessToken: string;
  spreadsheetId: string;
  range: string;
  values: string[][];
}): Promise<{ spreadsheetId: string; updatedRange: string; updatedCells: number }> {
  const body = await googleApiFetch(
    params.accessToken,
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(params.range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      body: JSON.stringify({ range: params.range, values: params.values }),
    },
  );
  return {
    spreadsheetId: params.spreadsheetId,
    updatedRange: String(body.updatedRange ?? params.range),
    updatedCells: Number(body.updatedCells ?? 0),
  };
}

export async function sheetsAppendValues(params: {
  accessToken: string;
  spreadsheetId: string;
  range: string;
  values: string[][];
}): Promise<{ spreadsheetId: string; updatedRange: string; updatedCells: number }> {
  const body = await googleApiFetch(
    params.accessToken,
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(params.range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: params.values }),
    },
  );
  const updates = (body.updates as Record<string, unknown> | undefined) ?? {};
  return {
    spreadsheetId: params.spreadsheetId,
    updatedRange: String(updates.updatedRange ?? params.range),
    updatedCells: Number(updates.updatedCells ?? 0),
  };
}
