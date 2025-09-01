import { writable, derived, get } from 'svelte/store';
import { createClient, type AuthSession, type User } from '@supabase/supabase-js';
import { sessionStore } from './sessionStore';
import { dataActions } from './dataStore';
import { storeManager } from './core/storeManager';
import { userStore } from './userStore';
import { syncSubscriptionsWithIAP } from '$lib/utils/iapDatabase';

// Supabase client setup with better error handling
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Create a safe Supabase client that won't crash on missing env vars
let supabase: any;
try {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseAnonKey
    });

    // On mobile platforms, this might be expected during development
    if (typeof window !== 'undefined' && 'webkit' in window) {
      console.warn('Mobile platform detected - Supabase configuration may be incomplete during development');
    }

    throw new Error(
      'Missing Supabase environment variables. Please check your .env file and ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.'
    );
  }

  supabase = createClient(supabaseUrl, supabaseAnonKey);
} catch (error) {
  console.error('Failed to create Supabase client:', error);

  // Create a dummy client to prevent runtime errors
  supabase = {
    auth: {
      setSession: () => Promise.resolve({ data: { user: null }, error: new Error('Supabase not configured') }),
      getSession: () => Promise.resolve({ data: { session: null }, error: new Error('Supabase not configured') }),
      signInWithPassword: () => Promise.resolve({ data: { user: null, session: null }, error: new Error('Supabase not configured') }),
      signUp: () => Promise.resolve({ data: { user: null, session: null }, error: new Error('Supabase not configured') }),
      signOut: () => Promise.resolve({ error: null }),
      refreshSession: () => Promise.resolve({ data: { session: null }, error: new Error('Supabase not configured') }),
      getUser: () => Promise.resolve({ data: { user: null }, error: new Error('Supabase not configured') })
    }
  };
}

export { supabase };

// Export centralized config access
export const getSupabaseConfig = () => ({
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  hasValidConfig: !!(supabaseUrl && supabaseAnonKey)
});

// Unified Auth State Interface
interface UnifiedAuthState {
  // Core auth state
  isInitialized: boolean;
  isAuthenticated: boolean;
  user: User | null;
  session: AuthSession | null;
  isLoading: boolean;
  error: string | null;

  // Profile data
  profile: any | null;
  profileLoaded: boolean;

  // System status
  stripeInitialized: boolean;

  // Session management
  lastActivity: number | null;
  tokenExpiresAt: number | null;
}

// Initialization result
export interface InitializationResult {
  authReady: boolean;
  profileReady: boolean;
  stripeReady: boolean;
  errors: string[];
}

// Initial state
const initialState: UnifiedAuthState = {
  isInitialized: false,
  isAuthenticated: false,
  user: null,
  session: null,
  isLoading: true,
  error: null,
  profile: null,
  profileLoaded: false,
  stripeInitialized: false,
  lastActivity: null,
  tokenExpiresAt: null
};

// Unified Authentication Store
class UnifiedAuthStore {
  private store = writable<UnifiedAuthState>(initialState);
  private refreshTimer: NodeJS.Timeout | null = null;
  private iapSyncTimer: NodeJS.Timeout | null = null;

  // Store subscription
  subscribe = this.store.subscribe;

  // Derived states for UI logic
  readonly isReady = derived(
    this.store,
    $state => $state.isInitialized && !$state.isLoading
  );

  readonly shouldShowApp = derived(
    this.store,
    $state => {
      const result = $state.isAuthenticated && $state.profile && $state.profile.onboarding_complete;
      return result;
    }
  );

  readonly shouldShowOnboarding = derived(
    this.store,
    $state => {
      const result = $state.isAuthenticated && $state.profileLoaded && (!$state.profile || !$state.profile.onboarding_complete);
      return result;
    }
  );

  readonly shouldShowLogin = derived(
    this.store,
    $state => !$state.isAuthenticated && $state.isInitialized
  );

