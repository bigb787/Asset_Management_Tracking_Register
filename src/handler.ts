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
import { generateAndUploadExcel } from './excelExport';
import { CreateAssetInput, UpdateAssetInput, ApiResponse } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json<T>(status: number, body: ApiResponse<T>): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
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
      },
      body: '',
    };
  }

  try {
    // ---- GET /assets/export -----------------------------------------------
    if (method === 'GET' && path === '/assets/export') {
      const assets = await listAssets();
      const result = await generateAndUploadExcel(assets);
      return ok(result);
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

      const input = body as CreateAssetInput;
      if (!input.assetType) return badRequest('assetType is required');

      // location validation — only if a location value is provided
      const validLocations = ['India', 'US', 'UK', 'Sweden'];
      if (input.location && !validLocations.includes(input.location)) {
        return badRequest(`location must be one of: ${validLocations.join(', ')}`);
      }

      const asset = await createAsset(input);
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
