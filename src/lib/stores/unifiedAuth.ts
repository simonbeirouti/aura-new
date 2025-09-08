import { writable, derived, get } from 'svelte/store';
import { createClient, type AuthSession, type User } from '@supabase/supabase-js';
import { goto } from '$app/navigation';
import { sessionStore } from './sessionStore';
import { dataActions, dataStore } from './dataStore';
import { storeManager } from './core/storeManager';
import { userStore } from './userStore';
import { loadingStore } from './loadingStore';
import { syncSubscriptionsWithIAP } from '$lib/utils/iapDatabase';

// Supabase client setup with better error handling
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Create a safe Supabase client that won't crash on missing env vars
let supabase: any;
try {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Please check your .env file and ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.'
    );
  }

  supabase = createClient(supabaseUrl, supabaseAnonKey);
} catch (error) {

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

  // Onboarding state
  onboardingCompleted: boolean;
  currentOnboardingStep: number;

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
  onboardingCompleted: false,
  currentOnboardingStep: 1,
  stripeInitialized: false,
  lastActivity: null,
  tokenExpiresAt: null
};

// Unified Authentication Store
class UnifiedAuthStore {
  private store = writable<UnifiedAuthState>(initialState);
  private refreshTimer: NodeJS.Timeout | null = null;
  private iapSyncTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private lifecycleListenersAdded = false;

  // Store subscription
  subscribe = this.store.subscribe;

  // Derived states for UI logic
  readonly isReady = derived(
    this.store,
    $state => $state.isInitialized && !$state.isLoading
  );

  // Initialize app lifecycle management
  private lifecycleInitialized = (() => {
    this.initializeAppLifecycle();
    return true;
  })();


