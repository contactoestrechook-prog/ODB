// fetch() de Node no tiene timeout por defecto: si una API externa (MP, Tienda
// Nube) se cuelga, la request que la llama se cuelga con ella — el cliente
// queda esperando indefinidamente en vez de recibir un error claro y poder
// reintentar. Este wrapper le pone un límite razonable a cualquier llamada saliente.
export function fetchConTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
