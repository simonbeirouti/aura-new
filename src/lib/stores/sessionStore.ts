import { createEnhancedStore, storeManager, type BaseStore } from './core/storeManager';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { User, AuthSession } from '@supabase/supabase-js';

// Session state interface
export interface SessionState {
  // Authentication data
  user: User | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Session metadata
  lastActivity: number | null;
  isOnline: boolean;
  deviceId: string | null;
  
  // Token management
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  
  // Sync state
  lastSync: number | null;
  pendingChanges: string[];
}

// Initial session state
const initialSessionState: SessionState = {
  user: null,
  session: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  lastActivity: null,
  isOnline: true,
  deviceId: null,
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  lastSync: null,
  pendingChanges: []
};

// Enhanced session store with persistence and sync
class SessionStore {
  private store: BaseStore<SessionState>;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.store = createEnhancedStore('session', initialSessionState, {
      saveOnChange: true,
      saveStrategy: 'debounce',
      saveInterval: 2000,
      syncStrategy: 'throttle',
      syncInterval: 1000,
      autoStart: true,
      // Don't persist sensitive tokens in frontend store - they stay in Tauri secure store
      filterKeys: ['accessToken', 'refreshToken'],
      filterKeysStrategy: 'omit'
    });

    // Register with store manager
    storeManager.registerStore('session', this.store);
    
    // Setup token refresh monitoring
    this.setupTokenRefresh();
  }

  // Store interface delegation
  get subscribe() {
    return this.store.subscribe;
  }

  // Authentication methods
  async setAuthenticated(user: User, session: AuthSession) {
    const now = Date.now();
    
    this.store.update(state => ({
      ...state,
      user,
      session,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      lastActivity: now,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      tokenExpiresAt: session.expires_at ? session.expires_at * 1000 : null,
      lastSync: now
    }));

    // Store tokens securely in Tauri
    try {
      await this.storeTokensSecurely(session.access_token, session.refresh_token);
    } catch (error) {
      throw error;
    }
    
    // Start token refresh monitoring
    this.scheduleTokenRefresh();
  }

  async setUnauthenticated(error?: string) {
    // Clear refresh timer first
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    // Clear tokens from Tauri store first (before store update)
    try {
      await this.clearTokensSecurely();
    } catch (tokenError) {
      // Continue silently on token clear failure
    }
    
    // Reset to unauthenticated state (simple update)
    try {
      this.store.update(state => ({
        ...state,
        user: null,
        session: null,
        isAuthenticated: false,
        isLoading: false,
        error: error || null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null
      }));
    } catch (updateError) {
      // Force reset the store if update fails
      this.store.set({
        user: null,
        session: null,
        isAuthenticated: false,
        isLoading: false,
        error: error || 'Session reset failed',
        lastActivity: null,
        isOnline: true,
        deviceId: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        lastSync: null,
        pendingChanges: []
      });
    }
  }

  async setLoading(loading: boolean) {
    this.store.update(state => ({
      ...state,
      isLoading: loading
    }));
  }

  async setError(error: string | null) {
    this.store.update(state => ({
      ...state,
      error,
      isLoading: false
    }));
  }

  async updateLastActivity() {
    const now = Date.now();
    this.store.update(state => ({
      ...state,
      lastActivity: now
    }));
  }

  async setOnlineStatus(isOnline: boolean) {
    this.store.update(state => ({
      ...state,
      isOnline
    }));
  }

  // Token management with Tauri secure storage
  private async storeTokensSecurely(accessToken: string, refreshToken: string) {
    try {
      await invoke('store_tokens', {
        tokens: {
          accessToken,
          refreshToken
        }
      });

      // Also initialize database configuration for IAP functions
      await invoke('init_database', {
        databaseUrl: import.meta.env.VITE_SUPABASE_URL,
        accessToken,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
      });
    } catch (error) {
      throw error;
    }
  }

  private async clearTokensSecurely() {
    try {
      await invoke('logout');
    } catch (error) {
      throw error;
    }
  }

  async getStoredTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const tokens = await invoke<{ access_token: string; refresh_token: string }>('get_tokens');
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token
      };
    } catch (error) {
      return null;
    }
  }

  async hasValidSession(): Promise<boolean> {
    try {
      // First check with backend
      const backendValid = await invoke<boolean>('check_session');

      if (backendValid) {
        // Also validate token expiry if we have it
        const state = get(this.store);
        if (state.tokenExpiresAt) {
          const now = Date.now();
          const expiryBuffer = 5 * 60 * 1000; // 5 minutes buffer
          const isValidExpiry = state.tokenExpiresAt > (now + expiryBuffer);

          return isValidExpiry;
        }

        return true;
      }

      return false;
    } catch (error) {
      // If backend check fails, assume session is valid to avoid unnecessary resets
      return true;
    }
  }

  // Check if tokens need refresh (within 10 minutes of expiry)
  isTokenRefreshNeeded(): boolean {
    const state = get(this.store);
    if (!state.tokenExpiresAt) return false;

    const now = Date.now();
    const refreshThreshold = 10 * 60 * 1000; // 10 minutes before expiry
    return state.tokenExpiresAt - now < refreshThreshold;
  }

  // Token refresh management
  private setupTokenRefresh() {
    this.store.subscribe(state => {
      if (state.isAuthenticated && state.tokenExpiresAt) {
        this.scheduleTokenRefresh();
      }
    });
  }

  private scheduleTokenRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Get current state to check token expiration
    const currentState = get(this.store);

    if (!currentState.tokenExpiresAt) return;

    // Schedule refresh 5 minutes before expiration
    const refreshTime = currentState.tokenExpiresAt - Date.now() - (5 * 60 * 1000);

    if (refreshTime > 0) {
      this.refreshTimer = setTimeout(async () => {
        await this.refreshTokens();
      }, refreshTime);
    } else {
      // Token is already expired or about to expire, refresh immediately
      this.refreshTokens();
    }
  }

  private async refreshTokens() {
    try {
      const tokens = await this.getStoredTokens();
      if (!tokens) {
        await this.setUnauthenticated('No refresh token available');
        return;
      }

      // This would typically call your auth service to refresh tokens
      // For now, we'll update the stored tokens if refresh is successful
      await invoke('update_tokens', {
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken
        }
      });

      // Update last activity
      await this.updateLastActivity();
      
      // Schedule next refresh
      this.scheduleTokenRefresh();
      
    } catch (error) {
      await this.setUnauthenticated('Token refresh failed');
    }
  }

  // Sync methods
  async sync() {
    await this.store.sync();
    
    // Update sync timestamp
    this.store.update(state => ({
      ...state,
      lastSync: Date.now()
    }));
  }

  async load() {
    await this.store.load();
  }

  async save() {
    await this.store.save();
  }

  // Cleanup
  destroy() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.store.destroy();
  }
}

// Create and export the session store instance
export const sessionStore = new SessionStore();

// Export helper functions for common operations
export const sessionActions = {
  setAuthenticated: (user: User, session: AuthSession) => sessionStore.setAuthenticated(user, session),
  setUnauthenticated: (error?: string) => sessionStore.setUnauthenticated(error),
  setLoading: (loading: boolean) => sessionStore.setLoading(loading),
  setError: (error: string | null) => sessionStore.setError(error),
  updateActivity: () => sessionStore.updateLastActivity(),
  setOnline: (isOnline: boolean) => sessionStore.setOnlineStatus(isOnline),
  getTokens: () => sessionStore.getStoredTokens(),
  hasValidSession: () => sessionStore.hasValidSession(),
  sync: () => sessionStore.sync(),
  load: () => sessionStore.load(),
  save: () => sessionStore.save()
};
