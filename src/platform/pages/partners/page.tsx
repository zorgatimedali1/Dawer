import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { PartnersService, type PlatformPartner } from '@/platform/services/partners.service';

/** Kept in sync with LOGO_MIME_TYPES / MAX_LOGO_BYTES on the server. */
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const MAX_LOGO_BYTES = 512 * 1024;

/**
 * The operator only picks a logo file, so the partner's display name is
 * derived from the filename (extension dropped, separators spaced). The
 * backend still requires a name on the create payload.
 */
function deriveName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (!base) return 'Partner';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Operator controls for the landing-page partner marquee: add a logo
 * (image upload only — the name comes from the filename) and remove one.
 * Every mutation updates the grid from the response immediately, so the
 * panel never needs a manual refresh.
 */
export default function AdminPartnersManager() {
  const [partners, setPartners] = useState<PlatformPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformPartner | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void PartnersService.list()
      .then((rows) => {
        if (!cancelled) setPartners(rows);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load partners.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The file preview is a transient object URL: revoke it whenever the
  // selection changes and on unmount so nothing leaks.
  useEffect(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = file ? URL.createObjectURL(file) : null;
    setPreviewUrl(previewRef.current);
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [file]);

  const resetForm = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pickFile = (picked: File | null | undefined) => {
    setError(null);
    if (!picked) return;
    if (!ACCEPTED_TYPES.split(',').includes(picked.type)) {
      setError('Use a PNG, JPEG, WebP, GIF or SVG image.');
      return;
    }
    if (picked.size > MAX_LOGO_BYTES) {
      setError('The logo must be 512 KB or smaller.');
      return;
    }
    setFile(picked);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const partner = await PartnersService.create({ name: deriveName(file.name), file });
      setPartners((current) => [...current, partner]);
      setNotice(`"${partner.name}" added to the landing page marquee.`);
      resetForm();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to add the partner.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || busy) return;
    const target = deleteTarget;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await PartnersService.remove(target.id);
      setPartners((current) => current.filter((partner) => partner.id !== target.id));
      setNotice(`"${target.name}" removed from the landing page marquee.`);
      setDeleteTarget(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove the partner.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Partner logos"
        description="Companies shown in the “ILS NOUS FONT CONFIANCE” marquee on the landing page. Changes appear publicly within 30 seconds."
      />

      {notice && (
        <div
          role="status"
          className="rounded-lg border-l-4 border-success-400 bg-success-50 px-4 py-3 text-sm text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border-l-4 border-danger-400 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {error}
        </div>
      )}

      <Card className="p-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Add a partner</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Upload a logo (PNG, JPEG, WebP, GIF or SVG, up to 512 KB). Transparent backgrounds look best
          on the dark landing page.
        </p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="sm:max-w-sm sm:flex-1">
            <Field label="Logo file" htmlFor="partner-logo">
              <Input
                id="partner-logo"
                ref={fileInputRef}
                type="file"
                inputSize="sm"
                accept={ACCEPTED_TYPES}
                className="file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-800 dark:file:bg-brand-900/50 dark:file:text-accent-bright"
                onChange={(event) => {
                  pickFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </Field>
          </div>

          <Button type="submit" size="sm" disabled={busy || !file}>
            {busy ? 'Adding...' : 'Add partner'}
          </Button>
        </form>

        {file && previewUrl && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
            <span className="flex h-10 items-center rounded-md border border-line bg-surface px-3">
              <img src={previewUrl} alt="" className="max-h-8 max-w-[140px] object-contain" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{deriveName(file.name)}</p>
              <p className="truncate text-xs text-ink-muted">
                {file.name} · {Math.ceil(file.size / 1024)} KB
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Current partners</h2>
          <span className="text-xs text-ink-muted">
            {partners.length} logo{partners.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-brand-600" />
            <p className="text-ink-muted">Loading partners...</p>
          </div>
        ) : partners.length === 0 ? (
          <EmptyState
            icon={ImagePlus}
            title="No partners yet"
            description="Add the first logo above — it will appear in the landing-page marquee within 30 seconds."
          />
        ) : (
          <ul className="grid list-none gap-4 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
            {partners.map((partner) => (
              <li
                key={partner.id}
                className="flex items-center gap-4 rounded-xl border border-line bg-elevated p-4"
              >
                <span className="flex h-12 w-24 shrink-0 items-center justify-center rounded-lg border border-line bg-surface px-3">
                  <img
                    src={partner.logoUrl}
                    alt={partner.name}
                    className="max-h-9 max-w-full object-contain"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink">{partner.name}</p>
                  <p className="truncate text-xs text-ink-muted">
                    Added {new Date(partner.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Remove ${partner.name}`}
                  title={`Remove ${partner.name}`}
                  onClick={() => setDeleteTarget(partner)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove this partner"
        description={deleteTarget ? `${deleteTarget.name} will disappear from the landing page marquee.` : undefined}
        size="md"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? 'Removing...' : 'Remove partner'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          The stored logo is deleted as well. This cannot be undone — you can upload the file again
          later if needed.
        </p>
      </Modal>
    </div>
  );
}
