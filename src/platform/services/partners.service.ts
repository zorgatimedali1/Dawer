import { apiRequest } from '@/platform/lib/http';

/** A partner row as exposed by the operator console API. */
export interface PlatformPartner {
  id: string;
  name: string;
  logoUrl: string;
  createdAt: string;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

/** Operator-side CRUD for the landing-page partner marquee. */
export class PartnersService {
  static async list(): Promise<PlatformPartner[]> {
    const result = await apiRequest<{ success: boolean; partners?: PlatformPartner[] }>(
      'GET',
      '/api/admin/partners',
      undefined,
      'Unable to load partners.',
    );
    return result.partners ?? [];
  }

  static async create(input: { name: string; file: File }): Promise<PlatformPartner> {
    const dataBase64 = await fileToBase64(input.file);
    const result = await apiRequest<{ success: boolean; partner?: PlatformPartner }>(
      'POST',
      '/api/admin/partners',
      { name: input.name, mimeType: input.file.type, dataBase64 },
      'Unable to add the partner.',
    );
    if (!result.partner) throw new Error('The server did not return the new partner.');
    return result.partner;
  }

  static async remove(id: string): Promise<void> {
    await apiRequest<{ success: boolean }>(
      'DELETE',
      `/api/admin/partners/${encodeURIComponent(id)}`,
      undefined,
      'Unable to remove the partner.',
    );
  }
}
