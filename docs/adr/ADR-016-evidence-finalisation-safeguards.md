# ADR-016 — Safeguards in evidence finalisation

Date: 2026-11-11. Status: accepted. Refines ADR-004.

- **Context.** ADR-004 lets `finalize-evidence` remove an object it rejects. The function runs with the secret key, so without further checks anyone who could call it might have it delete or register any object in the bucket, including someone else's upload or a registered original. ADR-004 also suggests streaming the download to hash it.
- **Decision.**
  - The caller must hold tester or above on the protocol of the target test run (`svc_check_protocol_role`), checked before the object is touched.
  - The storage path must be exactly `{run's protocol}/{evidenceId}/{safe file name}`.
  - The object must exist, must not already be referenced by an `evidence_files` row, and must have been uploaded by the caller (`storage.objects.owner_id`), all read through `svc_evidence_object`.
  - Only then may the function remove it, and only if validation or registration fails.
  - Content is validated by the same dependency-free module the browser uses (`supabase/functions/_shared/image-format.ts`, imported in the app as `@shared/image-format.ts`). It checks extension, declared type, magic bytes, completeness (PNG IEND, JPEG EOI, GIF trailer, RIFF/BMP sizes) and dimensions. The stored MIME type comes from the detected content, not the declared type.
  - The file is read into memory and hashed with `crypto.subtle.digest`. Web Crypto has no streaming digest, the bucket caps files at 50 MB (20 MB by default), and the function has 256 MB of memory. Buffering is bounded and simpler than adding a streaming hash dependency.
- **Consequences.** A registered original can never be deleted through the app, which is tested. An upload that is never finalised (for example the tab closes mid-way) stays as an orphan; the README will document the cleanup query. Browser uploads use `XMLHttpRequest` straight to the Storage REST endpoint, because supabase-js has no progress events. They send `x-upsert: false`, and the absence of an UPDATE policy refuses overwrites anyway.
