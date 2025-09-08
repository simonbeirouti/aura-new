import { writable } from 'svelte/store';

// Loading state interface
export interface LoadingState {
  isLoading: boolean;
  progress?: number; // Optional progress percentage (0-100)
  canCancel?: boolean;
  id?: string; // Unique identifier for the loading operation
}

// Initial loading state
const initialLoadingState: LoadingState = {
  isLoading: false,
  progress: undefined,
  canCancel: false,
  id: undefined
};

// Create the loading store
function createLoadingStore() {
  const { subscribe, set, update } = writable<LoadingState>(initialLoadingState);

  // Stack to handle multiple loading operations
  const loadingStack: LoadingState[] = [];

  // Timeout tracking for automatic recovery
  const timeoutMap = new Map<string, NodeJS.Timeout>();

  return {
    subscribe,
    
    // Show loading
    show: (options?: Partial<LoadingState>) => {
      const loadingState: LoadingState = {
        isLoading: true,
        progress: options?.progress,
        canCancel: options?.canCancel || false,
        id: options?.id || `loading_${Date.now()}`
      };

      loadingStack.push(loadingState);
      set(loadingState);

      // Set up automatic timeout recovery (5 minutes max for any loading operation)
      const timeoutId = setTimeout(() => {
        console.warn(`Loading operation ${loadingState.id} timed out, forcing hide`);
        // Remove from stack and clear timeout
        const index = loadingStack.findIndex(loading => loading.id === loadingState.id);
        if (index !== -1) {
          loadingStack.splice(index, 1);
          timeoutMap.delete(loadingState.id);

          // Show next loading in stack or hide completely
          if (loadingStack.length > 0) {
            set(loadingStack[loadingStack.length - 1]);
          } else {
            set(initialLoadingState);
          }
        }
      }, 5 * 60 * 1000); // 5 minutes

      // Store timeout reference
      timeoutMap.set(loadingState.id, timeoutId);
    },
    
    // Update current loading progress
    update: (updates: Partial<LoadingState>) => {
      if (loadingStack.length > 0) {
        const current = loadingStack[loadingStack.length - 1];
        const updated = { ...current, ...updates };
        loadingStack[loadingStack.length - 1] = updated;
        set(updated);
      }
    },
    
    // Hide current loading (removes from stack)
    hide: (id?: string) => {
      let removedId: string | undefined;

      if (id) {
        // Remove specific loading by ID
        const index = loadingStack.findIndex(loading => loading.id === id);
        if (index !== -1) {
          removedId = loadingStack[index].id;
          loadingStack.splice(index, 1);
        }
      } else {
        // Remove most recent loading
        const removed = loadingStack.pop();
        removedId = removed?.id;
      }

      // Clear timeout for the removed loading operation
      if (removedId) {
        const timeoutId = timeoutMap.get(removedId);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutMap.delete(removedId);
        }
      }

      // Show next loading in stack or hide completely
      if (loadingStack.length > 0) {
        set(loadingStack[loadingStack.length - 1]);
      } else {
        set(initialLoadingState);
      }
    },
    
    // Clear all loading states
    clear: () => {
      // Clear all timeouts
      for (const timeoutId of timeoutMap.values()) {
        clearTimeout(timeoutId);
      }
      timeoutMap.clear();

      loadingStack.length = 0;
      set(initialLoadingState);
    },
    
    // Check if currently loading
    isLoading: () => {
      let current: LoadingState;
      const unsubscribe = subscribe(state => { current = state; });
      unsubscribe();
      return current!.isLoading;
    },
    
    // Async wrapper for operations
    async wrap<T>(
      operation: () => Promise<T>,
      options?: Partial<LoadingState>
    ): Promise<T> {
      const id = `wrap_${Date.now()}`;

      try {
        this.show({ ...options, id });
        const result = await operation();
        return result;
      } finally {
        this.hide(id);
      }
    }
  };
}

// Export the loading store instance
export const loadingStore = createLoadingStore();

// Convenience functions for common loading scenarios
export const loadingActions = {
  // Authentication loading
  showAuth: () =>
    loadingStore.show({ id: 'auth' }),
  hideAuth: () =>
    loadingStore.hide('auth'),

  // Profile loading
  showProfile: () =>
    loadingStore.show({ id: 'profile' }),
  hideProfile: () =>
    loadingStore.hide('profile'),

  // Database operations
  showDatabase: () =>
    loadingStore.show({ id: 'database' }),
  hideDatabase: () =>
    loadingStore.hide('database'),

  // General app loading
  showApp: () =>
    loadingStore.show({ id: 'app' }),
  hideApp: () =>
    loadingStore.hide('app')
};
