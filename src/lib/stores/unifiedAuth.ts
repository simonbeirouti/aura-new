import { writable, derived, get } from 'svelte/store';
import { createClient, type AuthSession, type User } from '@supabase/supabase-js';
import { goto } from '$app/navigation';
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
      // Only show app if:
      // 1. User is authenticated
      // 2. Profile loading is complete (profileLoaded: true)
      // 3. Profile exists and onboarding is complete
      // 4. System is fully initialized
      const isAuthenticated = $state.isAuthenticated;
      const profileLoaded = $state.profileLoaded;
      const profile = $state.profile;
      const isInitialized = $state.isInitialized;

      const result = isAuthenticated && profileLoaded && profile && profile.onboarding_complete;

      // Don't show app until everything is fully initialized
      if (!isInitialized) {
        return false;
      }

      // Only show app if authenticated, profile loaded, and onboarding complete
      return result;
    }
  );

  readonly shouldShowOnboarding = derived(
    this.store,
    $state => {
      // Only show onboarding if:
      // 1. User is authenticated
      // 2. Profile loading is complete (profileLoaded: true)
      // 3. Profile either doesn't exist or onboarding is not complete
      // 4. We have waited long enough to ensure stable state (prevent flash)
      const isAuthenticated = $state.isAuthenticated;
      const profileLoaded = $state.profileLoaded;
      const profile = $state.profile;
      const isInitialized = $state.isInitialized;

      const result = isAuthenticated && profileLoaded && (!profile || !profile.onboarding_complete);

      // Don't show onboarding until everything is fully initialized
      if (!isInitialized) {
        return false;
      }

      // If profile is still loading, don't show onboarding yet to prevent flash
      if (isAuthenticated && !profileLoaded) {
        return false;
      }

      // Only show onboarding if authenticated, profile loaded, and onboarding not complete
      return result;
    }
  );

  readonly shouldShowLogin = derived(
    this.store,
    $state => !$state.isAuthenticated && ($state.isInitialized || $state.isLoading)
  );

  /**
   * Initialize the entire application authentication and data layer
   */
  async initialize(): Promise<InitializationResult> {
    console.log('🚀 Starting app initialization...');

    // Check if we're already in a logged-out state (isInitialized: true, isAuthenticated: false)
    // This prevents re-initialization after logout
    const currentState = get(this.store);
    if (currentState.isInitialized && !currentState.isAuthenticated && !currentState.isLoading) {
      console.log('ℹ️ Already in logged-out state, skipping full initialization');
      return {
        authReady: false,
        profileReady: false,
        stripeReady: false,
        errors: []
      };
    }

    // Force reset to unauthenticated state on app restart to ensure clean slate
    // This prevents cached authentication state from persisting across app restarts
    console.log('🔄 Force resetting to unauthenticated state...');
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
      // Step 1: Initialize core systems
      console.log('🔄 Initializing core systems...');
      await storeManager.initialize();
      console.log('✅ Core systems initialized');

      // Step 2: Initialize authentication (this will check for valid stored tokens)
      console.log('🔄 Initializing authentication...');
      const authSuccess = await this.initializeAuth();
      result.authReady = authSuccess;

      // Step 3: Additional validation - double-check if we're really authenticated
      const currentState = get(this.store);
      if (currentState.isAuthenticated && currentState.user) {
        console.log('🔄 User appears authenticated, validating session...');

        try {
          // Try to get a fresh session from Supabase to validate
          const { data: { session }, error } = await supabase.auth.getSession();

          if (error || !session || !session.user) {
            console.log('⚠️ Session validation failed, forcing unauthenticated state');
            await this.setUnauthenticated('Session expired or invalid');
            result.authReady = false;
          } else {
            console.log('✅ Session validated successfully');
          }
        } catch (validationError) {
          console.log('⚠️ Session validation error, forcing unauthenticated state:', validationError);
          await this.setUnauthenticated('Session validation failed');
          result.authReady = false;
        }
      }

      // Step 4: Load profile if still authenticated after validation
      const stateAfterValidation = get(this.store);
      if (stateAfterValidation.isAuthenticated && stateAfterValidation.user) {
        console.log('🔄 Loading user profile...');
        try {
          await dataActions.initialize();
          const profile = await dataActions.getUserProfile(stateAfterValidation.user.id, false);

          this.store.update(s => ({
            ...s,
            profile,
            profileLoaded: true,
            onboardingCompleted: profile?.onboarding_complete || false
          }));
          result.profileReady = !!profile;
          console.log('✅ Profile loaded successfully');
        } catch (error) {
          console.error('❌ Failed to load profile:', error);
          result.errors.push(`Failed to load profile: ${error instanceof Error ? error.message : String(error)}`);
          this.store.update(s => ({ ...s, profileLoaded: true })); // Mark as loaded even if failed
        }
      } else {
        console.log('ℹ️ No authenticated user, skipping profile load');
        this.store.update(s => ({ ...s, profileLoaded: true })); // No user, so profile is "loaded"
      }

      // Step 5: Wait a moment for all async operations to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      // Step 6: Mark as initialized
      this.store.update(state => ({
        ...state,
        isInitialized: true,
        isLoading: false
      }));
      console.log('✅ App initialization completed successfully');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ App initialization failed:', error);
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
    console.log('🚪 Starting logout process...');

    // Always force complete logout regardless of errors
    try {
      // Step 1: Clear Supabase session
      console.log('🔄 Clearing Supabase session...');
      const supabaseClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      );

      // Try both global and local signout
      await Promise.allSettled([
        supabaseClient.auth.signOut(),
        supabaseClient.auth.signOut({ scope: 'local' })
      ]);
      console.log('✅ Supabase session cleared');
    } catch (error) {
      console.warn('⚠️ Supabase session cleanup failed:', error);
    }

    try {
      // Step 2: Clear session store and stored tokens
      console.log('🔄 Clearing session store and stored tokens...');
      await sessionStore.setUnauthenticated();

      // Force clear all stored tokens from Tauri secure storage
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('logout');
        console.log('✅ Tauri stored tokens cleared');
      } catch (tokenError) {
        console.warn('⚠️ Failed to clear Tauri tokens:', tokenError);
      }

      // Also clear any session data from regular Tauri store
      try {
        // Try to clear the Tauri store if available
        // Note: This might not be available in all environments
        console.log('ℹ️ Attempting to clear Tauri session store (may not be available)');
      } catch (storeError) {
        console.warn('⚠️ Failed to clear Tauri session store:', storeError);
      }

      console.log('✅ Session store cleared');
    } catch (error) {
      console.warn('⚠️ Session store cleanup failed:', error);
    }

    // Step 3: Clear all caches before resetting auth state
    await this.clearAllCaches();

    // Step 4: Reset all user-related stores
    await this.resetAllStores();

    // Step 5: Force clear all auth state (always runs)
    console.log('🔄 Force clearing all auth state...');
    await this.setUnauthenticated();
    console.log('✅ Auth state cleared');

    // Step 6: Force reset the entire auth store to initial state
    console.log('🔄 Resetting auth store to initial state...');
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
    console.log('✅ Auth store reset to initial state');

    // Step 7: Navigate to root and final cleanup
    try {
      await goto('/');
      console.log('✅ Navigation to root completed');
    } catch (error) {
      console.warn('⚠️ Navigation failed:', error);
    }

    console.log('🎉 Logout process completed successfully');
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
      // Even on failure, mark profile as loaded to prevent UI getting stuck
      this.store.update(s => ({ ...s, profileLoaded: true }));
      throw error;
    }
  }

  /**
   * Handle onboarding completion
   */
  async completeOnboarding(): Promise<void> {
    // Mark onboarding as completed in the store
    this.store.update(state => ({ ...state, onboardingCompleted: true }));
    await this.refreshProfile();
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
      console.log('🔄 Clearing all caches during logout...');

      // Clear cache manager
      const { cacheManager } = await import('./cacheManager');
      cacheManager.clear();
      console.log('✅ Cache manager cleared');

      // Clear any persistent store data
      const { storeManager } = await import('./core/storeManager');
      await storeManager.saveAll();
      console.log('✅ Store manager data saved/cleared');

      // Clear biometric store
      const { biometricActions } = await import('./biometricStore');
      biometricActions.reset();
      console.log('✅ Biometric store reset');

      // Clear user store
      const { userStore } = await import('./userStore');
      userStore.reset();
      console.log('✅ User store reset');

      // Clear purchase store
      const { purchaseManager } = await import('./purchaseStore');
      // Clear profile cache in settings store
      const { settingsActions } = await import('./settingsStore');
      await settingsActions.clearCache();
      console.log('✅ Settings store cache cleared');

      // Clear IAP store
      const { iapStore } = await import('./iapStore');
      iapStore.reset();
      console.log('✅ IAP store reset');

      // Clear data store
      const { dataStore } = await import('./dataStore');
      dataStore.reset();
      console.log('✅ Data store reset');

      console.log('🎉 All caches cleared successfully during logout');
    } catch (error) {
      console.warn('❌ Some caches may not have been cleared during logout:', error);
    }
  }

  /**
   * Reset all stores on logout
   */
  private async resetAllStores(): Promise<void> {
    try {
      console.log('🔄 Resetting all stores during logout...');

      // Reset user store
      const { userStore } = await import('./userStore');
      userStore.reset();
      console.log('✅ User store reset');

      // Reset purchase store
      const { purchaseManager } = await import('./purchaseStore');
      (purchaseManager as any).reset?.();
      console.log('✅ Purchase store reset');

      // Reset IAP store
      const { iapStore } = await import('./iapStore');
      iapStore.reset();
      console.log('✅ IAP store reset');

      // Reset data store
      const { dataStore } = await import('./dataStore');
      dataStore.reset();
      console.log('✅ Data store reset');

      // Reset loading store
      const { loadingStore } = await import('./loadingStore');
      loadingStore.clear();
      console.log('✅ Loading store cleared');

      console.log('🎉 All stores reset successfully during logout');
    } catch (error) {
      console.warn('❌ Some stores may not have been reset during logout:', error);
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
  }
}

// Create and export the unified auth store
export const authStore = new UnifiedAuthStore();

// Export as centralizedAuth for backward compatibility
export const centralizedAuth = authStore;

// Export types
export type { UnifiedAuthState };