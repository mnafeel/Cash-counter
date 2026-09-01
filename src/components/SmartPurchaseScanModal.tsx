import { useEffect, useRef, useState } from 'react'
import type { ExpenseBillMode } from '../utils/expenseBillLabels'
import { GST_BILL_LABEL, NO_GST_BILL_LABEL, purchaseBillLabel } from '../utils/expenseBillLabels'
import { formatMoney } from '../utils/format'
import { extractTextFromPurchaseDocument } from '../utils/purchaseDocumentOcr'
import {
  isValidIsoBillDate,
  parsePurchaseBillText,
  textsOverlap,
  type PurchaseScanResult,
} from '../utils/purchaseScan'
import Portal from './Portal'
import './SmartPurchaseScanModal.css'

type SmartPurchaseScanModalProps = {
  open: boolean
  onClose: () => void
  onApply: (result: PurchaseScanResult, billMode: ExpenseBillMode) => void
}

type ScanStep = 'pick' | 'processing' | 'review' | 'bill-type'

type ReviewDraft = {
  partyName: string
  itemName: string
  totalAmount: string
  billNumber: string
  billDate: string
}

function buildReviewDraft(result: PurchaseScanResult): ReviewDraft {
  return {
    partyName: result.partyName?.trim() ?? '',
    itemName: result.itemName?.trim() ?? '',
    totalAmount: result.totalAmount ? String(result.totalAmount) : '',
    billNumber: result.billNumber?.trim() ?? '',
    billDate: result.billDate?.trim() ?? '',
  }
}

function buildResultFromDraft(base: PurchaseScanResult, draft: ReviewDraft): PurchaseScanResult {
  const partyName = draft.partyName.trim() || undefined
  let itemName = draft.itemName.trim() || undefined
  if (itemName && textsOverlap(itemName, partyName)) itemName = undefined

  const totalRaw = draft.totalAmount.trim().replace(/,/g, '')
  const totalAmount = totalRaw ? Number(totalRaw) : undefined
  const billDate = isValidIsoBillDate(draft.billDate.trim()) ? draft.billDate.trim() : undefined

  return {
    ...base,
    partyName,
    itemName,
    totalAmount: totalAmount != null && Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : undefined,
    billNumber: draft.billNumber.trim() || undefined,
    billDate,
  }
}

