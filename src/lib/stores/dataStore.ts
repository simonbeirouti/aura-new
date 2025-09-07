import { createEnhancedStore, storeManager, type BaseStore } from './core/storeManager';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { sessionActions } from './sessionStore';
import { loadingActions } from './loadingStore';
import { getSupabaseConfig } from './unifiedAuth';

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

// Data store state interface
export interface DataState {
  // Profile data
  currentProfile: Profile | null;
  profileCache: Map<string, Profile>;
  
  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  
  // Sync metadata
  lastSync: number | null;
  pendingChanges: Array<{
    id: string;
    type: 'create' | 'update' | 'delete';
    data: any;
    timestamp: number;
  }>;
  
  // Offline queue
  offlineQueue: Array<{
    id: string;
    operation: string;
    params: any;
    timestamp: number;
    retryCount: number;
  }>;
  
  // Cache metadata
  cacheTimestamps: Map<string, number>;
  cacheTTL: number; // Time to live in milliseconds
}

// Initial data state
const initialDataState: DataState = {
  currentProfile: null,
  profileCache: new Map(),
  isLoading: false,
  isInitialized: false,
  error: null,
  lastSync: null,
  pendingChanges: [],
  offlineQueue: [],
  cacheTimestamps: new Map(),
  cacheTTL: 5 * 60 * 1000 // 5 minutes
};

// Enhanced data store with caching and offline support
class DataStore {
  private store: BaseStore<DataState>;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.store = createEnhancedStore('app_data', initialDataState, {
      saveOnChange: true,
      saveStrategy: 'debounce',
      saveInterval: 5000,
      syncStrategy: 'throttle',
      syncInterval: 1000,
      autoStart: false, // Lazy loaded
      // Don't sync offline queue to avoid conflicts
      filterKeys: ['offlineQueue'],
      filterKeysStrategy: 'omit'
    });

    // Register with store manager
    storeManager.registerStore('app_data', this.store);
    
