export type AssetType =
  | 'Laptop'
  | 'Desktop'
  | 'Monitor'
  | 'Keyboard'
  | 'Mouse'
  | 'Headphone'
  | 'USB Extender'
  | 'UPS'
  | 'Mobile Phone'
  | 'Scanner'
  | 'Printer'
  | 'Camera'
  | 'DVR'
  | 'Switch'
  | 'Router'
  | 'Firewall'
  | 'Other';

export type AssetStatus = 'Active' | 'In Repair' | 'Retired' | 'Lost' | 'In Store';

export type Location = 'India' | 'US' | 'UK' | 'Sweden';

export interface Asset {
  assetId: string;          // UUID — partition key
  assetType: AssetType;     // GSI partition key
  assetName: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  location: Location;       // GSI partition key
  assignedTo?: string;
  department?: string;
  status: AssetStatus;
  purchaseDate?: string;    // ISO date string YYYY-MM-DD
  warrantyExpiry?: string;  // ISO date string YYYY-MM-DD
  notes?: string;
  createdAt: string;        // ISO timestamp
  updatedAt: string;        // ISO timestamp
  createdBy?: string;
}

export interface CreateAssetInput {
  assetType: AssetType;
  assetName: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  location: Location;
  assignedTo?: string;
  department?: string;
  status?: AssetStatus;
  purchaseDate?: string;
  warrantyExpiry?: string;
  notes?: string;
}

export interface UpdateAssetInput extends Partial<CreateAssetInput> {}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  count?: number;
}

export interface ExportResult {
  url: string;           // pre-signed S3 URL (1-hour expiry)
  fileName: string;
  expiresAt: string;     // ISO timestamp
}
