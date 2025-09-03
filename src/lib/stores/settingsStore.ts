import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { centralizedAuth } from './unifiedAuth';
import { cacheManager, cacheKeys } from './cacheManager';

// Profile interface (matches SQL schema in migrations/001_initial.sql)
export interface Profile {
  id: string;
  updated_at?: string;
  username?: string;
  onboarding_complete?: boolean;
  notifications?: boolean;
  full_name?: string;
  avatar_url?: string;
}

// Settings store state
interface SettingsState {
  // Profile data
  profile: Profile | null;
  profileLoading: boolean;
  profileError: string | null;

  // Loading coordination
  isInitialized: boolean;
  globalError: string | null;
}

// Initial state
const initialState: SettingsState = {
  profile: null,
  profileLoading: false,
  profileError: null,

  isInitialized: false,
  globalError: null
};

// Create the store
const settingsStore = writable<SettingsState>(initialState);

// Helper function to get current user ID (sync version using store state)
function getCurrentUserId(): string | null {
  let userId: string | null = null;
  const unsubscribe = centralizedAuth.subscribe(auth => {
    userId = auth.user?.id || null;
  });
  unsubscribe();
  return userId;
}

// Settings store actions
export const settingsActions = {
  // Initialize all settings data
  async initialize(): Promise<void> {
    const userId = getCurrentUserId();
    if (!userId) {
      console.warn('Cannot initialize settings: User not authenticated');
      return;
    }

    try {
      // Load profile data
      await this.loadProfile();

      settingsStore.update(s => ({ ...s, isInitialized: true }));
    } catch (error) {
      console.error('Failed to initialize settings:', error);
      settingsStore.update(s => ({
        ...s,
        globalError: 'Failed to initialize settings',
        isInitialized: true // Still mark as initialized to prevent loops
      }));
    }
  },

  // Profile actions
  async loadProfile(forceRefresh = false): Promise<Profile | null> {
    const userId = getCurrentUserId();
    if (!userId) {
      settingsStore.update(s => ({ ...s, profileError: 'User not authenticated' }));
      return null;
    }

    // Simple cache check
    const cacheKey = cacheKeys.profile(userId);
    if (!forceRefresh && cacheManager.has(cacheKey)) {
      const cached = cacheManager.get<Profile>(cacheKey);
      if (cached) {
        settingsStore.update(s => ({ ...s, profile: cached, profileError: null }));
        return cached;
      }
    }

    settingsStore.update(s => ({ ...s, profileLoading: true, profileError: null }));

    try {
      const profile = await invoke<Profile>('get_user_profile', { userId });

      // Cache the result
      if (profile) {
        cacheManager.set(cacheKey, profile, 5 * 60 * 1000);
      }

      settingsStore.update(s => ({
        ...s,
        profile,
        profileLoading: false,
        profileError: null
      }));

      return profile;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load profile';
      settingsStore.update(s => ({
        ...s,
        profileLoading: false,
        profileError: errorMessage
      }));
      console.error('Failed to load profile:', error);
      return null;
    }
  },

  async updateProfile(updates: Partial<Profile>): Promise<Profile | null> {
    const userId = getCurrentUserId();
    if (!userId) return null;

    settingsStore.update(s => ({ ...s, profileLoading: true, profileError: null }));

    try {
      const updatedProfile = await invoke<Profile>('update_user_profile', {
        userId,
        username: updates.username,
        fullName: updates.full_name,
        avatarUrl: updates.avatar_url,
        onboardingComplete: updates.onboarding_complete,
        notifications: updates.notifications
      });

      settingsStore.update(s => ({
        ...s,
        profile: updatedProfile,
        profileLastFetch: Date.now()
      }));

      return updatedProfile;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update profile';
      settingsStore.update(s => ({ ...s, profileError: errorMessage }));
      throw error;
    }
  },

  // Background refresh actions (smart refresh only when needed)
  async refreshProfileInBackground(): Promise<void> {
    const userId = getCurrentUserId();
    if (!userId) return;

    const cacheKey = cacheKeys.profile(userId);

    // Only refresh if cache is getting stale (80% of TTL)
    if (cacheManager.has(cacheKey)) {
      const entry = cacheManager.get(cacheKey);
      if (entry) return; // Still fresh, no need to refresh
    }

    try {
      await this.loadProfile(true);
    } catch (error) {
      console.warn('Background profile refresh failed:', error);
    }
  },

  async invalidateProfileCache(): Promise<void> {
    const userId = getCurrentUserId();
    if (userId) {
      cacheManager.delete(cacheKeys.profile(userId));
    }
  },

  // Force refresh all data
  async refreshAll(): Promise<void> {
    await this.loadProfile(true);
  },

  // Clear all cache (used during logout) - async version for comprehensive cleanup
  async clearCache(): Promise<void> {
    const userId = getCurrentUserId();
    if (userId) {
      // Clear all user-specific cache entries using dynamic import for logout compatibility
      const { cacheManager, cacheKeys } = await import('./cacheManager');
      cacheManager.invalidatePattern(cacheKeys.userPattern(userId));
    }

    // Reset store state
    settingsStore.update(s => ({
      ...s,
      profile: null,
      isInitialized: false
    }));
  },
};

// Derived stores for easy access
export const profileStore = derived(
  settingsStore,
  $settings => ({
    profile: $settings.profile,
    loading: $settings.profileLoading,
    error: $settings.profileError
  })
);

// Export the main store
export { settingsStore };
