import { writable } from 'svelte/store';

// Loading state interface
export interface LoadingState {
  isLoading: boolean;
  message: string;
  progress?: number; // Optional progress percentage (0-100)
  canCancel?: boolean;
  id?: string; // Unique identifier for the loading operation
}

// Initial loading state
const initialLoadingState: LoadingState = {
  isLoading: false,
  message: '',
  progress: undefined,
  canCancel: false,
  id: undefined
};

// Create the loading store
function createLoadingStore() {
  const { subscribe, set, update } = writable<LoadingState>(initialLoadingState);
  
  // Stack to handle multiple loading operations
  const loadingStack: LoadingState[] = [];

  return {
    subscribe,
    
    // Show loading with message
    show: (message: string = 'Loading...', options?: Partial<LoadingState>) => {
      const loadingState: LoadingState = {
        isLoading: true,
        message,
        progress: options?.progress,
        canCancel: options?.canCancel || false,
        id: options?.id || `loading_${Date.now()}`
      };
      
      loadingStack.push(loadingState);
      set(loadingState);
    },
    
    // Update current loading message/progress
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
      if (id) {
        // Remove specific loading by ID
        const index = loadingStack.findIndex(loading => loading.id === id);
        if (index !== -1) {
          loadingStack.splice(index, 1);
        }
      } else {
        // Remove most recent loading
        loadingStack.pop();
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
      message: string = 'Loading...',
      options?: Partial<LoadingState>
    ): Promise<T> {
      const id = `wrap_${Date.now()}`;
      
      try {
        this.show(message, { ...options, id });
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
  showAuth: (message: string = 'Authenticating...') => 
    loadingStore.show(message, { id: 'auth' }),
  hideAuth: () => 
    loadingStore.hide('auth'),
  
  // Profile loading
  showProfile: (message: string = 'Loading profile...') => 
    loadingStore.show(message, { id: 'profile' }),
  hideProfile: () => 
    loadingStore.hide('profile'),
  
  // Database operations
  showDatabase: (message: string = 'Saving...') => 
    loadingStore.show(message, { id: 'database' }),
  hideDatabase: () => 
    loadingStore.hide('database'),
  
  // General app loading
  showApp: (message: string = 'Loading application...') => 
    loadingStore.show(message, { id: 'app' }),
  hideApp: () => 
    loadingStore.hide('app')
};