export default function SmartPurchaseScanModal({
  open,
  onClose,
  onApply,
}: SmartPurchaseScanModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ScanStep>('pick')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<PurchaseScanResult | null>(null)
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null)
  const [selectedBillMode, setSelectedBillMode] = useState<ExpenseBillMode>('no1')

  useEffect(() => {
    if (!open) return
    setStep('pick')
    setStatus('')
    setError('')
    setScanResult(null)
    setReviewDraft(null)
    setSelectedBillMode('no1')
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
  }, [open])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  if (!open) return null

  function resetInputs() {
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (pdfInputRef.current) pdfInputRef.current.value = ''
  }

  function openReview(parsed: PurchaseScanResult) {
    setScanResult(parsed)
    setReviewDraft(buildReviewDraft(parsed))
    setStep('review')
  }

  async function handleFile(file: File | null | undefined) {
    if (!file) return
    setError('')
    setStatus('Preparing document…')
    setStep('processing')
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      if (file.type.startsWith('image/')) return URL.createObjectURL(file)
      return null
    })

    try {
      const text = await extractTextFromPurchaseDocument(file, setStatus)
      if (!text.trim()) {
        throw new Error('Could not read any text from this bill. Try a clearer photo or PDF.')
      }
      const parsed = parsePurchaseBillText(text)
      setScanResult(parsed)
      setReviewDraft(buildReviewDraft(parsed))
      if (parsed.billMode && parsed.billModeConfidence === 'high') {
        setSelectedBillMode(parsed.billMode)
        openReview(parsed)
      } else if (parsed.billMode && parsed.billModeConfidence === 'low') {
        setSelectedBillMode(parsed.billMode)
        setStep('bill-type')
      } else {
        setStep('bill-type')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not scan this bill.')
      setStep('pick')
    } finally {
      resetInputs()
    }
  }

  function handleApply() {
    if (!scanResult || !reviewDraft) return
    onApply(buildResultFromDraft(scanResult, reviewDraft), selectedBillMode)
    onClose()
  }

  function updateDraft<K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) {
    setReviewDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  return (
    <Portal>
      <div className="smart-purchase-overlay" role="dialog" aria-modal="true" aria-label="Smart purchase entry">
        <button type="button" className="smart-purchase-backdrop" aria-label="Close smart purchase entry" onClick={onClose} />
        <section className="smart-purchase-panel">
          <header className="smart-purchase-head">
            <div>
              <h2>Smart Purchase Entry</h2>
              <p>Scan a supplier bill — supplier, first item, and total are read from the bill. Edit anything before saving.</p>
            </div>
            <button type="button" className="smart-purchase-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          {step === 'pick' ? (
            <div className="smart-purchase-pick">
              <div className="smart-purchase-actions">
                <button
                  type="button"
                  className="smart-purchase-action smart-purchase-action--camera"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <span aria-hidden="true">📷</span>
                  <strong>Take photo</strong>
                  <small>Use camera now</small>
                </button>
                <button
                  type="button"
                  className="smart-purchase-action"
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <span aria-hidden="true">🖼️</span>
                  <strong>Gallery</strong>
                  <small>Choose existing photo</small>
                </button>
                <button
                  type="button"
                  className="smart-purchase-action"
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <span aria-hidden="true">📄</span>
                  <strong>PDF</strong>
                  <small>Upload bill PDF</small>
                </button>
              </div>
              {error ? <p className="smart-purchase-error">{error}</p> : null}
            </div>
          ) : null}

          {step === 'processing' ? (
            <div className="smart-purchase-processing" aria-live="polite">
              {previewUrl ? (
                <img src={previewUrl} alt="Uploaded bill preview" className="smart-purchase-preview" />
              ) : null}
              <div className="smart-purchase-spinner" aria-hidden="true" />
              <p>{status || 'Processing bill…'}</p>
            </div>
          ) : null}

          {step === 'bill-type' && scanResult ? (
            <div className="smart-purchase-review">
              <p className="smart-purchase-note">
                We could not confidently tell if this is {purchaseBillLabel(1)} or {purchaseBillLabel(2)}.
                Please choose the bill type.
              </p>
              <div className="smart-purchase-bill-type">
                <button
                  type="button"
                  className={`smart-purchase-bill-type-btn ${selectedBillMode === 'no1' ? 'smart-purchase-bill-type-btn--active' : ''}`}
                  onClick={() => setSelectedBillMode('no1')}
                >
                  <strong>{purchaseBillLabel(1)}</strong>
                  <small>{GST_BILL_LABEL}</small>
                </button>
                <button
                  type="button"
                  className={`smart-purchase-bill-type-btn ${selectedBillMode === 'no2' ? 'smart-purchase-bill-type-btn--active' : ''}`}
                  onClick={() => setSelectedBillMode('no2')}
                >
                  <strong>{purchaseBillLabel(2)}</strong>
                  <small>{NO_GST_BILL_LABEL}</small>
                </button>
              </div>
              <button
                type="button"
                className="smart-purchase-btn smart-purchase-btn--primary"
                onClick={() => {
                  if (scanResult) setReviewDraft(buildReviewDraft(scanResult))
                  setStep('review')
                }}
              >
                Continue
              </button>
            </div>
          ) : null}

          {step === 'review' && scanResult && reviewDraft ? (
            <div className="smart-purchase-review">
              {previewUrl ? (
                <img src={previewUrl} alt="Scanned bill preview" className="smart-purchase-preview smart-purchase-preview--small" />
              ) : null}
              <div className="smart-purchase-form">
                <label className={`smart-purchase-field ${reviewDraft.partyName ? '' : 'smart-purchase-field--missing'}`}>
                  <span>Supplier</span>
                  <input
                    type="text"
                    value={reviewDraft.partyName}
                    onChange={(e) => updateDraft('partyName', e.target.value)}
                    placeholder="Not detected — type supplier name"
                    autoComplete="off"
                  />
                </label>
                <label className={`smart-purchase-field ${reviewDraft.itemName ? '' : 'smart-purchase-field--missing'}`}>
                  <span>First item</span>
                  <input
                    type="text"
                    value={reviewDraft.itemName}
                    onChange={(e) => updateDraft('itemName', e.target.value)}
                    placeholder="Not detected — type item"
                    autoComplete="off"
                  />
                </label>
                <label className={`smart-purchase-field ${reviewDraft.totalAmount ? '' : 'smart-purchase-field--missing'}`}>
                  <span>Total (₹)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={reviewDraft.totalAmount}
                    onChange={(e) => updateDraft('totalAmount', e.target.value)}
                    placeholder="Not detected"
                    autoComplete="off"
                  />
                </label>
                <label className={`smart-purchase-field ${reviewDraft.billNumber ? '' : 'smart-purchase-field--missing'}`}>
                  <span>Bill no.</span>
                  <input
                    type="text"
                    value={reviewDraft.billNumber}
                    onChange={(e) => updateDraft('billNumber', e.target.value)}
                    placeholder="Not detected"
                    autoComplete="off"
                  />
                </label>
                <label className={`smart-purchase-field ${reviewDraft.billDate ? '' : 'smart-purchase-field--missing'}`}>
                  <span>Bill date</span>
                  <input
                    type="date"
                    value={reviewDraft.billDate}
                    onChange={(e) => updateDraft('billDate', e.target.value)}
                  />
                </label>
                <div className="smart-purchase-field smart-purchase-field--static">
                  <span>Bill type</span>
                  <strong>{selectedBillMode === 'no1' ? purchaseBillLabel(1) : purchaseBillLabel(2)}</strong>
                </div>
                <div className="smart-purchase-field smart-purchase-field--static">
                  <span>Payment</span>
                  <strong>Credit</strong>
                </div>
              </div>
              <p className="smart-purchase-note">
                Different suppliers use different bill layouts — correct any field here before applying.
                {reviewDraft.totalAmount ? ` Total: ${formatMoney(Number(reviewDraft.totalAmount.replace(/,/g, '')) || 0)}` : ''}
              </p>
              <div className="smart-purchase-foot">
                <button type="button" className="smart-purchase-btn" onClick={() => setStep('pick')}>
                  Scan again
                </button>
                <button type="button" className="smart-purchase-btn smart-purchase-btn--primary" onClick={handleApply}>
                  Use these details
                </button>
              </div>
            </div>
          ) : null}

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="smart-purchase-file-input"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="smart-purchase-file-input"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="smart-purchase-file-input"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </section>
      </div>
    </Portal>
  )
}