  /**
   * Initialize the entire application authentication and data layer
   */
  async initialize(): Promise<InitializationResult> {
    const startTime = Date.now();

    // Check if we're already in a logged-out state (isInitialized: true, isAuthenticated: false)
    // This prevents re-initialization after logout
    const currentState = get(this.store);

    if (currentState.isInitialized && !currentState.isAuthenticated && !currentState.isLoading) {
      return {
        authReady: false,
        profileReady: false,
        stripeReady: false,
        errors: []
      };
    }

    // Force reset to unauthenticated state on app restart to ensure clean slate
    // This prevents cached authentication state from persisting across app restarts
    this.store.set({
      isInitialized: false,
      isAuthenticated: false,
      user: null,
      session: null,
      isLoading: true,
      error: null,
      profile: null,
      profileLoaded: false,
      onboardingCompleted: false,
      currentOnboardingStep: 1,
      stripeInitialized: false,
      lastActivity: null,
      tokenExpiresAt: null
    });

    const result: InitializationResult = {
      authReady: false,
      profileReady: false,
      stripeReady: false,
      errors: []
    };

    try {
      // Step 0: Clear any stale cache data first
      await this.clearStaleCacheData();

      // Step 1: Initialize core systems
      await storeManager.initialize();

      // Step 2: Initialize authentication with enhanced validation
      const authSuccess = await this.initializeAuth();
      result.authReady = authSuccess;

      // Step 3: Additional validation - double-check if we're really authenticated
      // Re-enabled with better timing and error handling
      const currentState = get(this.store);

      if (currentState.isAuthenticated && currentState.user) {
        // Add delay to allow Supabase session to fully establish
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
          // Try to get a fresh session from Supabase to validate
          const { data: { session }, error } = await supabase.auth.getSession();

          if (error || !session || !session.user) {
            console.warn('Session validation failed:', error?.message || 'No session');
            // Wait and retry once
            await new Promise(resolve => setTimeout(resolve, 2000));
            const { data: { session: retrySession }, error: retryError } = await supabase.auth.getSession();

            if (retryError || !retrySession || !retrySession.user) {
              console.error('Session validation failed on retry, resetting authentication');
              await this.setUnauthenticated('Session validation failed after retry');
              result.authReady = false;
            }
          } else {
            // Validate that the session user matches our stored user
            if (session.user.id !== currentState.user.id) {
              console.warn('Session user mismatch, resetting authentication');
              await this.setUnauthenticated('Session user mismatch');
              result.authReady = false;
            }
          }
        } catch (validationError) {
          console.error('Session validation error:', validationError);
          // Don't reset authentication on network/timing errors
          console.warn('Session validation failed due to error, but keeping authentication state');
          // result.authReady remains true from initializeAuth success
        }
      }

      // Step 4: Load profile if authenticated
      const profileState = get(this.store);
      if (profileState.isAuthenticated && profileState.user) {
        try {
          await dataActions.initialize();

          // First try without cache to get fresh data
          let profile = await dataActions.getUserProfile(profileState.user.id, false);

          // If that fails, try with cache (might have stale data)
          if (!profile) {
            profile = await dataActions.getUserProfile(profileState.user.id, true);
          }

          // If we still don't have a profile, try one more time with force refresh
          if (!profile) {
            try {
              profile = await dataActions.getUserProfile(profileState.user.id, false);
            } catch (refreshError) {
              // Continue silently on profile refresh error
            }
          }

          this.store.update(s => ({
            ...s,
            profile,
            profileLoaded: true,
            onboardingCompleted: profile?.onboarding_complete || false
          }));
          result.profileReady = !!profile;
        } catch (error) {
          result.errors.push(`Failed to load profile: ${error instanceof Error ? error.message : String(error)}`);
          // Mark as loaded even if failed to prevent infinite loading
          this.store.update(s => ({
            ...s,
            profileLoaded: true,
            profile: null, // Ensure profile is null on failure
            error: error instanceof Error ? error.message : 'Profile load failed'
          }));
        }
      } else {
        this.store.update(s => ({ ...s, profileLoaded: true })); // No user, so profile is "loaded"
      }

      // Step 4.5: Initialize settings store and load products if authenticated
      const finalState = get(this.store);
      if (finalState.isAuthenticated && finalState.user) {
        try {
          const { settingsActions } = await import('./settingsStore');
          await settingsActions.initialize();
        } catch (error) {
          result.errors.push(`Failed to initialize settings: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Load products during initialization
        try {
          const { purchaseManager } = await import('./purchaseStore');
          await purchaseManager.loadProducts(false, false); // Don't force refresh, don't show toast on error during init
        } catch (error) {
          result.errors.push(`Failed to load products: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Preload user token balance for better performance
        try {
          const { userStore } = await import('./userStore');
          await userStore.refreshTokenBalance();
        } catch (error) {
          // Non-critical, continue
        }

        // Warm up IAP store if available
        try {
          const { iapStore } = await import('./iapStore');
          const iapState = get(iapStore);
          if (iapState.canMakePayments && !iapState.isInitialized) {
            await iapStore.initialize();
          }
        } catch (error) {
          // Non-critical, continue
        }
      }

      // Step 5: Wait a moment for all async operations to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      // Step 6: Mark as initialized
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
   * Clear stale cache data that might be invalid after app restart or long inactivity
   */
  private async clearStaleCacheData(): Promise<void> {
    try {
      // Import cache manager dynamically to avoid circular dependencies
      const { cacheManager } = await import('./cacheManager');

      const now = Date.now();
      const cacheStats = cacheManager.getStats();
      const lastCacheUpdate = cacheStats.lastCleanup;

      // Only clear cache if it's older than 2 hours AND the app has been inactive for more than 30 minutes
      // This prevents clearing cache on quick app restarts
      const twoHoursAgo = now - (2 * 60 * 60 * 1000); // 2 hours
      const thirtyMinutesAgo = now - (30 * 60 * 1000); // 30 minutes

      // Check if we have a recent activity timestamp
      const state = get(this.store);
      const lastActivity = state.lastActivity || 0;

      // Only clear if both conditions are met:
      // 1. Cache is older than 2 hours
      // 2. App has been inactive for more than 30 minutes (to avoid clearing on quick restarts)
      if (lastCacheUpdate < twoHoursAgo && lastActivity < thirtyMinutesAgo) {
        cacheManager.clear();
      }

      // Clear only expired entries instead of full cache clear for more targeted cleanup
      // This preserves valid cache entries while removing only truly stale data
      try {
        // Note: This would be implemented in the cache manager itself
        // For now, we rely on the time-based checks above
      } catch (selectiveClearError) {
        console.warn('Selective cache cleanup failed, continuing with existing cache:', selectiveClearError);
      }

    } catch (error) {
      console.warn('Failed to clear stale cache data:', error);
      // Don't fail initialization if cache cleanup fails
    }
  }

  /**
   * Initialize authentication layer with enhanced session validation
   */
  private async initializeAuth(): Promise<boolean> {
    try {
      // Load session data from persistent store
      await sessionStore.load();

      // Check if we have valid stored session with timeout
      const sessionCheckPromise = sessionStore.hasValidSession();
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Session check timeout')), 5000)
      );

      let hasValidSession = false;
      try {
        hasValidSession = await Promise.race([sessionCheckPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.warn('Session check timed out, proceeding with fresh validation');
        hasValidSession = false;
      }

      if (hasValidSession) {
        // Try to restore session from stored tokens with enhanced validation
        const tokens = await sessionStore.getStoredTokens();
        if (tokens) {
          // Check if we have a recent session state with valid expiry
          const currentState = get(this.store);
          const now = Date.now();
          const tokenExpiryBuffer = 5 * 60 * 1000; // 5 minutes buffer

          // Check if tokens are close to expiry (if we have expiry info)
          const hasValidExpiry = currentState.tokenExpiresAt && currentState.tokenExpiresAt > (now + tokenExpiryBuffer);

          if (tokens.refreshToken && (!currentState.tokenExpiresAt || hasValidExpiry)) {
            try {
              // Use the centralized Supabase client
              if (!supabaseUrl || !supabaseAnonKey) {
                throw new Error('Missing Supabase configuration');
              }

              // Set the session using stored tokens
              const { data, error } = await supabase.auth.setSession({
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken
              });

              if (!error && data.session) {
                await this.setAuthenticated(data.session.user, data.session);
                return true;
              } else {
                console.warn('Failed to restore session with stored tokens:', error);
              }
            } catch (restoreError) {
              console.warn('Session restoration failed:', restoreError);
            }
          }
        } else {
          console.warn('No stored tokens found despite valid session check');
        }
      }

      // Fallback: Check current Supabase session (fresh validation)
      // Only check this if we didn't successfully restore from stored tokens above
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.warn('Supabase session check failed:', sessionError);
      }

      if (currentSession && currentSession.user) {
        // Validate session is not expired
        const now = Date.now();
        const sessionExpiry = currentSession.expires_at ? currentSession.expires_at * 1000 : null;

        if (!sessionExpiry || sessionExpiry > now) {
          await this.setAuthenticated(currentSession.user, currentSession);
          return true;
        }
      }

      // No valid session found anywhere
      await this.setUnauthenticated();
      return false; // Return false to indicate no authentication was established

    } catch (error) {
      console.error('Authentication initialization failed:', error);
      await this.setUnauthenticated(
        error instanceof Error ? error.message : 'Authentication failed'
      );
      return false; // Return false to indicate authentication failed
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

    // Wait longer for session store to be fully written and profile to load
    await new Promise(resolve => setTimeout(resolve, 200));

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

      // After profile refresh, check if onboarding is completed
      const state = get(this.store);
      if (state.profile && state.profile.onboarding_complete) {
        this.store.update(s => ({ ...s, onboardingCompleted: true }));
      }
    } catch (error) {
      // Don't fail authentication if profile loading fails
      // This is expected for new users who haven't created a profile yet
      // But we still need to mark profile as loaded to prevent inconsistent state
      this.store.update(s => ({ ...s, profileLoaded: true }));
    }

    // Start background IAP sync after authentication
    this.startBackgroundIAPSync(user.id);

    // Start token refresh monitoring
    this.scheduleTokenRefresh();

    // Start health check monitoring with safeguards
    this.startHealthCheck();
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
      onboardingCompleted: false,
      currentOnboardingStep: 1,
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
      // Use centralized Supabase client
      const { data, error } = await supabase.auth.signUp({
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
      // Use centralized Supabase client
      const { data, error } = await supabase.auth.signInWithPassword({
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
    // Always force complete logout regardless of errors
    try {
      // Step 1: Clear Supabase session using centralized client
      // Try both global and local signout
      await Promise.allSettled([
        supabase.auth.signOut(),
        supabase.auth.signOut({ scope: 'local' })
      ]);
    } catch (error) {
      // Continue with logout process even if Supabase cleanup fails
    }

    try {
      // Step 2: Clear session store and stored tokens
      await sessionStore.setUnauthenticated();

      // Force clear all stored tokens from Tauri secure storage
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('logout');
      } catch (tokenError) {
        // Continue even if Tauri token cleanup fails
      }

      // Also clear any session data from regular Tauri store
      try {
        // Try to clear the Tauri store if available
        // Note: This might not be available in all environments
      } catch (storeError) {
        // Continue even if Tauri store cleanup fails
      }
    } catch (error) {
      // Continue with logout process even if session cleanup fails
    }

    // Step 3: Clear all caches before resetting auth state
    await this.clearAllCaches();

    // Step 4: Reset all user-related stores
    await this.resetAllStores();

    // Step 5: Force clear all auth state (always runs)
    await this.setUnauthenticated();

    // Step 6: Force reset the entire auth store to initial state
    this.store.set({
      isInitialized: true, // Set to true so shouldShowLogin derived store returns true
      isAuthenticated: false,
      user: null,
      session: null,
      isLoading: false,
      error: null,
      profile: null,
      profileLoaded: false,
      onboardingCompleted: false,
      currentOnboardingStep: 1,
      stripeInitialized: false,
      lastActivity: null,
      tokenExpiresAt: null
    });

    // Step 7: Navigate to root and final cleanup
    try {
      await goto('/');
    } catch (error) {
      // Continue even if navigation fails
    }
  }

  /**
   * Refresh session (aggressive - use gentleSessionRefresh for health checks)
   */
  async refreshSession(): Promise<void> {
    try {
      const { data, error } = await supabase.auth.refreshSession();

      if (error) {
        console.warn('❌ Session refresh failed:', error.message);
        throw new Error(error.message);
      }

      if (data.session && data.user) {
        await this.setAuthenticated(data.user, data.session);
      } else {
        console.warn('❌ Session refresh returned no session');
        throw new Error('No session returned from refresh');
      }
    } catch (error) {
      console.error('❌ Session refresh error, logging out:', error);
      // If refresh fails, logout - but this should be used carefully
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
      const profile = await dataActions.getUserProfile(state.user.id, false); // Force refresh from database

      this.store.update(s => ({
        ...s,
        profile,
        profileLoaded: true,
        onboardingCompleted: profile?.onboarding_complete || false
      }));
    } catch (error) {
      console.warn('Profile refresh failed:', error);
      // Even on failure, mark profile as loaded to prevent UI getting stuck
      // But don't update the profile data to avoid overwriting valid cached data
      this.store.update(s => ({ ...s, profileLoaded: true }));
      throw error;
    }
  }

  /**
   * Handle onboarding completion
   */
  async completeOnboarding(): Promise<void> {
    // Mark onboarding as completed in the store
    this.store.update(state => ({
      ...state,
      onboardingCompleted: true,
      // Also update the profile onboarding_complete field if it exists
      profile: state.profile ? { ...state.profile, onboarding_complete: true } : state.profile
    }));

    // Wait a bit for database changes to be committed before refreshing
    await new Promise(resolve => setTimeout(resolve, 500));

    // Refresh profile from database to get updated onboarding_complete field
    try {
      await this.refreshProfile();
    } catch (error) {
      console.warn('Profile refresh failed after onboarding completion, but continuing:', error);
    }
  }

  /**
   * Check if onboarding is completed
   */
  isOnboardingCompleted(): boolean {
    return get(this.store).onboardingCompleted;
  }

  /**
   * Mark onboarding as completed
   */
  markOnboardingCompleted(): void {
    this.store.update(state => ({ ...state, onboardingCompleted: true }));
  }

  /**
   * Get current onboarding step
   */
  getCurrentOnboardingStep(): number {
    return get(this.store).currentOnboardingStep;
  }

  /**
   * Set current onboarding step
   */
  setCurrentOnboardingStep(step: number): void {
    this.store.update(state => ({ ...state, currentOnboardingStep: step }));
  }

  /**
   * Reset onboarding completion state
   */
  resetOnboardingState(): void {
    this.store.update(state => ({
      ...state,
      onboardingCompleted: false,
      currentOnboardingStep: 1
    }));
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
   * Public getter for the store (needed for derived stores)
   */
  getStore() {
    return this.store;
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
   * Clear all caches on logout
   */
  private async clearAllCaches(): Promise<void> {
    try {
      // Clear cache manager with user-specific invalidation
      const { cacheManager } = await import('./cacheManager');
      const state = get(this.store);
      if (state.user?.id) {
        cacheManager.invalidateUserCache(state.user.id);
      }
      // Clear remaining cache
      cacheManager.clear();

      // Clear any persistent store data
      await storeManager.saveAll();

      // Clear biometric store
      const { biometricActions } = await import('./biometricStore');
      biometricActions.reset();

      // Clear user store
      await userStore.reset();

      // Clear purchase store
      const { purchaseManager } = await import('./purchaseStore');
      // Clear profile cache in settings store
      const { settingsActions } = await import('./settingsStore');
      await settingsActions.clearCache();

      // Clear IAP store
      const { iapStore } = await import('./iapStore');
      iapStore.reset();

      // Clear data store
      dataStore.reset();

    } catch (error) {
      console.warn('Some caches failed to clear:', error);
      // Continue with logout even if some caches fail to clear
    }
  }

  /**
   * Reset all stores on logout
   */
  private async resetAllStores(): Promise<void> {
    try {
      // Reset user store
      userStore.reset();

      // Reset purchase store
      const { purchaseManager } = await import('./purchaseStore');
      (purchaseManager as any).reset?.();

      // Reset IAP store
      const { iapStore } = await import('./iapStore');
      iapStore.reset();

      // Reset data store
      dataStore.reset();

      // Reset loading store
      loadingStore.clear();
    } catch (error) {
      // Continue with logout even if some stores fail to reset
    }
  }

  /**
   * Start periodic health check for session and cache validity
   */
  private startHealthCheck(): void {
    // Clear existing timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Run health check every 30 minutes (reduced frequency significantly)
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, 30 * 60 * 1000); // 30 minutes

    // Run first health check after 10 minutes (delayed start to allow app to fully initialize)
    setTimeout(async () => {
      await this.performHealthCheck();
    }, 10 * 60 * 1000); // 10 minutes
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<void> {
    const state = get(this.store);

    // Skip health check if not authenticated or recently authenticated (within 5 minutes)
    if (!state.isAuthenticated || !state.user) {
      return;
    }

    // Skip health check if authentication was established very recently (within 5 minutes)
    // This prevents interference with fresh authentication
    const now = Date.now();
    const authAge = now - (state.lastActivity || 0);
    const minAuthAge = 5 * 60 * 1000; // 5 minutes

    if (authAge < minAuthAge) {
      return;
    }

    // Skip health check if app is not visible (user might be away)
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }

    // Skip health check if there are active loading operations
    if (state.isLoading) {
      return;
    }

    // Skip health check if app has been inactive for more than 1 hour
    // (user probably closed the app or is away)
    const oneHour = 60 * 60 * 1000;
    if (state.lastActivity && (now - state.lastActivity) > oneHour) {
      return;
    }

    try {
      // Check 1: Session validity (be very gentle - don't refresh on minor issues)
      let sessionValid = true;
      try {
        sessionValid = await sessionStore.hasValidSession();

        // Only attempt refresh if we're confident the session is actually invalid
        // Don't refresh if tokens exist but expiry check fails (could be timezone issue)
        if (!sessionValid) {
          const tokens = await sessionStore.getStoredTokens();
          if (tokens) {
            sessionValid = true; // Consider valid if tokens exist
          } else {
            await this.gentleSessionRefresh();
            return;
          }
        }
      } catch (sessionError) {
        console.warn('⚠️ Session validation error during health check:', sessionError);
        // Don't reset auth on session check errors
      }

      // Check 2: Token expiry (only refresh if clearly needed and safe to do so)
      if (sessionValid) {
        try {
          const needsRefresh = sessionStore.isTokenRefreshNeeded();
          if (needsRefresh) {
            // Only refresh if we're not too close to expiry (avoid unnecessary refreshes)
            const currentState = get(this.store);
            if (currentState.tokenExpiresAt) {
              const timeToExpiry = currentState.tokenExpiresAt - now;
              const safeRefreshWindow = 20 * 60 * 1000; // Increased to 20 minutes

              if (timeToExpiry > safeRefreshWindow) {
              } else {
                await this.gentleSessionRefresh();
                return;
              }
            }
          }
        } catch (tokenError) {
          console.warn('⚠️ Token validation error during health check:', tokenError);
          // Continue with other checks
        }
      }

      // Check 3: Cache validity (clear old cache) - only if session is stable and app is active
      if (sessionValid && !document.hidden) {
        try {
          const { cacheManager } = await import('./cacheManager');
          const lastCleanup = cacheManager.getStats().lastCleanup;
          const now = Date.now();
          const threeHours = 3 * 60 * 60 * 1000; // Increased to 3 hours to reduce frequency

          if (now - lastCleanup > threeHours) {
            cacheManager.clear();
          }
        } catch (cacheError) {
          console.warn('⚠️ Cache cleanup error during health check:', cacheError);
        }
      }

      // Check 4: Profile data freshness (only refresh if onboarding is complete and it's been a while)
      if (state.profileLoaded && state.profile && state.onboardingCompleted && sessionValid && !document.hidden) {
        try {
          const profileAge = now - (state.lastActivity || 0);
          const maxProfileAge = 90 * 60 * 1000; // Increased to 1.5 hours to reduce frequency

          if (profileAge > maxProfileAge) {
            await this.refreshProfile();
          }
        } catch (profileError) {
          console.warn('⚠️ Profile refresh error during health check:', profileError);
        }
      }

    } catch (error) {
      console.warn('⚠️ Health check failed:', error);
      // Don't fail the entire app on health check errors
    }
  }

  /**
   * Gentle session refresh that doesn't reset authentication on failure
   */
  private async gentleSessionRefresh(): Promise<void> {
    try {
      const { data, error } = await supabase.auth.refreshSession();

      if (error) {
        console.warn('⚠️ Gentle session refresh failed:', error.message);
        // Don't reset authentication on refresh failure
        return;
      }

      if (data.session && data.user) {
        await this.setAuthenticated(data.user, data.session);
      } else {
        console.warn('⚠️ Gentle session refresh returned no session');
      }
    } catch (refreshError) {
      console.warn('⚠️ Gentle session refresh error:', refreshError);
      // Don't reset authentication on refresh errors
    }
  }

  /**
   * Initialize app lifecycle management
   */
  private initializeAppLifecycle(): void {
    // Prevent duplicate event listener registration
    if (this.lifecycleListenersAdded || typeof document === 'undefined') {
      return;
    }

    this.lifecycleListenersAdded = true;

    // Handle app visibility changes (foreground/background)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.handleAppForeground();
      } else {
        this.handleAppBackground();
      }
    });

    // Handle page focus/blur events
    window.addEventListener('focus', () => {
      this.handleWindowFocus();
    });

    window.addEventListener('blur', () => {
      this.handleWindowBlur();
    });

    // Handle beforeunload to save state
    window.addEventListener('beforeunload', () => {
      this.handleAppClosing();
    });
  }

  /**
   * Handle app coming to foreground
   */
  private async handleAppForeground(): Promise<void> {
    const state = get(this.store);

    // Only perform validation if we have an authenticated user
    if (state.isAuthenticated && state.user) {
      try {

        // Check if it's been a while since last activity
        const now = Date.now();
        const timeSinceLastActivity = now - (state.lastActivity || 0);
        const fiveMinutes = 5 * 60 * 1000;

        if (timeSinceLastActivity > fiveMinutes) {
          // Perform a gentle session validation
          await this.gentleSessionRefresh();

          // Refresh user balance if available
          try {
            const { userStore } = await import('./userStore');
            await userStore.refreshTokenBalance();
          } catch (error) {
            // Non-critical
          }
        }

        // Update last activity
        this.store.update(s => ({ ...s, lastActivity: now }));

      } catch (error) {
        console.warn('⚠️ Foreground session validation failed:', error);
        // Don't reset auth on foreground validation failure
      }
    }
  }

  /**
   * Handle app going to background
   */
  private handleAppBackground(): void {
    // Clear any pending timers that shouldn't run in background
    // Keep essential timers like health check and token refresh
    const now = Date.now();
    this.store.update(s => ({ ...s, lastActivity: now }));
  }

  /**
   * Handle window focus
   */
  private async handleWindowFocus(): Promise<void> {
    const state = get(this.store);

    // Quick session check on focus if needed
    if (state.isAuthenticated && state.tokenExpiresAt) {
      const now = Date.now();
      const timeToExpiry = state.tokenExpiresAt - now;
      const urgentRefreshThreshold = 2 * 60 * 1000; // 2 minutes

      if (timeToExpiry > 0 && timeToExpiry < urgentRefreshThreshold) {
        await this.gentleSessionRefresh();
      }
    }
  }

  /**
   * Handle window blur
   */
  private handleWindowBlur(): void {
    // Save any pending state changes
    this.store.update(s => ({ ...s, lastActivity: Date.now() }));
  }

  /**
   * Handle app closing
   */
  private async handleAppClosing(): Promise<void> {
    try {
      // Save any pending state
      await storeManager.saveAll();

      // Clear timers
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
      if (this.iapSyncTimer) {
        clearTimeout(this.iapSyncTimer);
        this.iapSyncTimer = null;
      }
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }
    } catch (error) {
      console.warn('Error during app closing cleanup:', error);
    }
  }

  /**
   * Emergency cleanup for background operations
   */
  emergencyCleanup(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.iapSyncTimer) {
      clearTimeout(this.iapSyncTimer);
      this.iapSyncTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Destroy store and cleanup
   */
  destroy(): void {
    this.emergencyCleanup();

    // Remove event listeners if they exist
    if (typeof document !== 'undefined') {
      // Note: We can't remove the listeners here as we don't have references to them
      // They will be cleaned up when the page unloads
    }
  }
}

// Create and export the unified auth store
export const authStore = new UnifiedAuthStore();

// Export as centralizedAuth for backward compatibility
export const centralizedAuth = authStore;

// Export derived stores as separate exports
export const shouldShowApp = derived(authStore.getStore(), $state => {
  // Show app if:
  // 1. User is authenticated
  // 2. Profile loading is complete (profileLoaded: true)
  // 3. Profile exists (regardless of onboarding status)
  // 4. System is fully initialized
  const isAuthenticated = $state.isAuthenticated;
  const profileLoaded = $state.profileLoaded;
  const profile = $state.profile;
  const isInitialized = $state.isInitialized;

  // Show app if authenticated and profile is loaded, regardless of onboarding status
  const result = isAuthenticated && profileLoaded && !!profile && isInitialized;

  // Don't show app until everything is fully initialized
  if (!isInitialized) {
    return false;
  }

  // Show app if authenticated and profile loaded, regardless of onboarding status
  return result;
});

export const shouldShowOnboarding = derived(authStore.getStore(), $state => {
  // Show onboarding if user is authenticated but hasn't completed onboarding
  const isAuthenticated = $state.isAuthenticated;
  const profileLoaded = $state.profileLoaded;
  const profile = $state.profile;
  const isInitialized = $state.isInitialized;

  // Don't show onboarding until system is initialized
  if (!isInitialized) {
    return false;
  }

  // Show onboarding if authenticated and profile is loaded but onboarding not complete
  // Only show onboarding if onboarding_complete is explicitly false (not started) or null/undefined (not set)
  // If it's already true, don't show onboarding
  const shouldShowOnboardingFlow = !profile || profile.onboarding_complete === false || profile.onboarding_complete === null || profile.onboarding_complete === undefined;

  const result = isAuthenticated && profileLoaded && shouldShowOnboardingFlow;

  return result;
});

export const shouldShowLogin = derived(authStore.getStore(), $state => {
  // Show login if not authenticated and system is initialized
  const isAuthenticated = $state.isAuthenticated;
  const isInitialized = $state.isInitialized;

  return !isAuthenticated && isInitialized;
});

// Export types
export type { UnifiedAuthState };