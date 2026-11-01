import { useEffect, useState } from 'react';
import { apiGet, type ApiFailure } from './api';

export function useApiRead<T>(path: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${path}::${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: ApiFailure }>();
  useEffect(() => {
    const controller = new AbortController();
    apiGet<T>(path, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ key, data }); },
      error => { if (!controller.signal.aborted) setResult({ key, error }); },
    );
    return () => controller.abort();
  }, [path, key]);
  return {
    data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    retry: () => setAttempt(value => value + 1),
  };
}
