const STORAGE_KEY = 'jianai.cloudflare-image-settings'

export interface CloudflareImageSettings {
  accountId: string
  apiToken: string
}

const DEFAULT_SETTINGS: CloudflareImageSettings = {
  accountId: '',
  apiToken: '',
}

export function readCloudflareImageSettings(): CloudflareImageSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }

    const parsed = JSON.parse(raw) as Partial<CloudflareImageSettings>
    return {
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId : '',
      apiToken: typeof parsed.apiToken === 'string' ? parsed.apiToken : '',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveCloudflareImageSettings(settings: CloudflareImageSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

