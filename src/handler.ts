import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import {
  createAsset,
  getAsset,
  listAssets,
  updateAsset,
  deleteAsset,
} from './dynamodb';
import { generateMultiTabAssetRegister, generateSectionExcel } from './excelExport';
import { CreateAssetInput, UpdateAssetInput, ApiResponse } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
} as const;

function json<T>(status: number, body: ApiResponse<T>): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { ...JSON_HEADERS },
    body: JSON.stringify(body),
  };
}

function ok<T>(data: T, count?: number): APIGatewayProxyResultV2 {
  return json(200, { success: true, data, ...(count !== undefined ? { count } : {}) });
}

function created<T>(data: T): APIGatewayProxyResultV2 {
  return json(201, { success: true, data });
}

function notFound(msg = 'Asset not found'): APIGatewayProxyResultV2 {
  return json(404, { success: false, message: msg });
}

function badRequest(msg: string): APIGatewayProxyResultV2 {
  return json(400, { success: false, message: msg });
}

function serverError(err: unknown): APIGatewayProxyResultV2 {
  const msg = err instanceof Error ? err.message : 'Internal server error';
  console.error('[handler error]', err);
  return json(500, { success: false, message: msg });
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route table
// Route key format: "<METHOD> <path>"
// API Gateway v2 $default route passes the full path
// ---------------------------------------------------------------------------
export async function handler(
  event: APIGatewayProxyEventV2,
  _ctx: Context,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method.toUpperCase();
  const rawPath = event.rawPath ?? '/';

  // strip stage prefix if any
  const path = rawPath.replace(/^\/(prod|dev|staging)/, '') || '/';

  // ---- OPTIONS (CORS pre-flight) ------------------------------------------
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Max-Age': '86400',
      },
      body: '',
    };
  }

  try {
    // ---- GET /assets/export -----------------------------------------------
    // Optional: ?assetType=GatePass or ?assetTypes=Laptop,Desktop
    if (method === 'GET' && path === '/assets/export') {
      const assets = await listAssets();
      const q = event.queryStringParameters ?? {};
      const single = q['assetType']?.trim();
      const multi = q['assetTypes']?.trim();
      let subset = assets;
      let label = 'all';
      if (multi) {
        const types = multi
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        subset = assets.filter((a) => types.includes(a.assetType));
        label = types.join('-') || 'section';
      } else if (single) {
        subset = assets.filter((a) => a.assetType === single);
        label = single;
      } else {
        // Main asset register export — Gate Pass & Leavers use their own section exports
        subset = assets.filter((a) => {
          const t = String(a.assetType);
          return t !== 'GatePass' && t !== 'Leaver';
        });
      }
      const result =
        single || multi
          ? await generateSectionExcel(
              subset as unknown as Record<string, unknown>[],
              label,
            )
          : await generateMultiTabAssetRegister(subset);
      return ok(result);
    }

    // ---- POST /assets/bulk (import — create and/or update by assetId) -----
    if (method === 'POST' && path === '/assets/bulk') {
      const body = parseBody(event);
      if (!body || !Array.isArray((body as { items?: unknown }).items)) {
        return badRequest('Body must be JSON with an "items" array');
      }
      const items = (body as { items: Record<string, unknown>[] }).items;
      if (items.length === 0) return badRequest('items must not be empty');
      if (items.length > 500) return badRequest('Maximum 500 items per request');

      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== 'object' || !item.assetType) {
          errors.push(`Row ${i + 1}: assetType is required`);
          continue;
        }
        const id =
          typeof item.assetId === 'string' && item.assetId.trim()
            ? item.assetId.trim()
            : '';
        try {
          const validLocations = ['India', 'US', 'UK', 'Sweden'];
          if (item.location && !validLocations.includes(String(item.location))) {
            errors.push(`Row ${i + 1}: invalid location`);
            continue;
          }
          if (id) {
            const { assetId: _omit, ...upd } = item;
            const out = await updateAsset(id, upd as UpdateAssetInput);
            if (out) updated++;
            else errors.push(`Row ${i + 1}: assetId not found`);
          } else {
            await createAsset(
              item as Record<string, unknown> & { assetType: string },
            );
            created++;
          }
        } catch (e) {
          errors.push(
            `Row ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`,
          );
        }
      }

      return ok({ created, updated, errors });
    }

    // ---- GET /assets -------------------------------------------------------
    if (method === 'GET' && path === '/assets') {
      const q = event.queryStringParameters ?? {};
      const assets = await listAssets({
        assetType: q['assetType'],
        location: q['location'],
        status: q['status'],
      });
      return ok(assets, assets.length);
    }

    // ---- POST /assets -------------------------------------------------------
    if (method === 'POST' && path === '/assets') {
      const body = parseBody(event);
      if (!body) return badRequest('Invalid JSON body');

      const input = body as CreateAssetInput & Record<string, unknown>;
      if (!input.assetType) return badRequest('assetType is required');

      // location validation — only if a location value is provided
      const validLocations = ['India', 'US', 'UK', 'Sweden'];
      if (input.location && !validLocations.includes(String(input.location))) {
        return badRequest(`location must be one of: ${validLocations.join(', ')}`);
      }

      const asset = await createAsset(
        input as Record<string, unknown> & { assetType: string },
      );
      return created(asset);
    }

    // ---- Routes with :assetId ----------------------------------------------
    const assetMatch = path.match(/^\/assets\/([^/]+)$/);
    if (assetMatch) {
      const assetId = assetMatch[1];

      // GET /assets/:id
      if (method === 'GET') {
        const asset = await getAsset(assetId);
        return asset ? ok(asset) : notFound();
      }

      // PUT /assets/:id
      if (method === 'PUT') {
        const body = parseBody(event);
        if (!body) return badRequest('Invalid JSON body');

        const updates = body as UpdateAssetInput;
        const validLocations = ['India', 'US', 'UK', 'Sweden'];
        if (updates.location && !validLocations.includes(updates.location)) {
          return badRequest(`location must be one of: ${validLocations.join(', ')}`);
        }

        const asset = await updateAsset(assetId, updates);
        return asset ? ok(asset) : notFound();
      }

      // DELETE /assets/:id
      if (method === 'DELETE') {
        const deleted = await deleteAsset(assetId);
        return deleted
          ? ok({ assetId }, undefined)
          : notFound();
      }
    }

    // ---- Health check -------------------------------------------------------
    if (method === 'GET' && path === '/health') {
      return ok({ status: 'ok', ts: new Date().toISOString() });
    }

    // ---- 404 ----------------------------------------------------------------
    return json(404, { success: false, message: `Route not found: ${method} ${path}` });
  } catch (err) {
    return serverError(err);
  }
}
