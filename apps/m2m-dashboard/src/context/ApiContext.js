import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { createApiClient } from '../utils/api';

/**
 * Global API context — provides an Axios client with the configured API key
 * to all components.  Stores the key in localStorage for persistence across
 * reloads (dev convenience — NOT production-safe).
 */

const ApiContext = createContext(null);

const LOCAL_STORAGE_KEY = 'xfuel_dashboard_api_key';

export function ApiProvider({ children }) {
  const [apiKey, setApiKeyState] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_KEY) || process.env.REACT_APP_API_KEY || '';
    } catch {
      return process.env.REACT_APP_API_KEY || '';
    }
  });

  const setApiKey = useCallback((key) => {
    setApiKeyState(key);
    try {
      if (key) {
        localStorage.setItem(LOCAL_STORAGE_KEY, key);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const client = useMemo(() => createApiClient(apiKey), [apiKey]);

  const value = useMemo(
    () => ({ apiKey, setApiKey, client }),
    [apiKey, setApiKey, client],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

/**
 * Hook to access the API context.
 * Returns { apiKey, setApiKey, client }
 */
export function useApi() {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used within <ApiProvider>');
  return ctx;
}
