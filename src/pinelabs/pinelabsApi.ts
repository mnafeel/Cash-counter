import {
  getPineLabsApiUrl,
  isPineLabsConfigured,
  type PineLabsEnvironment,
  type PineLabsSettings,
} from './config'

export interface PineLabsJsonResponse {
  ResponseCode?: number
  ResponseMessage?: string
  PlutusTransactionReferenceID?: number
  TransactionData?: { Tag?: string; Value?: string }[]
}

async function postPineLabsJson(
  apiUrl: string,
  body: Record<string, unknown>,
): Promise<PineLabsJsonResponse> {
  let target = apiUrl.replace(/\/+$/, '')
  let url = target
  let headers: Record<string, string> = { 'Content-Type': 'application/json' }

  try {
    if (new URL(target).origin !== window.location.origin) {
      url = '/__pinelabs-api'
      headers = {
        ...headers,
        'X-Pinelabs-Target': target,
      }
    }
  } catch {
    /* use direct URL */
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(text.trim() || `Pine Labs HTTP ${res.status}`)
  }

  try {
    return JSON.parse(text) as PineLabsJsonResponse
  } catch {
    throw new Error(text.trim() || 'Invalid Pine Labs response')
  }
}

function storeFields(settings: PineLabsSettings): Record<string, string> {
  const out: Record<string, string> = {}
  const storeId = settings.storeId.trim()
  const posCode = settings.merchantStorePosCode.trim()
  if (posCode) out.MerchantStorePosCode = posCode
  else if (storeId) out.StoreId = storeId
  return out
}

function authFields(settings: PineLabsSettings): Record<string, string | number> {
  const out: Record<string, string | number> = {
    MerchantID: settings.merchantId.trim(),
    SecurityToken: settings.securityToken.trim(),
  }
  const clientId = settings.clientId.trim()
  const userId = settings.userId.trim()
  if (clientId) out.ClientID = clientId
  if (userId) out.UserID = userId
  Object.assign(out, storeFields(settings))
  return out
}

export async function testPineLabsConnection(
  settings: PineLabsSettings,
): Promise<{ connected: boolean; message: string }> {
  if (!isPineLabsConfigured(settings)) {
    return {
      connected: false,
      message: 'Enter Merchant ID, Security Token, and Store ID or Merchant Store POS code.',
    }
  }

  const apiUrl = getPineLabsApiUrl(settings.environment, 'GetCloudBasedTxnStatus')
  try {
    const response = await postPineLabsJson(apiUrl, {
      ...authFields(settings),
      PlutusTransactionReferenceID: 0,
    })

    const code = response.ResponseCode
    const msg = (response.ResponseMessage ?? '').trim()

    if (code === 0) {
      return { connected: true, message: msg || 'Connected to Pine Labs.' }
    }

    const lower = msg.toLowerCase()
    if (
      lower.includes('invalid') &&
      (lower.includes('token') ||
        lower.includes('merchant') ||
        lower.includes('security') ||
        lower.includes('credential'))
    ) {
      return { connected: false, message: msg || 'Invalid Pine Labs credentials.' }
    }

    return {
      connected: true,
      message: msg
        ? `Connected · ${msg}`
        : 'Connected — credentials accepted (test status lookup returned no transaction).',
    }
  } catch (err) {
    return {
      connected: false,
      message: err instanceof Error ? err.message : 'Cannot reach Pine Labs API.',
    }
  }
}

export async function uploadPineLabsBilledTransaction(
  settings: PineLabsSettings,
  input: {
    transactionNumber: string
    amountPaisa: number
    sequenceNumber?: number
    totalInvoiceAmountPaisa?: number
  },
): Promise<PineLabsJsonResponse> {
  if (!isPineLabsConfigured(settings)) {
    throw new Error('Pine Labs is not configured.')
  }

  const apiUrl = getPineLabsApiUrl(settings.environment, 'UploadBilledTransaction')
  const body: Record<string, unknown> = {
    ...authFields(settings),
    TransactionNumber: input.transactionNumber,
    SequenceNumber: input.sequenceNumber ?? 1,
    AllowedPaymentMode: settings.allowedPaymentMode.trim() || '0',
    Amount: input.amountPaisa,
  }
  if (input.totalInvoiceAmountPaisa != null) {
    body.TotalInvoiceAmount = input.totalInvoiceAmountPaisa
  }

  return postPineLabsJson(apiUrl, body)
}

export async function getPineLabsTxnStatus(
  settings: PineLabsSettings,
  plutusTransactionReferenceId: number,
  transactionNumber?: string,
): Promise<PineLabsJsonResponse> {
  if (!isPineLabsConfigured(settings)) {
    throw new Error('Pine Labs is not configured.')
  }

  const apiUrl = getPineLabsApiUrl(settings.environment, 'GetCloudBasedTxnStatus')
  const body: Record<string, unknown> = {
    ...authFields(settings),
    PlutusTransactionReferenceID: plutusTransactionReferenceId,
  }
  if (transactionNumber?.trim()) body.TransactionNumber = transactionNumber.trim()
  return postPineLabsJson(apiUrl, body)
}

export function pineLabsEnvironmentLabel(environment: PineLabsEnvironment): string {
  return environment === 'uat' ? 'UAT (testing)' : 'Production'
}
