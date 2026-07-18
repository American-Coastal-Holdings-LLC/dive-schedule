// Shared response/domain types for the frontend. These mirror the API payloads described in
// docs/ARCHITECTURE.md (HTTP API table) and the Prisma schema. Prisma `Decimal` fields
// serialize to JSON as strings, so money/length fields are typed `number | string` and coerced
// with `num()` (see lib/format.ts) before arithmetic. Fields the server strips (price /
// crewShare without dive.jobs.view-pricing) are optional.

export type Rotation = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly';
export type JobStatus = 'open' | 'completed';
export type InventoryType = 'item' | 'part' | 'tool';
export type LedgerKind = 'in' | 'out';

export interface Me {
  user: { id: string; name: string };
  tenantId: string;
  installationId: string;
  permissions: string[];
}

export interface DiverRef {
  id: string;
  name: string;
  active?: boolean;
}

export interface JobVideo {
  title: string;
  url: string;
}

export interface CheckAnswer {
  id?: string;
  q: string;
  a: string;
}

export interface Job {
  id: string;
  site: string;
  boat: string;
  ownerName: string;
  customerEmail: string;
  footage: number | string;
  price?: number | string; // stripped without dive.jobs.view-pricing
  crewShare?: number | string; // stripped without dive.jobs.view-pricing
  rotation: Rotation;
  dueDate: string; // YYYY-MM-DD
  status: JobStatus;
  notes: string;
  videos: JobVideo[];
  assignedUserIds: string[];
  assignedUsers?: DiverRef[]; // resolved by the directory
  completedBy?: string | null;
  completedByName?: string | null;
  completedAt?: string | null; // ISO instant
  completionNote: string;
  completionPhoto: string; // data:image/... or ''
  checkAnswers: CheckAnswer[];
  certified: boolean;
  certifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceRecord {
  id: string;
  jobId: string;
  site: string;
  boat: string;
  ownerName: string;
  customerEmail: string;
  diverNames: string;
  completedBy?: string | null;
  completedByName?: string | null;
  completedAt?: string | null;
  rotation: Rotation;
  price?: number | string; // stripped without dive.jobs.view-pricing
  footage: number | string;
  note: string;
  photo: string;
  certified: boolean;
  certifiedAt?: string | null;
  answers: CheckAnswer[];
  sent: boolean;
  sentAt?: string | null;
  sentTo: string;
  createdAt: string;
}

export interface ChecklistQuestion {
  id: string;
  text: string;
  ord: number;
}

export interface CrewMember {
  id: string; // platform user id
  name: string;
  email?: string;
  active?: boolean;
  certifications: string;
  bio: string;
  photo: string;
  joined: string; // YYYY-MM-DD
}

export interface InventoryItem {
  id: string;
  name: string;
  type: InventoryType;
  quantity: number;
  unitCost: number | string;
  salePrice: number | string;
  sku: string;
  lowStockAt: number;
  notes: string;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amount: number | string;
  description: string;
  category: string;
  date: string; // YYYY-MM-DD
}

export interface Settings {
  payRate: number | string;
  reportCcEmail: string;
  estimateRatePerFoot: number | string;
}

export interface PayJob {
  site: string;
  earning: number | string;
  feet: number | string;
}

export interface PayDay {
  date: string; // YYYY-MM-DD
  jobs: PayJob[];
  total: number | string;
  feet: number | string;
}

export interface PayWeek {
  weekStart: string; // YYYY-MM-DD (Monday)
  days: PayDay[];
  weekTotal: number | string;
  totalFeet: number | string;
}

export interface FinancePeriod {
  in: number | string;
  out: number | string;
  net: number | string;
}

export interface TrendPoint {
  label: string; // e.g. "Feb"
  net: number | string;
}

export interface FinanceSummary {
  week: FinancePeriod;
  month: FinancePeriod;
  year: FinancePeriod;
  trend: TrendPoint[]; // 6 monthly points, oldest -> newest
}

// ----- request bodies -----
export interface JobInput {
  site?: string;
  boat?: string;
  ownerName?: string;
  customerEmail?: string;
  footage?: number;
  price?: number;
  rotation?: Rotation;
  dueDate?: string;
  notes?: string;
  videos?: JobVideo[];
  assignedUserIds?: string[];
}

export interface PosLine {
  itemId?: string;
  name: string;
  amount: number;
  qty: number;
}
