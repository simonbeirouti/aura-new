import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { centralizedAuth } from './unifiedAuth';

// Biometric interfaces matching Rust structs
export interface BiometricSettings {
  enabled: boolean;
  require_on_startup: boolean;
  last_authenticated?: number;
  authentication_method?: string;
}

export interface BiometricStatus {
  available: boolean;
  enrolled: boolean;
  error?: string;
}

// Store state
interface BiometricState {
  settings: BiometricSettings | null;
  status: BiometricStatus | null;
  loading: boolean;
  error: string | null;
  isInitialized: boolean;
  authenticating: boolean;
  lastInitialized?: number;
}

// Initial state
const initialState: BiometricState = {
  settings: null,
  status: null,
  loading: false,
  error: null,
  isInitialized: false,
  authenticating: false,
};

// Create the store
const biometricStore = writable<BiometricState>(initialState);

// Helper to check if user is authenticated
function isUserAuthenticated(): boolean {
  const authState = get(centralizedAuth);
  return authState.isAuthenticated;
}

// Biometric store actions
export const biometricActions = {
  // Initialize biometric store with enhanced error handling
  async initialize(forceRefresh = false): Promise<void> {
    if (!isUserAuthenticated()) {
      return;
    }

    // Check if already initialized and recent (within last 30 minutes)
    const currentState = get(biometricStore);
    const now = Date.now();
    const thirtyMinutes = 30 * 60 * 1000;

    if (!forceRefresh && currentState.isInitialized && currentState.lastInitialized &&
        (now - currentState.lastInitialized) < thirtyMinutes) {
      return;
    }

    // Update last initialized timestamp
    biometricStore.update(s => ({ ...s, lastInitialized: now }));

    biometricStore.update(s => ({ ...s, loading: true, error: null }));

    try {
      // Load settings and check availability in parallel with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Biometric initialization timeout')), 10000)
      );

      const initPromise = Promise.all([
        this.loadSettings(),
        this.checkAvailability()
      ]);

      const [settings, status] = await Promise.race([initPromise, timeoutPromise]) as [BiometricSettings, BiometricStatus];

      biometricStore.update(s => ({
        ...s,
        settings,
        status,
        loading: false,
        isInitialized: true,
        error: null
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize biometric';

      biometricStore.update(s => ({
        ...s,
        loading: false,
        error: errorMessage,
        isInitialized: true // Mark as initialized even on failure to prevent infinite retries
      }));

      // Don't throw error - biometric is not critical for app functionality
    }
  },

  // Load biometric settings
  async loadSettings(): Promise<BiometricSettings> {
    try {
      const settings = await invoke<BiometricSettings>('get_biometric_settings');
      biometricStore.update(s => ({ ...s, settings, error: null }));
      return settings;
    } catch (error) {
      throw error;
    }
  },

  // Update biometric settings
  async updateSettings(settings: BiometricSettings): Promise<void> {
    biometricStore.update(s => ({ ...s, loading: true, error: null }));

    try {
      await invoke('update_biometric_settings', { settings });
      biometricStore.update(s => ({
        ...s,
        settings,
        loading: false
      }));
    } catch (error) {
      biometricStore.update(s => ({
        ...s,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to update settings'
      }));
      throw error;
    }
  },

  // Check biometric availability
  async checkAvailability(): Promise<BiometricStatus> {
    try {
      const status = await invoke<BiometricStatus>('check_biometric_availability');
      biometricStore.update(s => ({ ...s, status }));
      return status;
    } catch (error) {
      const errorStatus: BiometricStatus = {
        available: false,
        enrolled: false,
        error: error instanceof Error ? error.message : 'Failed to check availability'
      };
      biometricStore.update(s => ({ ...s, status: errorStatus }));
      return errorStatus;
    }
  },

  // Perform biometric authentication
  async authenticate(reason: string = 'Authenticate to access the app'): Promise<boolean> {
    biometricStore.update(s => ({ ...s, authenticating: true, error: null }));

    try {
      const success = await invoke<boolean>('authenticate_biometric', { reason });

      if (success) {
        // Reload settings to get updated last_authenticated timestamp
        await this.loadSettings();
      }

      biometricStore.update(s => ({ ...s, authenticating: false }));
      return success;
    } catch (error) {
      biometricStore.update(s => ({
        ...s,
        authenticating: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      }));
      return false;
    }
  },

  // Enable/disable biometric authentication
  async setEnabled(enabled: boolean, requireOnStartup?: boolean): Promise<void> {
    biometricStore.update(s => ({ ...s, loading: true, error: null }));

    try {
      await invoke('set_biometric_enabled', {
        enabled,
        requireOnStartup
      });

      // Reload settings to get updated state
      await this.loadSettings();

      biometricStore.update(s => ({ ...s, loading: false }));
    } catch (error) {
      biometricStore.update(s => ({
        ...s,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to update settings'
      }));
      throw error;
    }
  },

  // Check if should authenticate on startup
  async shouldAuthenticateOnStartup(): Promise<boolean> {
    try {
      return await invoke<boolean>('should_authenticate_on_startup');
    } catch (error) {
      return false;
    }
  },

  // Clear error state
  clearError(): void {
    biometricStore.update(s => ({ ...s, error: null }));
  },

  // Reset store state
  reset(): void {
    biometricStore.set(initialState);
  }
};

// Derived stores for easy access
export const biometricSettings = derived(
  biometricStore,
  $biometric => $biometric.settings
);

export const biometricStatus = derived(
  biometricStore,
  $biometric => $biometric.status
);

export const biometricLoading = derived(
  biometricStore,
  $biometric => $biometric.loading || $biometric.authenticating
);

export const biometricError = derived(
  biometricStore,
  $biometric => $biometric.error
);

export const isBiometricAvailable = derived(
  biometricStore,
  $biometric => $biometric.status?.available === true && $biometric.status?.enrolled === true
);

export const isBiometricEnabled = derived(
  biometricStore,
  $biometric => $biometric.settings?.enabled === true
);

export const shouldRequireOnStartup = derived(
  biometricStore,
  $biometric => $biometric.settings?.enabled === true && $biometric.settings?.require_on_startup === true
);

// Export the main store
export { biometricStore };
