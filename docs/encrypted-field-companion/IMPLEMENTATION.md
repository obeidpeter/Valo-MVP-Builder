# Encrypted Field Companion

The field companion is a small browser-local draft workspace for a signed-in operator whose connection drops while Valo is already open. It is not an offline copy of Valo and it does not create authoritative evidence.

## Delivered boundary

- Up to 25 drafts per direct tenant membership and signed-in user.
- Three draft classes: site-visit note, delivery-receipt note, and checklist progress.
- AES-256-GCM encryption with a separate non-extractable browser key for each signed-in user, stored through structured clone in IndexedDB.
- Authenticated additional data binds each ciphertext to its record identity, schema, organisation-and-user partition digest, and actor-bound key.
- A cross-tab Web Lock serialises reads, revisions, deletions, and device wipe; revisions use an optimistic version.
- Plaintext, checklist, event, and per-tenant counts are bounded before storage.
- Every draft has a non-extendable seven-day expiry. Expired ciphertext is deleted before a partition is listed or a draft is saved.
- An explicit wipe deletes only the current signed-in user’s local encryption key and actor-bound Valo field drafts across organisations. The application route does not enumerate, open, or remove another recorded actor partition.
- The page clears rendered state on actor or organisation change and decrypts only against the exact active user-and-organisation pair; either mismatch fails closed.
- The version-2 storage upgrade discards legacy organisation-only drafts because they cannot be assigned safely to a historical actor.

## Deliberately unavailable

- service-worker caching of authenticated pages or API responses;
- tender corpus, files, photos, credentials, approvals, final receipts, or Restricted Mode content;
- background or automatic synchronization;
- upload, evidence promotion, or server-side authority;
- offline authentication after the currently loaded application session ends.

Operators must reconnect, review the draft, and deliberately record any relevant fact through the existing governed server workflow. Deleting the browser profile, losing the non-extractable key, or using the device-wipe control makes the local drafts unrecoverable by design.

This actor partition is application/session isolation, not a cryptographic browser-user boundary. Use a dedicated operating-system account and browser profile on shared devices, and treat same-origin script compromise as capable of reaching IndexedDB. Stronger cross-user isolation would require separately approved user-held key wrapping, such as WebAuthn or a passphrase-derived wrapping key.
