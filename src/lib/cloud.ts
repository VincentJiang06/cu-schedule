// 账号云端同步的客户端。服务端由部署方的私有扩展承担(/api/v1/*,不随本仓库分发);
// 拿不到该服务时账号功能自动降级为「连不上服务器」提示,其余功能不受影响。
//
// 客户端侧约定:
//   - 凭据存 localStorage,请求经 Basic 头提交(HTTPS 传输)。
//   - 云端配置 = ConfigMdState(与 .md 备份完全同一套可携带状态,共用 sanitizeConfigState
//     校验)+ 个人信息(入学年/主修)+ 选中排法签名(plan.id,数据更新后按签名回配)。
//   - 一切解码防御式:服务器返回的任何畸形内容 → null / 抛 CloudError,绝不污染本地状态。

import { sanitizeConfigState, type ConfigMdState } from './configMd.ts'
import { utf8ToBase64 } from './shareLink.ts'

/** 课表页选中排法的签名(plan.id = 排序 section id 连接,天然稳定)。 */
export type PlanSigs = { solo: string | null; a: string | null; b: string | null }

export type CloudConfig = ConfigMdState & {
  enrollYear: string
  programId: string
  planSigs: PlanSigs
}

export type CloudCreds = { username: string; password: string }

const CREDS_KEY = 'cu-schedule:account'
export const USERNAME_RE = /^[A-Za-z0-9_.-]{2,32}$/

export function loadCreds(): CloudCreds | null {
  try {
    const raw = window.localStorage.getItem(CREDS_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const r = parsed as Record<string, unknown>
    if (typeof r.username !== 'string' || typeof r.password !== 'string') return null
    if (!USERNAME_RE.test(r.username)) return null
    return { username: r.username, password: r.password }
  } catch {
    return null
  }
}

export function saveCreds(creds: CloudCreds): void {
  try {
    window.localStorage.setItem(CREDS_KEY, JSON.stringify(creds))
  } catch {
    /* 存不进(隐私模式等)就当次会话有效 */
  }
}

export function clearCreds(): void {
  try {
    window.localStorage.removeItem(CREDS_KEY)
  } catch {
    /* ignore */
  }
}

/** 服务端返回的畸形配置一律拒收:先过 .md 同款校验,再补账号特有字段的默认值。 */
export function sanitizeCloudConfig(value: unknown): CloudConfig | null {
  const base = sanitizeConfigState(value)
  if (!base) return null
  const r = value as Record<string, unknown>
  const rawSigs =
    typeof r.planSigs === 'object' && r.planSigs !== null ? (r.planSigs as Record<string, unknown>) : {}
  const sig = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    ...base,
    enrollYear: typeof r.enrollYear === 'string' ? r.enrollYear : '',
    programId: typeof r.programId === 'string' ? r.programId : '',
    planSigs: { solo: sig(rawSigs.solo), a: sig(rawSigs.a), b: sig(rawSigs.b) },
  }
}

/** code 取服务端错误码('wrong_password' 等)或 'network' / 'http_<status>'。 */
export class CloudError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export function cloudErrorText(cause: unknown): string {
  const code = cause instanceof CloudError ? cause.code : 'network'
  switch (code) {
    case 'wrong_password':
      return '口令不对(没有找回功能——忘了就换个新用户名注册)'
    case 'too_many_attempts':
      return '尝试次数太多,过几分钟再试'
    case 'bad_username':
      return '用户名只能用 2–32 位字母、数字、点、横线、下划线'
    case 'bad_password':
      return '口令长度需在 1–64 之间'
    case 'unauthorized':
      return '登录已失效,请重新登录'
    case 'network':
      return '连不上服务器,稍后会自动重试'
    default:
      return `同步出错(${code})`
  }
}

export function isAuthError(cause: unknown): boolean {
  return cause instanceof CloudError && (cause.code === 'unauthorized' || cause.code === 'wrong_password')
}

function basicHeader(creds: CloudCreds): string {
  return `Basic ${utf8ToBase64(`${creds.username}:${creds.password}`)}`
}

async function api(path: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new CloudError('network')
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    /* 无 body / 非 JSON:让下面的状态码判断兜底 */
  }
  if (!response.ok) {
    const code =
      typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `http_${response.status}`
    throw new CloudError(code)
  }
  return payload
}

/** 注册即登录:名字空着 → 创建;已存在 → 核对口令。 */
export async function cloudAuth(creds: CloudCreds): Promise<{ created: boolean; hasConfig: boolean }> {
  const payload = (await api('/api/v1/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })) as { created?: unknown; hasConfig?: unknown }
  return { created: payload.created === true, hasConfig: payload.hasConfig === true }
}

export async function cloudLoad(
  creds: CloudCreds,
): Promise<{ config: CloudConfig | null; updatedAt: string | null }> {
  const payload = (await api('/api/v1/me', {
    headers: { Authorization: basicHeader(creds) },
  })) as { config?: unknown; updatedAt?: unknown }
  return {
    config: sanitizeCloudConfig(payload.config),
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  }
}

export async function cloudSave(creds: CloudCreds, config: CloudConfig): Promise<string | null> {
  const payload = (await api('/api/v1/me', {
    method: 'PUT',
    headers: { Authorization: basicHeader(creds), 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })) as { updatedAt?: unknown }
  return typeof payload.updatedAt === 'string' ? payload.updatedAt : null
}
