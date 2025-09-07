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

  // Store subscription
  subscribe = this.store.subscribe;

  // Derived states for UI logic
  readonly isReady = derived(
    this.store,
    $state => $state.isInitialized && !$state.isLoading
  );


  /**
   * Initialize the entire application authentication and data layer
   */
  async initialize(): Promise<InitializationResult> {
    const startTime = Date.now();

    // Check if we're already in a logged-out state (isInitialized: true, isAuthenticated: false)
    // This prevents re-initialization after logout
    const currentState = get(this.store);
    console.log('UnifiedAuth initialize - current state:', {
      isInitialized: currentState.isInitialized,
      isAuthenticated: currentState.isAuthenticated,
      isLoading: currentState.isLoading,
      hasUser: !!currentState.user,
      hasSession: !!currentState.session
    });

    if (currentState.isInitialized && !currentState.isAuthenticated && !currentState.isLoading) {
      console.log('Already in logged-out state, skipping initialization');
      return {
        authReady: false,
        profileReady: false,
        stripeReady: false,
        errors: []
      };
    }

    // Force reset to unauthenticated state on app restart to ensure clean slate
    // This prevents cached authentication state from persisting across app restarts
    console.log('Forcing reset to unauthenticated state for clean initialization');
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
      console.log('Step 3 validation - current state:', {
        isAuthenticated: currentState.isAuthenticated,
        hasUser: !!currentState.user,
        hasSession: !!currentState.session
      });

      if (currentState.isAuthenticated && currentState.user) {
        // Add delay to allow Supabase session to fully establish
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
          console.log('Performing additional Supabase session validation...');

          // Try to get a fresh session from Supabase to validate
          const { data: { session }, error } = await supabase.auth.getSession();
          console.log('Supabase session validation result:', {
            hasSession: !!session,
            hasError: !!error,
            sessionUserId: session?.user?.id,
            storedUserId: currentState.user.id
          });

          if (error || !session || !session.user) {
            console.warn('Session validation failed:', error?.message || 'No session');
            // Don't immediately reset authentication - give it another chance
            console.log('Retrying session validation in 2 seconds...');

            // Wait and retry once
            await new Promise(resolve => setTimeout(resolve, 2000));
            const { data: { session: retrySession }, error: retryError } = await supabase.auth.getSession();

            if (retryError || !retrySession || !retrySession.user) {
              console.error('Session validation failed on retry, resetting authentication');
              await this.setUnauthenticated('Session validation failed after retry');
              result.authReady = false;
            } else {
              console.log('Session validation passed on retry');
            }
          } else {
            // Validate that the session user matches our stored user
            if (session.user.id !== currentState.user.id) {
              console.warn('Session user mismatch, resetting authentication');
              await this.setUnauthenticated('Session user mismatch');
              result.authReady = false;
            } else {
              console.log('Session validation passed - user matches');
            }
          }
        } catch (validationError) {
          console.error('Session validation error:', validationError);
          // Don't reset authentication on network/timing errors
          console.warn('Session validation failed due to error, but keeping authentication state');
          // result.authReady remains true from initializeAuth success
        }
      } else {
        console.log('Skipping session validation - not authenticated');
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

      // Clear cache if it's older than 1 hour (app was closed for a while)
      const lastCacheUpdate = cacheManager.getStats().lastCleanup;
      const oneHourAgo = Date.now() - (60 * 60 * 1000);

      if (lastCacheUpdate < oneHourAgo) {
        console.log('Clearing stale cache data due to long inactivity');
        cacheManager.clear();
      }

      // Also clear any user-specific cache that's older than 30 minutes
      // This ensures fresh data after app restart
      const cacheKeys = cacheManager.getStats();
      // Note: We'll implement more sophisticated cache invalidation in the cache manager itself

    } catch (error) {
      console.warn('Failed to clear stale cache data:', error);
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
        console.log('Valid session found, attempting to restore from stored tokens...');
        // Try to restore session from stored tokens with enhanced validation
        const tokens = await sessionStore.getStoredTokens();
        if (tokens) {
          console.log('Tokens retrieved, attempting Supabase session restoration...');
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

              console.log('Setting Supabase session with stored tokens...');
              // Set the session using stored tokens
              const { data, error } = await supabase.auth.setSession({
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken
              });

              if (!error && data.session) {
                console.log('Supabase session restored successfully, setting authenticated state...');
                await this.setAuthenticated(data.session.user, data.session);
                console.log('Authentication state set successfully');
                return true;
              } else {
                console.warn('Failed to restore session with stored tokens:', error);
              }
            } catch (restoreError) {
              console.warn('Session restoration failed:', restoreError);
            }
          } else {
            console.log('Stored tokens are expired or close to expiry');
          }
        } else {
          console.warn('No stored tokens found despite valid session check');
        }
      }

      // Fallback: Check current Supabase session (fresh validation)
      // Only check this if we didn't successfully restore from stored tokens above
      console.log('Checking for existing Supabase session as fallback...');
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.warn('Supabase session check failed:', sessionError);
      }

      if (currentSession && currentSession.user) {
        // Validate session is not expired
        const now = Date.now();
        const sessionExpiry = currentSession.expires_at ? currentSession.expires_at * 1000 : null;

        if (!sessionExpiry || sessionExpiry > now) {
          console.log('Valid Supabase session found via fallback, setting authenticated');
          await this.setAuthenticated(currentSession.user, currentSession);
          return true;
        } else {
          console.log('Supabase session is expired');
        }
      }

      // No valid session found anywhere
      console.log('No valid session found after all checks, setting unauthenticated');
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
    console.log('🔐 Setting authenticated state for user:', user.id);

    const previousState = get(this.store);
    console.log('Previous auth state:', {
      wasAuthenticated: previousState.isAuthenticated,
      hadUser: !!previousState.user,
      hadSession: !!previousState.session
    });

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

    console.log('✅ Authenticated state updated in unifiedAuth store');

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
    console.log('Setting unauthenticated state, error:', error);

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
      console.log('Refreshing profile from database for user:', state.user.id);
      const profile = await dataActions.getUserProfile(state.user.id, false); // Force refresh from database
      console.log('Profile fetched from database:', profile);

      this.store.update(s => ({
        ...s,
        profile,
        profileLoaded: true,
        onboardingCompleted: profile?.onboarding_complete || false
      }));
      console.log('Profile updated in store');
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
    console.log('completeOnboarding called - marking onboarding as completed');
    // Mark onboarding as completed in the store
    this.store.update(state => ({
      ...state,
      onboardingCompleted: true,
      // Also update the profile onboarding_complete field if it exists
      profile: state.profile ? { ...state.profile, onboarding_complete: true } : state.profile
    }));
    console.log('Local onboardingCompleted flag set to true');

    // Wait a bit for database changes to be committed before refreshing
    await new Promise(resolve => setTimeout(resolve, 500));

    // Refresh profile from database to get updated onboarding_complete field
    try {
      await this.refreshProfile();
      console.log('Profile refreshed from database after onboarding completion');
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

      console.log('All caches cleared successfully');
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

    // Run health check every 5 minutes
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, 5 * 60 * 1000); // 5 minutes

    // Also run an immediate health check after 30 seconds
    setTimeout(async () => {
      await this.performHealthCheck();
    }, 30000);
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<void> {
    const state = get(this.store);

    // Skip health check if not authenticated
    if (!state.isAuthenticated || !state.user) {
      return;
    }

    try {
      console.log('🔍 Performing health check...');

      // Check 1: Session validity (be gentle - don't reset auth on single failure)
      try {
        const sessionValid = await sessionStore.hasValidSession();
        if (!sessionValid) {
          console.log('⚠️ Session check failed, attempting refresh...');
          await this.refreshSession();
          return;
        }
      } catch (sessionError) {
        console.warn('⚠️ Session validation error during health check:', sessionError);
        // Don't reset auth on session check errors
      }

      // Check 2: Token expiry (refresh if needed)
      try {
        if (sessionStore.isTokenRefreshNeeded()) {
          console.log('⚠️ Token refresh needed...');
          await this.refreshSession();
          return;
        }
      } catch (tokenError) {
        console.warn('⚠️ Token validation error during health check:', tokenError);
        // Continue with other checks
      }

      // Check 3: Cache validity (clear old cache)
      try {
        const { cacheManager } = await import('./cacheManager');
        const lastCleanup = cacheManager.getStats().lastCleanup;
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        if (now - lastCleanup > oneHour) {
          console.log('🧹 Clearing stale cache...');
          cacheManager.clear();
        }
      } catch (cacheError) {
        console.warn('⚠️ Cache cleanup error during health check:', cacheError);
      }

      // Check 4: Profile data freshness (only refresh if onboarding is complete and it's been a while)
      if (state.profileLoaded && state.profile && state.onboardingCompleted) {
        try {
          const profileAge = Date.now() - (state.lastActivity || 0);
          const maxProfileAge = 30 * 60 * 1000; // 30 minutes

          if (profileAge > maxProfileAge) {
            console.log('📋 Refreshing stale profile data...');
            await this.refreshProfile();
          }
        } catch (profileError) {
          console.warn('⚠️ Profile refresh error during health check:', profileError);
        }
      }

      console.log('✅ Health check completed successfully');

    } catch (error) {
      console.warn('⚠️ Health check failed:', error);
      // Don't fail the entire app on health check errors
    }
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
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
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
    console.log('shouldShowApp: false - system not initialized yet');
    return false;
  }

  // Debug logging with more detail
  if (result) {
    console.log('✅ shouldShowApp: true - isAuthenticated:', isAuthenticated, 'profileLoaded:', profileLoaded, 'hasProfile:', !!profile, 'profile.onboarding_complete:', profile?.onboarding_complete);
  } else {
    console.log('❌ shouldShowApp: false - isAuthenticated:', isAuthenticated, 'profileLoaded:', profileLoaded, 'hasProfile:', !!profile, 'profile.onboarding_complete:', profile?.onboarding_complete, 'isInitialized:', isInitialized);
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

  // Debug logging
  if (result) {
    console.log('shouldShowOnboarding: true - isAuthenticated:', isAuthenticated, 'profileLoaded:', profileLoaded, 'shouldShowOnboardingFlow:', shouldShowOnboardingFlow, 'profile.onboarding_complete:', profile?.onboarding_complete);
  } else {
    console.log('shouldShowOnboarding: false - isAuthenticated:', isAuthenticated, 'profileLoaded:', profileLoaded, 'shouldShowOnboardingFlow:', shouldShowOnboardingFlow, 'profile.onboarding_complete:', profile?.onboarding_complete);
  }

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