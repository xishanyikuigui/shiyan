import type {SQPRow} from './types';

const baseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export type SqpMarketplace = 'US' | 'CA' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES' | 'JP' | 'MX' | 'AU';

export type SqpReport = {
  id: string;
  asin: string;
  marketplace: string;
  period: string;
  file_name: string;
  row_count: number;
  rows: SQPRow[];
  storage_path: string;
  created_at: string;
};

function headers(token: string, json = false): HeadersInit {
  return {apikey: anonKey, Authorization: `Bearer ${token}`, ...(json ? {'Content-Type': 'application/json'} : {})};
}

async function check(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error_description || body.error || `Supabase 请求失败 (${response.status})`);
  }
}

export async function saveSqpReport(token: string, userId: string, file: File, asin: string, marketplace: string, period: string, rows: SQPRow[]) {
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-\u4e00-\u9fff]/g, '_');
  const storagePath = `${userId}/${marketplace}/${asin}/${id}/${safeName}`;
  const upload = await fetch(`${baseUrl}/storage/v1/object/sqp-reports/${storagePath}`, {
    method: 'POST', headers: {...headers(token), 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false'}, body: file,
  });
  await check(upload);
  const insert = await fetch(`${baseUrl}/rest/v1/sqp_reports`, {
    method: 'POST', headers: {...headers(token, true), Prefer: 'return=minimal'},
    body: JSON.stringify({id, asin, marketplace, period: period.trim(), file_name: file.name, row_count: rows.length, rows, storage_path: storagePath}),
  });
  try { await check(insert); } catch (error) {
    await fetch(`${baseUrl}/storage/v1/object/sqp-reports/${storagePath}`, {method: 'DELETE', headers: headers(token)});
    throw error;
  }
}

export async function listSqpReports(token: string): Promise<SqpReport[]> {
  const response = await fetch(`${baseUrl}/rest/v1/sqp_reports?select=id,asin,marketplace,period,file_name,row_count,rows,storage_path,created_at&order=created_at.desc`, {headers: headers(token)});
  await check(response);
  return response.json();
}

export async function downloadSqpFile(token: string, storagePath: string, fileName: string) {
  const response = await fetch(`${baseUrl}/storage/v1/object/sqp-reports/${storagePath}`, {headers: headers(token)});
  await check(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
}
