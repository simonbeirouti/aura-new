---
trigger: glob
globs: src/lib/stores/*, src/routes/*
---

# Svelte Stores Architecture Rules

## Store Design Patterns

### 1. Store Structure & Organization

**Core Store Categories:**
- **Authentication Stores**: `unifiedAuth.ts` - Centralized auth with session management
- **User Data Stores**: `userStore.ts` - Token balance, subscriptions, purchase management  
- **Platform Stores**: `iapStore.ts` - Apple/Google IAP with platform detection
- **System Stores**: `sessionStore.ts`, `settingsStore.ts`, `notificationStore.ts`
- **Utility Stores**: `cacheManager.ts`, `loadingStore.ts`, `dataStore.ts`
- **Core Management**: `core/storeManager.ts` - Enhanced store lifecycle

### 2. Store Creation Pattern

```typescript
function createEnhancedStore<T>(initialState: T) {
  const { subscribe, update, set } = writable<T>(initialState);
  
  // Core methods
  async function initialize(): Promise<void> { /* ... */ }
  async function refresh(force = false): Promise<void> { /* ... */ }
  function reset(): void { set(initialState); }
  
  return {
    subscribe,
    initialize,
    refresh,
    reset,
    // Specific methods...
  };
}
```

### 3. State Management Principles

**State Structure:**
```typescript
interface StoreState {
  // Data
  data: T;
  
  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
  
  // Error handling
  error: string | null;
  
  // Cache management
  lastUpdate: number | null;
  cacheValidDuration: number;
}
```

**Required Methods:**
- `initialize()` - Setup store with user context
- `refresh(force?)` - Reload data with cache respect
- `reset()` - Clear state and return to initial
- `destroy()` - Cleanup timers and subscriptions

### 4. Derived Store Pattern

```typescript
// Always create derived stores for computed values
export const formattedTokenBalance = derived(
  userStore,
  ($user) => formatNumberWithCommas($user.tokenBalance.tokens_available)
);

export const hasActiveSubscription = derived(
  userStore,
  ($user) => $user.subscriptions.some(sub => sub.subscription_status === 'active')
);
```

### 5. Cache Management

**Implementation:**
```typescript
async function refreshData(force = false): Promise<void> {
  const now = Date.now();
  const cacheValid = lastUpdate && 
    (now - lastUpdate) < cacheValidDuration;
  
  if (!force && cacheValid) return;
  
  // Fetch and update data
  lastUpdate = now;
}
```

**Cache Durations:**
- User data: 5 minutes
- IAP data: 5 minutes  
- Settings: 30 minutes
- Static data: 1 hour

### 6. Error Handling Pattern

```typescript
async function safeOperation(): Promise<void> {
  update(state => ({ ...state, isLoading: true, error: null }));
  
  try {
    const result = await riskyOperation();
    update(state => ({
      ...state,
      data: result,
      isLoading: false,
      error: null,
      lastUpdate: Date.now()
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Operation failed';
    update(state => ({
      ...state,
      isLoading: false,
      error: errorMessage
    }));
    throw error; // Re-throw for caller handling
  }
}
```

### 7. Periodic Sync Pattern

```typescript
function startPeriodicSync(): void {
  if (!browser) return;
  
  const interval = setInterval(async () => {
    try {
      await refresh(true);
    } catch (error) {
      console.error('Periodic sync failed:', error);
    }
  }, syncInterval);
  
  // Store for cleanup
  if (typeof window !== 'undefined') {
    (window as any).__storeIntervals = interval;
  }
}

function stopPeriodicSync(): void {
  if (typeof window !== 'undefined' && (window as any).__storeIntervals) {
    clearInterval((window as any).__storeIntervals);
    delete (window as any).__storeIntervals;
  }
}
```

### 8. Platform-Specific Logic

```typescript
// Platform detection
async function isDesktopMacOS(): Promise<boolean> {
  try {
    const platformInfo = await invoke('get_platform_info');
    return (platformInfo as any)?.os === 'macos';
  } catch {
    return false;
  }
}

// Platform-specific initialization
async function initializePlatformFeatures(): Promise<void> {
  const isMobile = await isMobileDevice();
  
  if (isMobile) {
    await initializeIAP();
    await initializeBiometrics();
  } else {
    // Desktop-specific setup
    await initializeDesktopFeatures();
  }
}
```

### 9. Store Integration Pattern

```typescript
// Cross-store communication
export class UnifiedAuthStore {
  async setAuthenticated(user: User, session: AuthSession): Promise<void> {
    // Update auth state
    this.store.update(state => ({ ...state, user, session }));
    
    // Initialize dependent stores
    await userStore.initialize(user.id);
    await settingsStore.initialize(user.id);
    
    // Start background processes
    this.startBackgroundSync(user.id);
  }
}
```

### 10. TypeScript Integration

```typescript
// Strong typing for all store interfaces
export interface UserState {
  tokenBalance: UserTokenBalance;
  subscriptions: UserSubscriptionRecord[];
  isLoading: boolean;
  error: string | null;
  lastUpdate: number | null;
}

// Export types for components
export type { UserState, UserTokenBalance, UserSubscriptionRecord };
```

## Best Practices

### Do's ✅
- Always use TypeScript interfaces for store state
- Implement proper error handling with user-friendly messages
- Use derived stores for computed values
- Implement caching with appropriate TTL
- Clean up timers and subscriptions in destroy methods
- Use platform detection for conditional features
- Provide loading states for async operations
- Use optimistic updates where appropriate

### Don'ts ❌
- Don't mutate store state directly
- Don't ignore error handling
- Don't create stores without cleanup methods
- Don't hardcode cache durations
- Don't mix platform-specific code without detection
- Don't create derived stores inside components
- Don't forget to handle edge cases (network failures, etc.)

## Store Lifecycle

1. **Creation** - Initialize with proper TypeScript types
2. **Registration** - Register with store manager if using enhanced stores
3. **Initialization** - Load initial data and set up subscriptions
4. **Operation** - Handle updates, refreshes, and user interactions
5. **Cleanup** - Clear timers, subscriptions, and reset state
6. **Destruction** - Proper cleanup when component unmounts

## Integration with Tauri

- Use `invoke()` for all backend communication
- Handle platform-specific features gracefully
- Implement proper error handling for Tauri command failures
- Use secure storage for sensitive data
- Respect platform limitations (e.g., IAP on desktop)
