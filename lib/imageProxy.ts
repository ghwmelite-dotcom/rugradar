// Routes third-party token image URLs through the same-origin proxy
// (app/api/image) so ad-blockers/privacy shields don't blank token icons.
export function proxiedImage(url: string | null): string | null {
  return url ? `/api/image?u=${encodeURIComponent(url)}` : null;
}
