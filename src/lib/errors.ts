// PostgREST возвращает обычный объект, а сетевые ошибки — экземпляр Error.
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return typeof error === 'string' ? error : '';
}
