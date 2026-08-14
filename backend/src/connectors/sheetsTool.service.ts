import {
  sheetsAppendValues,
  sheetsCreateSpreadsheet,
  sheetsGetSpreadsheet,
  sheetsGetValues,
  sheetsUpdateValues,
} from './sheetsApi.service.js';
import {
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
  runGoogleWorkspaceRead,
  runGoogleWorkspaceWrite,
} from './googleWorkspaceToolRunner.js';

export {
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
};

export type SheetsReadAction = 'get' | 'get_values';
export type SheetsWriteAction = 'create' | 'update_values' | 'append_values';

function normalizeValues(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) =>
    Array.isArray(row) ? row.map((c) => String(c ?? '')) : [String(row ?? '')],
  );
}

export async function executeSheetsRead(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: SheetsReadAction;
    spreadsheetId?: string;
    range?: string;
  };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceRead({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'sheets',
    readScope: 'sheets.read',
    writeScope: 'sheets.write',
    action: params.input.action,
    dispatch: async (accessToken) => {
      if (!params.input.spreadsheetId?.trim()) {
        throw new GoogleToolError('spreadsheetId is required');
      }
      if (params.input.action === 'get') {
        return {
          ...(await sheetsGetSpreadsheet({
            accessToken,
            spreadsheetId: params.input.spreadsheetId.trim(),
          })),
        };
      }
      if (!params.input.range?.trim()) {
        throw new GoogleToolError('range is required for action=get_values (e.g. Sheet1!A1:C10)');
      }
      return {
        ...(await sheetsGetValues({
          accessToken,
          spreadsheetId: params.input.spreadsheetId.trim(),
          range: params.input.range.trim(),
        })),
      };
    },
  });
}

export async function executeSheetsWrite(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: SheetsWriteAction;
    spreadsheetId?: string;
    title?: string;
    sheetTitle?: string;
    range?: string;
    values?: unknown;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceWrite({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'sheets',
    writeScope: 'sheets.write',
    action: params.input.action,
    jitToken: params.input.jitToken,
    dispatch: async (accessToken) => {
      if (params.input.action === 'create') {
        if (!params.input.title?.trim()) {
          throw new GoogleToolError('title is required for action=create');
        }
        return {
          ...(await sheetsCreateSpreadsheet({
            accessToken,
            title: params.input.title.trim(),
            sheetTitle: params.input.sheetTitle,
          })),
        };
      }
      if (!params.input.spreadsheetId?.trim()) {
        throw new GoogleToolError('spreadsheetId is required');
      }
      if (!params.input.range?.trim()) {
        throw new GoogleToolError('range is required (e.g. Sheet1!A1)');
      }
      const values = normalizeValues(params.input.values);
      if (!values.length) throw new GoogleToolError('values is required (2D array of cells)');
      if (params.input.action === 'update_values') {
        return {
          ...(await sheetsUpdateValues({
            accessToken,
            spreadsheetId: params.input.spreadsheetId.trim(),
            range: params.input.range.trim(),
            values,
          })),
        };
      }
      return {
        ...(await sheetsAppendValues({
          accessToken,
          spreadsheetId: params.input.spreadsheetId.trim(),
          range: params.input.range.trim(),
          values,
        })),
      };
    },
  });
}