  /**
   * Initialize the entire application authentication and data layer
   */
  async initialize(): Promise<InitializationResult> {
    this.store.update(state => ({
      ...state,
      isLoading: true,
      error: null,
    }));

    const result: InitializationResult = {
      authReady: false,
      profileReady: false,
      stripeReady: false,
      errors: []
    };

    try {
      // Step 1: Initialize core systems
      await storeManager.initialize();

      // Step 2: Initialize authentication
      const authSuccess = await this.initializeAuth();
      result.authReady = authSuccess;

      // Step 4: Load profile if authenticated
      const state = get(this.store);
      if (state.isAuthenticated && state.user) {
        try {
          await dataActions.initialize();
          const profile = await dataActions.getUserProfile(state.user.id, false);

          this.store.update(s => ({
            ...s,
            profile,
            profileLoaded: true
          }));
          result.profileReady = !!profile;
        } catch (error) {
          result.errors.push(`Failed to load profile: ${error}`);
          this.store.update(s => ({ ...s, profileLoaded: true })); // Mark as loaded even if failed
        }
      } else {
        this.store.update(s => ({ ...s, profileLoaded: true })); // No user, so profile is "loaded"
      }

      // Step 5: Mark as initialized
      this.store.update(state => ({
        ...state,
        isInitialized: true,
        isLoading: false
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);

      this.store.update(state => ({
        ...state,
        error: errorMessage,
        isLoading: false,
        isInitialized: true // Still mark as initialized to prevent loops
      }));
    }

    return result;
  }

  /**
   * Initialize authentication layer
   */
  private async initializeAuth(): Promise<boolean> {
    try {
      // Load session data from persistent store
      await sessionStore.load();

      // Check if we have valid stored session
      const hasValidSession = await sessionStore.hasValidSession();

      if (hasValidSession) {
        // Try to restore session from stored tokens
        const tokens = await sessionStore.getStoredTokens();
        if (tokens) {
          // Initialize Supabase client
          if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error('Missing Supabase configuration');
          }
          
          const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
          
          // Restore session if available
          const { data: { session } } = await supabaseClient.auth.getSession();
          if (session) {
            await sessionStore.setAuthenticated(session.user, session);
          }
        }
      }

      // No valid session found, check current Supabase session
      const { data: { session: currentSession } } = await supabase.auth.getSession();

      if (currentSession) {
        // Store the current session tokens
        await this.setAuthenticated(currentSession.user, currentSession);
        return true;
      } else {
        // No session found
        await this.setUnauthenticated();
        return true;
      }
    } catch (error) {
      await this.setUnauthenticated(
        error instanceof Error ? error.message : 'Authentication failed'
      );
      return false;
    }
  }

  /**
   * Set authenticated state
   */
  private async setAuthenticated(user: User, session: AuthSession): Promise<void> {
    const now = Date.now();

    this.store.update(state => ({
      ...state,
      user,
      session,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      lastActivity: now,
      tokenExpiresAt: session.expires_at ? session.expires_at * 1000 : null
    }));

    // Store tokens securely in Tauri and session store
    try {
      await sessionStore.setAuthenticated(user, session);
    } catch (error) {
      throw new Error(`Database error saving new user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Wait a moment for session store to be fully written
    await new Promise(resolve => setTimeout(resolve, 100));

    // Initialize user store with authenticated user
    try {
      await userStore.initialize(user.id);
    } catch (error) {
      // For new users, this is expected - they don't have database records yet
      // Don't fail authentication if user store initialization fails
    }

    // Load user profile data
    try {
      await this.refreshProfile();
    } catch (error) {
      // Don't fail authentication if profile loading fails
      // This is expected for new users who haven't created a profile yet
    }

    // Start background IAP sync after authentication
    this.startBackgroundIAPSync(user.id);

    // Start token refresh monitoring
    this.scheduleTokenRefresh();
  }

  /**
   * Set unauthenticated state
   */
  private async setUnauthenticated(error?: string): Promise<void> {
    // Clear timers
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.iapSyncTimer) {
      clearTimeout(this.iapSyncTimer);
      this.iapSyncTimer = null;
    }

    // Reset user store
    try {
      userStore.reset();
    } catch (error) {
    }

    this.store.update(state => ({
      ...state,
      user: null,
      session: null,
      isAuthenticated: false,
      isLoading: false,
      error: error || null,
      profile: null,
      profileLoaded: false,
      lastActivity: null,
      tokenExpiresAt: null
    }));

    // Clear session store
    await sessionStore.setUnauthenticated(error);
  }

  /**
   * Schedule token refresh
   */
  private scheduleTokenRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const state = get(this.store);
    if (!state.tokenExpiresAt) return;

    // Refresh 5 minutes before expiry
    const refreshTime = state.tokenExpiresAt - Date.now() - (5 * 60 * 1000);

    if (refreshTime > 0) {
      this.refreshTimer = setTimeout(() => {
        this.refreshSession().catch(() => {});
      }, refreshTime);
    }
  }

  /**
   * Handle user sign up with email and password
   */
  async handleSignUp(email: string, password: string): Promise<void> {
    // loadingActions.showAuth('Creating your account...');
    this.store.update(state => ({ ...state, isLoading: true, error: null }));

    try {
      // Direct Supabase auth
      const supabaseClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      );
      
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
      });
      
      if (error) {
        throw new Error(error.message);
      }
      
      if (data.user && data.session) {
        await this.setAuthenticated(data.user, data.session);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sign up failed';
      this.store.update(state => ({
        ...state,
        error: errorMessage,
        isLoading: false
      }));
      throw error;
    } finally {
      this.store.update(state => ({ ...state, isLoading: false }));
    }
  }

  /**
   * Handle user login with email and password
   */
  async handleLogin(email: string, password: string): Promise<void> {
    // loadingActions.showAuth('Signing you in...');
    this.store.update(state => ({ ...state, isLoading: true, error: null }));

    try {
      // Direct Supabase auth
      const supabaseClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      );
      
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) {
        throw new Error(error.message);
      }
      
      if (data.user && data.session) {
        await this.setAuthenticated(data.user, data.session);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      this.store.update(state => ({
        ...state,
        error: errorMessage,
        isLoading: false
      }));
      throw error;
    } finally {
      this.store.update(state => ({ ...state, isLoading: false }));
    }
  }

  /**
   * Handle user logout
   */
  async handleLogout(): Promise<void> {
    // loadingActions.showAuth('Signing you out...');

    try {
      // Direct Supabase signout
      const supabaseClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      );
      
      await supabaseClient.auth.signOut();
      await sessionStore.setUnauthenticated();
    } catch (error) {
      // Force clear session even if Supabase signout fails
      try {
        await this.setUnauthenticated(
          error instanceof Error ? error.message : 'Logout failed'
        );
      } catch (sessionError) {
        // Last resort: manually clear Supabase session
        const fallbackClient = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_ANON_KEY
        );
        await fallbackClient.auth.signOut({ scope: 'local' });
      }
    } finally {
      this.store.update(state => ({ ...state, isLoading: false }));
    }
  }

  /**
   * Refresh session
   */
  async refreshSession(): Promise<void> {
    try {
      const { data, error } = await supabase.auth.refreshSession();

      if (error) {
        throw new Error(error.message);
      }

      if (data.session && data.user) {
        await this.setAuthenticated(data.user, data.session);
      }
    } catch (error) {
      // If refresh fails, logout
      await this.handleLogout();
      throw error;
    }
  }

  /**
   * Refresh user profile
   */
  async refreshProfile(): Promise<void> {
    const state = get(this.store);

    if (!state.isAuthenticated || !state.user?.id) {
      return;
    }

    try {
      const profile = await dataActions.getUserProfile(state.user.id, true); // Force refresh

      this.store.update(s => ({ ...s, profile, profileLoaded: true }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle onboarding completion
   */
  async completeOnboarding(): Promise<void> {
    await this.refreshProfile();
  }

  /**
   * Get current auth state
   */
  async getState(): Promise<UnifiedAuthState> {
    return get(this.store);
  }

  /**
   * Clear any errors
   */
  clearError(): void {
    this.store.update(state => ({ ...state, error: null }));
  }

  /**
   * Clear error (alias for legacy compatibility)
   */
  async clearErrorAsync(): Promise<void> {
    this.clearError();
  }

  /**
   * Get current user (for legacy compatibility)
   */
  getCurrentUser() {
    return supabase.auth.getUser();
  }

  /**
   * Legacy compatibility methods
   */
  async login(email: string, password: string): Promise<void> {
    return this.handleLogin(email, password);
  }

  async signUp(email: string, password: string): Promise<void> {
    return this.handleSignUp(email, password);
  }

  async logout(): Promise<void> {
    return this.handleLogout();
  }

  /**
   * Force re-initialization (for development/debugging)
   */
  async reinitialize(): Promise<InitializationResult> {
    this.store.update(state => ({
      ...state,
      isInitialized: false,
      isLoading: true,
      error: null
    }));

    return this.initialize();
  }

  /**
   * Start background IAP synchronization
   */
  private startBackgroundIAPSync(userId: string): void {
    // Clear existing timer
    if (this.iapSyncTimer) {
      clearTimeout(this.iapSyncTimer);
    }

    // Initial sync after 10 seconds to allow IAP store to initialize
    setTimeout(async () => {
      try {
        await syncSubscriptionsWithIAP(userId);
      } catch (error) {
      }
    }, 10000);

    // Set up periodic sync every 3 minutes
    const syncInterval = () => {
      this.iapSyncTimer = setTimeout(async () => {
        try {
          await syncSubscriptionsWithIAP(userId);
        } catch (error) {
        }
        // Schedule next sync
        syncInterval();
      }, 3 * 60 * 1000); // 3 minutes
    };

    // Start the interval
    syncInterval();
  }

  /**
   * Destroy store and cleanup
   */
  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.iapSyncTimer) {
      clearTimeout(this.iapSyncTimer);
      this.iapSyncTimer = null;
    }
  }
}

// Create and export the unified auth store
export const authStore = new UnifiedAuthStore();

// Export as centralizedAuth for backward compatibility
export const centralizedAuth = authStore;

// Export types
export type { UnifiedAuthState };