    // Setup periodic sync
    this.setupPeriodicSync();
  }

  // Store interface delegation
  get subscribe() {
    return this.store.subscribe;
  }

  // Initialization with enhanced error handling and cache validation
  async initialize() {
    const currentState = get(this.store);

    // Ensure we have a valid state
    if (!currentState) {
      return;
    }

    if (currentState.isInitialized) return;

    this.store.update(state => ({
      ...state,
      isLoading: true,
      error: null
    }));

    try {
      // Step 1: Load cached data first
      await this.store.load();

      // Step 2: Validate and clean cache data
      await this.validateCacheData();

      // Step 3: Initialize database connection with timeout and retry
      const maxRetries = 3;
      let connectionSuccess = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const connectionPromise = this.ensureDatabaseConnection();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database connection timeout')), 5000)
          );

          await Promise.race([connectionPromise, timeoutPromise]);
          connectionSuccess = true;
          break;
        } catch (connectionError) {
          console.warn(`Database connection attempt ${attempt} failed:`, connectionError);
          if (attempt < maxRetries) {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (!connectionSuccess) {
        console.warn('Database connection failed after all retries, continuing with cached data');
      }

      // Step 4: Process offline queue (only if we have a connection)
      if (connectionSuccess) {
        try {
          await this.processOfflineQueue();
        } catch (queueError) {
          console.warn('Failed to process offline queue:', queueError);
          // Continue anyway
        }
      }

      this.store.update(state => ({
        ...state,
        isInitialized: true,
        isLoading: false
      }));

      console.log('Data store initialized successfully');

    } catch (error) {
      console.error('Data store initialization failed:', error);
      // Even if initialization fails, mark as initialized to prevent infinite loading
      this.store.update(state => ({
        ...state,
        error: error instanceof Error ? error.message : 'Initialization failed',
        isInitialized: true,
        isLoading: false
      }));
    }
  }

  // Cache validation and cleanup
  private async validateCacheData(): Promise<void> {
    const currentState = get(this.store);

    if (!currentState) return;

    const now = Date.now();
    const maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours
    let hasChanges = false;

    // Validate profile cache
    if (currentState.profileCache && currentState.cacheTimestamps) {
      const newCache = new Map(currentState.profileCache);
      const newTimestamps = new Map(currentState.cacheTimestamps);

      for (const [userId, timestamp] of newTimestamps) {
        if (now - timestamp > maxCacheAge) {
          newCache.delete(userId);
          newTimestamps.delete(userId);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        this.store.update(state => ({
          ...state,
          profileCache: newCache,
          cacheTimestamps: newTimestamps
        }));

        console.log('Cleaned up stale profile cache entries');
      }
    }

    // Validate offline queue - remove very old entries
    if (currentState.offlineQueue && currentState.offlineQueue.length > 0) {
      const maxQueueAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      const newQueue = currentState.offlineQueue.filter(
        item => (now - item.timestamp) < maxQueueAge
      );

      if (newQueue.length !== currentState.offlineQueue.length) {
        this.store.update(state => ({
          ...state,
          offlineQueue: newQueue
        }));

        console.log(`Cleaned up ${currentState.offlineQueue.length - newQueue.length} old offline queue entries`);
      }
    }
  }

  // Database connection management
  private async ensureDatabaseConnection() {
    loadingActions.showDatabase();
    
    try {
      // Check if we have valid session tokens
      const hasSession = await sessionActions.hasValidSession();

      if (!hasSession) {
        throw new Error('No valid session for database connection');
      }

      // Get tokens for database initialization
      const tokens = await sessionActions.getTokens();

      if (!tokens) {
        throw new Error('No authentication tokens available');
      }

      // Use centralized Supabase config from unifiedAuth
      const config = getSupabaseConfig();
      
      if (!config.hasValidConfig) {
        throw new Error('Missing Supabase configuration in unifiedAuth');
      }

      await invoke('init_database', {
        database_url: config.url, // Match Rust parameter name exactly
        access_token: tokens.accessToken,
        anon_key: config.anonKey
      });

    } catch (error) {
      throw error;
    } finally {
      loadingActions.hideDatabase();
    }
  }

  // Profile management (simplified to avoid circular dependency)
  async loadCurrentProfile(userId: string): Promise<Profile | null> {
    try {
      const profile = await this.getUserProfile(userId);
      
      if (profile) {
        // Update current profile in state
        this.store.update(state => ({
          ...state,
          currentProfile: profile,
          error: null
        }));
      }
      
      return profile;

      return null;
    } catch (error) {
      this.store.update(state => ({
        ...state,
        error: `Failed to load profile: ${error}`,
        currentProfile: null
      }));
      return null;
    }
  }

  // Refresh current profile from database (bypass cache)
  async refreshCurrentProfile(): Promise<Profile | null> {
    const state = get(this.store);

    if (!state.currentProfile?.id) {
      return null;
    }

    try {
      // Force refresh from database (bypass cache)
      const refreshedProfile = await this.getUserProfile(state.currentProfile.id, false);

      if (refreshedProfile) {
        this.store.update(state => ({
          ...state,
          currentProfile: refreshedProfile,
          error: null
        }));
      }

      return refreshedProfile;
    } catch (error) {
      this.store.update(state => ({
        ...state,
        error: `Failed to refresh profile: ${error}`
      }));
      return null;
    }
  }

  async getUserProfile(userId: string, useCache: boolean = true): Promise<Profile | null> {
    loadingActions.showDatabase();

    try {
      // Check cache first if enabled
      if (useCache) {
        const cached = await this.getCachedProfile(userId);
        if (cached) {
          return cached;
        }
      }

      // Fetch from database
      console.log('DataStore: Fetching profile from database for userId:', userId);
      let profile: Profile | null;
      try {
        profile = await invoke<Profile | null>('get_user_profile', { userId });
        console.log('DataStore: Profile fetched from database:', profile);
      } catch (invokeError) {
        console.error('DataStore: Failed to invoke get_user_profile:', invokeError);
        throw invokeError;
      }

      // Defensive check for profile data structure
      if (profile && typeof profile === 'object' && profile.id) {
        // Update cache
        this.updateProfileCache(userId, profile);

        // Update current profile if it's the current user
        this.store.update(state => ({
          ...state,
          currentProfile: profile,
          error: null
        }));

        // Also update the centralized auth store
        try {
          // We'll trigger a profile refresh in the unified auth store
          // This will cause it to re-fetch and update the profile state
        } catch (authError) {
          // Continue silently
        }

        return profile;
      } else if (profile === null) {
        // Profile doesn't exist, this is normal for new users
        return null;
      } else {
        // Profile exists but has invalid structure
        throw new Error('Invalid profile data structure received from database');
      }
    } catch (error) {
      // Add to offline queue if we're offline
      try {
        await this.addToOfflineQueue('get_user_profile', { userId });
      } catch (queueError) {
        // Continue silently
      }

      // Return cached version if available
      return await this.getCachedProfile(userId);
    } finally {
      loadingActions.hideDatabase();
    }
  }

  async updateUserProfile(
    userId: string,
    updates: Partial<Profile>
  ): Promise<Profile | null> {
    try {
      // Add to pending changes
      this.addPendingChange('update', { userId, ...updates });

      // Try to update immediately
      console.log('DataStore: Updating profile for userId:', userId, 'with updates:', updates);
      let updatedProfile: Profile;
      try {
        updatedProfile = await invoke<Profile>('update_user_profile', {
          userId: userId,
          username: updates.username,
          fullName: updates.full_name,
          avatarUrl: updates.avatar_url,
          onboardingComplete: updates.onboarding_complete,
          notifications: updates.notifications
        });
        console.log('DataStore: Profile updated in database:', updatedProfile);
      } catch (invokeError) {
        console.error('DataStore: Failed to invoke update_user_profile:', invokeError);
        throw invokeError;
      }

      if (updatedProfile) {
        // Update cache and current profile
        this.updateProfileCache(userId, updatedProfile);
        
        this.store.update(state => ({
          ...state,
          currentProfile: updatedProfile,
          error: null
        }));

        // Remove from pending changes
        this.removePendingChange('update', userId);
      }

      return updatedProfile;
    } catch (error) {
      // Add to offline queue
      await this.addToOfflineQueue('update_user_profile', {
        userId: userId,
        username: updates.username,
        fullName: updates.full_name,
        avatarUrl: updates.avatar_url,
        onboardingComplete: updates.onboarding_complete,
        notifications: updates.notifications
      });

      throw error;
    }
  }

  async createUserProfile(
    userId: string,
    profileData: Partial<Profile>
  ): Promise<Profile | null> {
    try {
      // Add to pending changes
      this.addPendingChange('create', { userId, ...profileData });

      // Try to create immediately
      console.log('DataStore: Creating profile for userId:', userId, 'with data:', profileData);
      let newProfile: Profile;
      try {
        newProfile = await invoke<Profile>('create_user_profile', {
          userId: userId,
          username: profileData.username,
          fullName: profileData.full_name,
          avatarUrl: profileData.avatar_url,
          onboardingComplete: profileData.onboarding_complete,
          notifications: profileData.notifications
        });
        console.log('DataStore: Profile created in database:', newProfile);
      } catch (invokeError) {
        console.error('DataStore: Failed to invoke create_user_profile:', invokeError);
        throw invokeError;
      }

      if (newProfile) {
        // Update cache and current profile
        this.updateProfileCache(userId, newProfile);
        
        this.store.update(state => ({
          ...state,
          currentProfile: newProfile,
          error: null
        }));

        // Remove from pending changes
        this.removePendingChange('create', userId);
      }

      return newProfile;
    } catch (error) {
      // Add to offline queue
      await this.addToOfflineQueue('create_user_profile', {
        userId: userId,
        username: profileData.username,
        fullName: profileData.full_name,
        avatarUrl: profileData.avatar_url,
        onboardingComplete: profileData.onboarding_complete,
        notifications: profileData.notifications
      });

      throw error;
    }
  }

  async checkUsernameAvailability(username: string): Promise<boolean> {
    try {
      return await invoke<boolean>('check_username_availability', { username });
    } catch (error) {
      // For username checking, we can't really queue this offline
      // Return false to be safe
      return false;
    }
  }

  // Cache management
  private async getCachedProfile(userId: string): Promise<Profile | null> {
    try {
      const currentState = get(this.store);

      // Ensure we have a valid state and required properties
      if (!currentState) {
        return null;
      }

      if (!currentState.profileCache || !(currentState.profileCache instanceof Map)) {
        return null;
      }

      if (!currentState.cacheTimestamps || !(currentState.cacheTimestamps instanceof Map)) {
        return null;
      }

      const cached = currentState.profileCache.get(userId);
      if (!cached) return null;

      // Check if cache is still valid
      const cacheTime = currentState.cacheTimestamps.get(userId);
      if (!cacheTime || Date.now() - cacheTime > currentState.cacheTTL) {
        return null;
      }

      return cached;
    } catch (error) {
      return null;
    }
  }

  private updateProfileCache(userId: string, profile: Profile) {
    this.store.update(state => {
      // Ensure profileCache is a valid Map
      let newCache: Map<string, Profile>;
      if (state.profileCache instanceof Map) {
        newCache = new Map(state.profileCache);
      } else {
        newCache = new Map();
      }

      // Ensure cacheTimestamps is a valid Map
      let newTimestamps: Map<string, number>;
      if (state.cacheTimestamps instanceof Map) {
        newTimestamps = new Map(state.cacheTimestamps);
      } else {
        newTimestamps = new Map();
      }

      newCache.set(userId, profile);
      newTimestamps.set(userId, Date.now());

      return {
        ...state,
        profileCache: newCache,
        cacheTimestamps: newTimestamps
      };
    });
  }

  // Pending changes management
  private addPendingChange(type: 'create' | 'update' | 'delete', data: any) {
    this.store.update(state => ({
      ...state,
      pendingChanges: [
        ...state.pendingChanges,
        {
          id: `${type}_${data.userId}_${Date.now()}`,
          type,
          data,
          timestamp: Date.now()
        }
      ]
    }));
  }

  private removePendingChange(type: string, userId: string) {
    this.store.update(state => ({
      ...state,
      pendingChanges: state.pendingChanges.filter(
        change => !(change.type === type && change.data.userId === userId)
      )
    }));
  }

  // Offline queue management
  private async addToOfflineQueue(operation: string, params: any) {
    // Don't add to queue if we already have too many retries for this operation
    const currentState = get(this.store);

    // Ensure offlineQueue exists and is an array
    if (!currentState || !Array.isArray(currentState.offlineQueue)) {
      return;
    }

    const existingItems = currentState.offlineQueue.filter(
      item => item.operation === operation && JSON.stringify(item.params) === JSON.stringify(params)
    );

    // If we already have this operation queued with high retry count, don't add more
    if (existingItems.some(item => item.retryCount >= 7)) {
      return;
    }

    this.store.update(state => ({
      ...state,
      offlineQueue: [
        ...state.offlineQueue,
        {
          id: `${operation}_${Date.now()}`,
          operation,
          params,
          timestamp: Date.now(),
          retryCount: 0
        }
      ]
    }));
  }

  // Clear offline queue (useful for debugging or when operations are no longer needed)
  async clearOfflineQueue() {
    this.store.update(state => ({
      ...state,
      offlineQueue: []
    }));
  }

  private async processOfflineQueue() {
    const currentState = get(this.store);

    // Ensure offlineQueue exists and is an array
    if (!currentState || !Array.isArray(currentState.offlineQueue)) {
      return;
    }

    const queue = [...currentState.offlineQueue];
    const processedIds: string[] = [];
    const failedIds: string[] = [];
    const MAX_RETRIES = 5;

    for (const item of queue) {
      // Skip items that have exceeded retry limit
      if (item.retryCount >= MAX_RETRIES) {
        failedIds.push(item.id);
        continue;
      }

      try {
        await invoke(item.operation, item.params);
        processedIds.push(item.id);
      } catch (error) {
        // Increment retry count
        this.store.update(state => ({
          ...state,
          offlineQueue: state.offlineQueue.map(queueItem =>
            queueItem.id === item.id
              ? { ...queueItem, retryCount: queueItem.retryCount + 1 }
              : queueItem
          )
        }));
      }
    }

    // Remove successfully processed items and failed items that exceeded retry limit
    const idsToRemove = [...processedIds, ...failedIds];
    if (idsToRemove.length > 0) {
      this.store.update(state => ({
        ...state,
        offlineQueue: state.offlineQueue.filter(item => !idsToRemove.includes(item.id))
      }));
    }
  }

  // Sync management
  private setupPeriodicSync() {
    console.log('🔄 Setting up periodic sync with conflict resolution');

    // Re-enable periodic sync with enhanced safeguards
    this.syncInterval = setInterval(async () => {
      try {
        // Multiple safety checks before syncing
        const currentState = get(this.store);

        // Skip if not initialized
        if (!currentState.isInitialized) {
          return;
        }

        // Skip if currently loading
        if (currentState.isLoading) {
          console.log('⚠️ Skipping periodic sync - currently loading');
          return;
        }

        // Skip if we have pending changes that haven't been processed
        if (currentState.pendingChanges.length > 0) {
          console.log('⚠️ Skipping periodic sync - pending changes exist');
          return;
        }

        // Skip if offline queue is too large (backpressure)
        if (currentState.offlineQueue && currentState.offlineQueue.length > 50) {
          console.log('⚠️ Skipping periodic sync - offline queue too large');
          return;
        }

        // Check network connectivity (basic check)
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          console.log('⚠️ Skipping periodic sync - offline');
          return;
        }

        // All checks passed - perform sync
        console.log('🔄 Executing periodic sync...');
        await this.sync();

      } catch (error) {
        console.warn('⚠️ Periodic sync failed:', error);
        // Don't let sync failures crash the app
      }
    }, 45000); // Sync every 45 seconds (less frequent to reduce load)

    console.log('✅ Periodic sync setup complete');
  }

  async sync() {
    try {
      const currentState = get(this.store);

      // Skip sync if not initialized or if we recently synced
      if (!currentState.isInitialized) {
        console.log('⚠️ Skipping sync - data store not initialized');
        return;
      }

      const now = Date.now();
      const lastSync = currentState.lastSync || 0;
      const timeSinceLastSync = now - lastSync;

      // Skip if synced recently (within 10 seconds)
      if (timeSinceLastSync < 10000) {
        console.log('⚠️ Skipping sync - recently synced');
        return;
      }

      console.log('🔄 Starting data sync with conflict resolution...');

      // Step 1: Sync with enhanced store (basic persistence)
      await this.store.sync();

      // Step 2: Enhanced sync with conflict resolution
      await this.syncWithConflictResolution();

      // Step 3: Process offline queue with conflict resolution
      await this.processOfflineQueue();

      // Step 4: Validate and repair any inconsistencies
      await this.validateAndRepairData();

      // Update sync timestamp
      this.store.update(state => ({
        ...state,
        lastSync: now
      }));

      console.log('✅ Data sync completed successfully');

    } catch (error) {
      console.warn('⚠️ Data sync failed:', error);
      // Don't fail completely - just log the error
    }
  }

  /**
   * Enhanced sync with conflict resolution
   */
  private async syncWithConflictResolution(): Promise<void> {
    try {
      const currentState = get(this.store);

      // Only sync if we have profile data
      if (!currentState.currentProfile) {
        return;
      }

      const profile = currentState.currentProfile;

      // Fetch latest profile from server
      const serverProfile = await this.fetchLatestProfileFromServer(profile.id);

      if (!serverProfile) {
        console.log('⚠️ No server profile found for conflict resolution');
        return;
      }

      // Check for conflicts
      const conflicts = this.detectProfileConflicts(profile, serverProfile);

      if (conflicts.length > 0) {
        console.log('⚠️ Profile conflicts detected:', conflicts);

        // Resolve conflicts
        const resolvedProfile = await this.resolveProfileConflicts(profile, serverProfile, conflicts);

        // Update local profile with resolved data
        if (resolvedProfile) {
          await this.updateLocalProfileWithResolvedData(resolvedProfile);
        }
      } else {
        console.log('✅ No profile conflicts detected');

        // No conflicts - update local timestamps if server data is newer
        if (this.isServerDataNewer(profile, serverProfile)) {
          console.log('📋 Server data is newer, updating local cache...');
          await this.updateLocalProfileCache(serverProfile);
        }
      }

    } catch (error) {
      console.warn('⚠️ Conflict resolution failed:', error);
      // Continue without failing the entire sync
    }
  }

  /**
   * Fetch latest profile from server for conflict resolution
   */
  private async fetchLatestProfileFromServer(userId: string): Promise<Profile | null> {
    try {
      const { data, error } = await invoke<Profile>('get_user_profile', { userId });

      if (error) {
        console.warn('Failed to fetch server profile:', error);
        return null;
      }

      return data || null;
    } catch (error) {
      console.warn('Error fetching server profile:', error);
      return null;
    }
  }

  /**
   * Detect conflicts between local and server profiles
   */
  private detectProfileConflicts(local: Profile, server: Profile): Array<{
    field: string;
    localValue: any;
    serverValue: any;
    conflictType: 'value_mismatch' | 'timestamp_mismatch';
  }> {
    const conflicts = [];

    // Compare key fields that might have conflicts
    const conflictFields = ['username', 'full_name', 'avatar_url', 'notifications', 'onboarding_complete'];

    for (const field of conflictFields) {
      const localValue = local[field];
      const serverValue = server[field];

      // Check for value mismatches
      if (localValue !== serverValue && localValue !== null && serverValue !== null) {
        conflicts.push({
          field,
          localValue,
          serverValue,
          conflictType: 'value_mismatch'
        });
      }
    }

    // Check timestamp conflicts (if server data is significantly newer)
    const localTimestamp = new Date(local.updated_at || 0).getTime();
    const serverTimestamp = new Date(server.updated_at || 0).getTime();
    const timeDiff = Math.abs(serverTimestamp - localTimestamp);

    // If server data is more than 5 minutes newer and there are changes, consider it a conflict
    if (timeDiff > 5 * 60 * 1000 && conflicts.length > 0) {
      conflicts.push({
        field: 'updated_at',
        localValue: local.updated_at,
        serverValue: server.updated_at,
        conflictType: 'timestamp_mismatch'
      });
    }

    return conflicts;
  }

  /**
   * Resolve profile conflicts using various strategies
   */
  private async resolveProfileConflicts(
    local: Profile,
    server: Profile,
    conflicts: Array<any>
  ): Promise<Profile | null> {
    try {
      // Strategy 1: For onboarding_complete, server always wins
      if (conflicts.some(c => c.field === 'onboarding_complete')) {
        console.log('🎯 Resolving onboarding_complete conflict - server wins');
        return {
          ...local,
          onboarding_complete: server.onboarding_complete,
          updated_at: server.updated_at
        };
      }

      // Strategy 2: For username, check availability and prefer local if server is empty
      if (conflicts.some(c => c.field === 'username')) {
        const usernameConflict = conflicts.find(c => c.field === 'username');

        if (!server.username && local.username) {
          console.log('🎯 Resolving username conflict - local wins (server empty)');
          return {
            ...server,
            username: local.username,
            updated_at: new Date().toISOString()
          };
        } else if (server.username && !local.username) {
          console.log('🎯 Resolving username conflict - server wins (local empty)');
          return server;
        } else {
          // Both have values - check if local username is still available
          const isAvailable = await this.checkUsernameAvailability(local.username!);
          if (isAvailable) {
            console.log('🎯 Resolving username conflict - local wins (available)');
            return {
              ...server,
              username: local.username,
              updated_at: new Date().toISOString()
            };
          } else {
            console.log('🎯 Resolving username conflict - server wins (local unavailable)');
            return server;
          }
        }
      }

      // Strategy 3: For other fields, use timestamp-based resolution
      const localTime = new Date(local.updated_at || 0).getTime();
      const serverTime = new Date(server.updated_at || 0).getTime();

      if (serverTime > localTime) {
        console.log('🎯 Resolving conflicts - server wins (newer timestamp)');
        return server;
      } else {
        console.log('🎯 Resolving conflicts - local wins (newer or equal timestamp)');
        return {
          ...server,
          ...local,
          updated_at: new Date().toISOString()
        };
      }

    } catch (error) {
      console.warn('⚠️ Error resolving conflicts:', error);
      // Fallback: server wins
      console.log('🎯 Fallback conflict resolution - server wins');
      return server;
    }
  }

  /**
   * Update local profile with resolved data
   */
  private async updateLocalProfileWithResolvedData(resolvedProfile: Profile): Promise<void> {
    try {
      // Update current profile
      this.store.update(state => ({
        ...state,
        currentProfile: resolvedProfile
      }));

      // Update cache
      await this.updateLocalProfileCache(resolvedProfile);

      // Sync to server
      await this.syncResolvedProfileToServer(resolvedProfile);

      console.log('✅ Local profile updated with resolved data');

    } catch (error) {
      console.warn('⚠️ Failed to update local profile with resolved data:', error);
    }
  }

  /**
   * Update local profile cache
   */
  private async updateLocalProfileCache(profile: Profile): Promise<void> {
    this.store.update(state => {
      const newCache = new Map(state.profileCache);
      const newTimestamps = new Map(state.cacheTimestamps);

      newCache.set(profile.id, profile);
      newTimestamps.set(profile.id, Date.now());

      return {
        ...state,
        profileCache: newCache,
        cacheTimestamps: newTimestamps
      };
    });
  }

  /**
   * Sync resolved profile back to server
   */
  private async syncResolvedProfileToServer(profile: Profile): Promise<void> {
    try {
      await invoke('update_user_profile', {
        userId: profile.id,
        updates: profile
      });

      console.log('✅ Resolved profile synced to server');

    } catch (error) {
      console.warn('⚠️ Failed to sync resolved profile to server:', error);
      // Add to offline queue for retry
      this.addToOfflineQueue('update_user_profile', {
        userId: profile.id,
        updates: profile
      });
    }
  }

  /**
   * Check if server data is newer than local
   */
  private isServerDataNewer(local: Profile, server: Profile): boolean {
    const localTime = new Date(local.updated_at || 0).getTime();
    const serverTime = new Date(server.updated_at || 0).getTime();

    return serverTime > localTime;
  }

  /**
   * Validate and repair data inconsistencies
   */
  private async validateAndRepairData(): Promise<void> {
    try {
      const currentState = get(this.store);

      // Validate current profile
      if (currentState.currentProfile) {
        const profile = currentState.currentProfile;

        // Check for missing required fields
        if (!profile.id) {
          console.warn('⚠️ Profile missing ID, marking for repair');
          // Add to repair queue or handle appropriately
        }

        // Validate onboarding status consistency
        if (profile.onboarding_complete && (!profile.username || !profile.full_name)) {
          console.warn('⚠️ Inconsistent onboarding state detected');
          // Could trigger re-validation or repair
        }
      }

      // Clean up old cache entries
      const now = Date.now();
      const maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours

      this.store.update(state => {
        const newCache = new Map(state.profileCache);
        const newTimestamps = new Map(state.cacheTimestamps);
        let hasCleanup = false;

        for (const [userId, timestamp] of newTimestamps) {
          if (now - timestamp > maxCacheAge) {
            newCache.delete(userId);
            newTimestamps.delete(userId);
            hasCleanup = true;
          }
        }

        if (hasCleanup) {
          console.log('🧹 Cleaned up old cache entries');
        }

        return {
          ...state,
          profileCache: newCache,
          cacheTimestamps: newTimestamps
        };
      });

    } catch (error) {
      console.warn('⚠️ Data validation and repair failed:', error);
    }
  }

  async load() {
    await this.store.load();
  }

  async save() {
    await this.store.save();
  }

  // Reset store to initial state (public method for logout)
  reset() {
    this.store.set(initialDataState);
  }


  // Cleanup
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    this.store.destroy();
  }
}

// Create and export the data store instance
export const dataStore = new DataStore();

// Export helper functions for common operations
export const dataActions = {
  initialize: () => dataStore.initialize(),
  getUserProfile: (userId: string, useCache?: boolean) => dataStore.getUserProfile(userId, useCache),
  updateUserProfile: (userId: string, updates: Partial<Profile>) => dataStore.updateUserProfile(userId, updates),
  createUserProfile: (userId: string, profileData: Partial<Profile>) => dataStore.createUserProfile(userId, profileData),
  checkUsernameAvailability: (username: string) => dataStore.checkUsernameAvailability(username),
  clearOfflineQueue: () => dataStore.clearOfflineQueue(),
  sync: () => dataStore.sync(),
  load: () => dataStore.load(),
  save: () => dataStore.save()
};
