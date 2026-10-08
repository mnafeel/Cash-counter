# Safe application updates and recovery

Application code is deployed through GitHub Pages; the workflow does not deploy,
reset, seed, import into, or delete Firestore. Keep the Firebase project ID
`cash-counter-84178`, database `(default)`, login identity, and website origin
`https://dashboard.shalimarfashions.com` unchanged during an application update.
Browser data belongs to its origin and browser profile; moving domains does not
move that data. Git is not a backup of customer transactions.

## Before publishing this storage-format update

1. On the main billing device, download a full JSON backup in Settings and copy
   it outside the browser/device. Check the bill and expense counts.
2. Keep a copy of the previous deployed build. Preserve the existing Firestore
   project, database, user UIDs, and owner-only access rules.
3. Run the data-safety tests, TypeScript check, and production build. Test a
   representative backup restore in an isolated test account before production.
4. Reload every device to the new build before uploading the new chunk format.
   Older builds cannot read chunk manifests. Do not roll back to a reader that
   only understands single-document backups.
5. Save to cloud from the main device; confirm backup success and restore into
   an isolated test device/account, comparing records and balances.

The Git workflow runs safety regression tests before building and publishing.
No live deployment or database migration was performed while adding these guards.

## Safeguards in this change

- Backups use immutable chunks with byte-length and SHA-256 verification. Old
  backups without a checksum remain readable; only newer backups have checksum
  protection. A first migration also archives the previous legacy document.
- Publication checks that the cloud version has not changed during upload.
  Automatic uploads stop when the device has not loaded the current cloud
  version. Explicit manual overwrite still exists and should be used only after
  reviewing the cloud/local difference and exporting a recovery copy.
- Backup completion does not mark edits made during that upload as synchronized.
  A persistent dirty marker survives page reloads. Manual and automatic uploads
  cannot overlap within one running app instance.
- Corrupt/unreadable local data is not replaced with defaults. Failed local
  writes retain their pending in-memory data for retry. Do not close the app
  after a storage failure until data has been exported or successfully saved.
- Cloud replacement waits for a local recovery snapshot to commit. A failed
  recovery write or an intervening local edit cancels replacement. Recovery
  snapshots for manual restores, account switches, or unsynced data are excluded
  from automatic pruning. Routine synchronized mirrors retain 20 recent ordinary
  snapshots to bound storage growth. These copies appear in Settings's local
  snapshot list for the original data owner; sign into that account to access
  them. Browser storage can still be cleared by the user or operating system.
- Failed sign-in checks stop automatic uploads instead of clearing local data.
- Backup retries use 5-second to 2-minute backoff; normal changes are debounced
  for 1.5 seconds. Secondary sign-in no longer downloads the same backup twice.

## Independent disaster recovery (configure in the cloud console)

After billing is active, enable Firestore point-in-time recovery and scheduled
backups. These are separate from this application's snapshots and are NOT
activated by a Git deployment. PITR can recover up to seven days of retained
history after enablement; it does not protect changes from before it was enabled.
Use daily scheduled backups, a retention period appropriate for the business,
and an independent exported copy. Practice restoration to a separate database.
Restrict administrative permissions and review alerts for backup failures.

App-managed cloud versions and protected local recovery copies consume storage;
monitor that growth. Do not delete their chunks independently of their manifests.
Local snapshots are a convenience, not an independent disaster-recovery system.
No system can promise zero loss after every hardware failure, browser-data wipe,
compromised administrator, or unbacked-up offline transaction.

## Firebase Blaze / Google Pay troubleshooting

A Google Pay payment receipt does not itself confirm that the Firebase project
has been linked to an active Cloud Billing account. Blaze is the billing-account
link on the existing project, not a replacement Firebase database.

1. Select `cash-counter-84178` in Google Cloud Console, then Billing.
2. If the project has no billing account, link the intended active account (or
   select it through Firebase's Upgrade → Blaze flow).
3. Open that exact account's Billing Overview and Payment Overview. Resolve any
   closed/suspended status, identity verification, or payment-method request.
   For an India billing address, complete the identity verification requested
   by Google. If the payment used UPI, check the required mandate/activation
   instructions for that billing account rather than submitting duplicate payments.
4. Confirm that the Google Pay transaction appears in that account's payment
   activity. A payment applied to another profile/account does not activate this
   project's billing. A zero usage charge alone does not mean Spark: Blaze has
   no-cost allowances too. Check the plan label and project billing status.
5. If the payment is successful but absent, pending, or the account is still
   blocked, use free Cloud Billing support. Supply the project ID, billing
   account ID, payment date/amount, UPI reference, and exact error privately to
   Google; do not share card details, UPI PINs, or OTPs.
6. Confirm `billingEnabled: true` for the project and Blaze in Firebase before
   relying on paid features. Set a billing budget and alerts; alerts are not a
   hard spending cap. Upgrading does not increase Firestore's 1 MiB document limit.

Read-only CLI check, if gcloud is available and signed in:

```sh
gcloud beta billing projects describe cash-counter-84178
```

Official references:
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://docs.cloud.google.com/billing/docs/how-to/verify-billing-enabled
- https://docs.cloud.google.com/billing/docs/resources/upi-payment-india
- https://docs.cloud.google.com/billing/docs/how-to/create-billing-account
- https://cloud.google.com/support/billing
- https://firebase.google.com/docs/firestore/disaster-recovery

## Verification

```sh
node --experimental-strip-types --experimental-vm-modules --test tests/*.test.mjs
npx tsc -b
npm run build
```

The unit/regression tests use simulated cloud and local storage failures. They do
not replace Firebase Emulator tests or a real restore drill. The full TypeScript
and production build must complete successfully before deployment.
