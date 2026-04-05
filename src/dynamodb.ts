import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { Asset, CreateAssetInput, UpdateAssetInput } from './types';

const TABLE_NAME = process.env.DYNAMODB_TABLE!;

const clientConfig: DynamoDBClientConfig = {
  region: process.env.AWS_REGION ?? 'eu-west-2',
};

const ddbClient = new DynamoDBClient(clientConfig);
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createAsset(
  input: CreateAssetInput,
  createdBy = 'api',
): Promise<Asset> {
  const now = new Date().toISOString();
  const item: Asset = {
    assetId: randomUUID(),
    assetType: input.assetType,
    assetName: input.assetName,
    serialNumber: input.serialNumber,
    manufacturer: input.manufacturer,
    model: input.model,
    location: input.location,
    assignedTo: input.assignedTo,
    department: input.department,
    status: input.status ?? 'Active',
    purchaseDate: input.purchaseDate,
    warrantyExpiry: input.warrantyExpiry,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

// ---------------------------------------------------------------------------
// Read one
// ---------------------------------------------------------------------------
export async function getAsset(assetId: string): Promise<Asset | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { assetId } }),
  );
  return (result.Item as Asset) ?? null;
}

// ---------------------------------------------------------------------------
// List all (full table scan — acceptable for internal tool scale)
// ---------------------------------------------------------------------------
export async function listAssets(filters?: {
  assetType?: string;
  location?: string;
  status?: string;
}): Promise<Asset[]> {
  const items: Asset[] = [];

  // Use GSI for selective queries to avoid full scan where possible
  if (filters?.assetType && !filters.location && !filters.status) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'assetType-index',
        KeyConditionExpression: 'assetType = :t',
        ExpressionAttributeValues: { ':t': filters.assetType },
      }),
    );
    return (result.Items as Asset[]) ?? [];
  }

  if (filters?.location && !filters.assetType && !filters.status) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'location-index',
        KeyConditionExpression: '#loc = :l',
        ExpressionAttributeNames: { '#loc': 'location' },
        ExpressionAttributeValues: { ':l': filters.location },
      }),
    );
    return (result.Items as Asset[]) ?? [];
  }

  // Full scan with optional client-side filters
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items as Asset[]) ?? []));
    lastKey = result.LastEvaluatedKey as typeof lastKey;
  } while (lastKey);

  if (!filters) return items;

  return items.filter((a) => {
    if (filters.assetType && a.assetType !== filters.assetType) return false;
    if (filters.location && a.location !== filters.location) return false;
    if (filters.status && a.status !== filters.status) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
export async function updateAsset(
  assetId: string,
  updates: UpdateAssetInput,
  updatedBy = 'api',
): Promise<Asset | null> {
  const existing = await getAsset(assetId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updateFields: Record<string, unknown> = { ...updates, updatedAt: now };

  const setExpressions: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(updateFields)) {
    const nameKey = `#${key}`;
    const valKey = `:${key}`;
    names[nameKey] = key;
    values[valKey] = val;
    setExpressions.push(`${nameKey} = ${valKey}`);
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { assetId },
      UpdateExpression: `SET ${setExpressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return (result.Attributes as Asset) ?? null;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
export async function deleteAsset(assetId: string): Promise<boolean> {
  const existing = await getAsset(assetId);
  if (!existing) return false;

  await ddb.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { assetId } }),
  );
  return true;
}
