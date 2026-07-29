export type PineLabsEnvironment = 'uat' | 'production'

export type PineLabsApiMethod =
  | 'UploadBilledTransaction'
  | 'GetCloudBasedTxnStatus'
  | 'CancelTransaction'

export interface PineLabsSettings {
  enabled: boolean
  environment: PineLabsEnvironment
  merchantId: string
  securityToken: string
  /** Store ID from Pine Labs (use this or merchantStorePosCode). */
  storeId: string
  /** 5-char store code + 3-digit POS ID, e.g. MP123015 */
  merchantStorePosCode: string
  /** Device IMEI registered with Pine Labs. */
  clientId: string
  /** Cashier ID shown on terminal. */
  userId: string
  /** 0 = all modes on terminal; 1 = card; 10 = UPI sale; etc. */
  allowedPaymentMode: string
}

export const PINELABS_SETTINGS_KEY = 'pinelabs-settings'

const DEFAULT_SETTINGS: PineLabsSettings = {
  enabled: false,
  environment: 'uat',
  merchantId: '',
  securityToken: '',
  storeId: '',
  merchantStorePosCode: '',
  clientId: '',
  userId: '',
  allowedPaymentMode: '0',
}

export function getPineLabsBaseUrl(environment: PineLabsEnvironment): string {
  return environment === 'uat'
    ? 'https://www.plutuscloudserviceuat.in:8201'
    : 'https://www.plutuscloudservice.in:8201'
}

export function getPineLabsApiUrl(
  environment: PineLabsEnvironment,
  method: PineLabsApiMethod,
): string {
  return `${getPineLabsBaseUrl(environment)}/API/CloudBasedIntegration/V1/${method}`
}

export function getPineLabsSettings(): PineLabsSettings {
  try {
    const raw = localStorage.getItem(PINELABS_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<PineLabsSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      environment: parsed.environment === 'production' ? 'production' : 'uat',
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setPineLabsSettings(settings: PineLabsSettings): void {
  localStorage.setItem(PINELABS_SETTINGS_KEY, JSON.stringify(settings))
}

export function isPineLabsConfigured(settings: PineLabsSettings = getPineLabsSettings()): boolean {
  if (!settings.merchantId.trim() || !settings.securityToken.trim()) return false
  return Boolean(settings.storeId.trim() || settings.merchantStorePosCode.trim())
}
