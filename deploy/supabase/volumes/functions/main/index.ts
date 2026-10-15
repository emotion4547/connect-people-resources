// Роутер edge-функций. Основан на официальном main из docker-образа Supabase,
// но без `jsr:@panva/jose`: на этом сервере загрузка jose с jsr.io зависала и
// рантайм не открывал порт. Токены у нас только HS256 (legacy JWT_SECRET),
// проверяем их встроенным WebCrypto — внешних зависимостей нет.

const JWT_SECRET = Deno.env.get('JWT_SECRET')
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'
const MAX_WORKER_RETRIES = 3

console.log('main function started')

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function verifyHs256(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) return false
  const parts = jwt.split('.')
  if (parts.length !== 3) return false
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])))
    if (header.alg !== 'HS256') return false
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    )
    if (!ok) return false
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])))
    return !payload.exp || payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

const unauthorized = (message: string) =>
  Response.json(
    { code: 'UNAUTHORIZED', message, msg: message },
    { status: 401, headers: { 'sb-error-code': 'UNAUTHORIZED', 'Access-Control-Expose-Headers': 'sb-error-code' } }
  )

const errorResponse = (code: string, message: string, status: number) =>
  Response.json(
    { code, message },
    { status, headers: { 'sb-error-code': code, 'Access-Control-Expose-Headers': 'sb-error-code' } }
  )

function runtimeError(e: unknown): Response {
  if (e instanceof Deno.errors.InvalidWorkerCreation) {
    return errorResponse('BOOT_ERROR', 'Function failed to start (please check logs)', 503)
  }
  if (e instanceof Deno.errors.WorkerRequestCancelled) {
    return errorResponse('WORKER_RESOURCE_LIMIT', 'Function failed due to not having enough compute resources', 546)
  }
  if (e instanceof Deno.errors.WorkerRequestIdleTimeout) {
    return errorResponse('IDLE_TIMEOUT', 'Request idle timeout limit (150s) reached', 504)
  }
  if (e instanceof Deno.errors.WorkerAlreadyRetired || e instanceof Deno.errors.InvalidWorkerResponse) {
    return errorResponse('WORKER_ERROR', 'Function exited due to an error (please check logs)', 500)
  }
  return errorResponse('EDGE_FUNCTION_ERROR', 'Internal Server Error', 500)
}

function withErrorCode(response: Response): Response {
  if (response.status < 500) return response
  const headers = new Headers(response.headers)
  headers.set('sb-error-code', 'EDGE_FUNCTION_ERROR')
  headers.set('Access-Control-Expose-Headers', 'sb-error-code')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'OPTIONS' && VERIFY_JWT) {
    const m = (req.headers.get('authorization') ?? '').trim().match(/^bearer\s+(\S+)$/i)
    if (!m) return unauthorized('Missing authorization header')
    if (!(await verifyHs256(m[1]))) return unauthorized('Invalid JWT')
  }

  const serviceName = new URL(req.url).pathname.split('/')[1]
  if (!serviceName || !/^[a-zA-Z0-9_-]+$/.test(serviceName)) {
    return errorResponse('NOT_FOUND', 'Requested function was not found', 404)
  }

  const servicePath = `/home/deno/functions/${serviceName}`
  try {
    const info = await Deno.stat(servicePath)
    if (!info.isDirectory) return errorResponse('NOT_FOUND', 'Requested function was not found', 404)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return errorResponse('NOT_FOUND', 'Requested function was not found', 404)
    console.error(e)
    return errorResponse('BOOT_ERROR', 'Function failed to start (please check logs)', 503)
  }

  const envVarsObj = { ...Deno.env.toObject(), SUPABASE_FUNCTION_SLUG: serviceName }
  const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]])

  const callWorker = async (r: Request, retriesLeft = MAX_WORKER_RETRIES): Promise<Response> => {
    const retryReq = retriesLeft > 0 ? r.clone() : null
    try {
      const worker = await EdgeRuntime.userWorkers.create({
        servicePath,
        memoryLimitMb: 150,
        workerTimeoutMs: 400_000,
        context: { supervisor: { requestAbsentTimeoutMs: 60_000 } },
        noModuleCache: false,
        importMapPath: null,
        envVars,
      })
      const userReq = new Request(r)
      EdgeRuntime.applySupabaseTag(r, userReq)
      return withErrorCode(await worker.fetch(userReq))
    } catch (e) {
      if (e instanceof Deno.errors.WorkerAlreadyRetired && retryReq) {
        EdgeRuntime.applySupabaseTag(r, retryReq)
        return await callWorker(retryReq, retriesLeft - 1)
      }
      console.error(e)
      return runtimeError(e)
    }
  }

  return await callWorker(req)
})
