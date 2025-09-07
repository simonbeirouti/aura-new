<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { centralizedAuth } from '../stores/unifiedAuth';
  import { settingsStore } from '../stores/settingsStore';
  import { sessionStore } from '../stores/sessionStore';
  import { cacheStats } from '../stores/cacheManager';
  import { dataStore } from '../stores/dataStore';
  import { loadingStore } from '../stores/loadingStore';
  import { iapStore } from '../stores/iapStore';
  import { userStore } from '../stores/userStore';
  import { purchaseManager, products } from '../stores/purchaseStore';
  import { Badge } from './ui/badge';

  let isVisible = false;
  let isDragging = false;
  let position = { x: 20, y: 20 };
  let dragStart = { x: 0, y: 0 };

  // Platform logs
  let platformLogs: Array<{timestamp: Date, level: string, message: string, data?: any}> = [];

  // Store states
  let authState: any = {};
  let settingsState: any = {};
  let sessionState: any = {};
  let cacheState: any = {};
  let dataState: any = {};
  let loadingState: any = {};
  let iapState: any = {};
  let userState: any = {};
  let productsState: any = {};

  // Subscriptions
  let unsubscribes: (() => void)[] = [];

  // Detect if we're on mobile
  let isMobile = false;

  // Only enable debugger in development or when explicitly requested
  let isEnabled = false;

  // Check if debugger should be enabled
  if (typeof window !== 'undefined') {
    // Enable in development, or if URL contains debug=1, or if localStorage has debug=true
    isEnabled = import.meta.env.DEV ||
                window.location.search.includes('debug=1') ||
                localStorage.getItem('debug_enabled') === 'true';
  }

  // Prevent infinite loops - track last logged states
  let lastLoggedStates: Record<string, string> = {
    auth: '',
    settings: '',
    session: '',
    cache: '',
    data: '',
    loading: '',
    iap: '',
    user: '',
    products: ''
  };

  // Debounce timers
  let logTimers: { [key: string]: NodeJS.Timeout } = {};

  // Platform logging function with debouncing
  function logPlatformEvent(level: string, message: string, data?: any, debounceKey?: string, debounceMs: number = 1000) {
    // Skip if this is a repeated message for the same debounce key
    if (debounceKey && lastLoggedStates[debounceKey] === message) {
      return;
    }

    // Clear existing timer for this key
    if (debounceKey && logTimers[debounceKey]) {
      clearTimeout(logTimers[debounceKey]);
    }

    // Set new timer
    if (debounceKey) {
      logTimers[debounceKey] = setTimeout(() => {
        // Update last logged state
        if (debounceKey) {
          lastLoggedStates[debounceKey] = message;
        }

        // Add log entry
        platformLogs = [...platformLogs.slice(-49), { // Keep last 50 logs to reduce memory
          timestamp: new Date(),
          level,
          message,
          data
        }];

        // Clean up timer
        if (debounceKey) {
          delete logTimers[debounceKey];
        }
      }, debounceMs);
    } else {
      // Immediate logging for non-debounced messages
      platformLogs = [...platformLogs.slice(-49), {
        timestamp: new Date(),
        level,
        message,
        data
      }];
    }
  }

  // Enhanced logging for auth debugging
  function logAuthState(level: string, message: string, state: any) {
    const authInfo = {
      isAuthenticated: state.isAuthenticated,
      isInitialized: state.isInitialized,
      hasUser: !!state.user,
      hasSession: !!state.session,
      hasProfile: !!state.profile,
      profileLoaded: state.profileLoaded,
      onboardingCompleted: state.onboardingCompleted,
      currentOnboardingStep: state.currentOnboardingStep
    };

    // Log critical auth changes immediately, others with debounce
    const isCriticalChange = !state.isAuthenticated ||
                            state.onboardingCompleted ||
                            (state.currentOnboardingStep === 4);

    if (isCriticalChange) {
      logPlatformEvent(level, message, authInfo); // Immediate logging
    } else {
      logPlatformEvent(level, message, authInfo, 'auth_debug', 500); // Debounced
    }
  }

  // Make log function available globally (with fallback when disabled)
  if (typeof window !== 'undefined') {
    if (isEnabled) {
      (window as any).logPlatformEvent = logPlatformEvent;
    } else {
      // Provide no-op function when debugger is disabled to prevent errors
      (window as any).logPlatformEvent = (level: string, message: string, data?: any) => {
        // Only log critical errors to console when debugger is disabled
        if (level === 'error') {
          console.error(`[Platform] ${message}`, data);
        }
      };
    }
  }

  onMount(() => {
    // Only set up subscriptions if debugger is enabled to prevent performance issues
    if (!isEnabled) {
      console.log('FloatingDebugger: Disabled - not subscribing to stores');
      return;
    }

    console.log('FloatingDebugger: Enabled - setting up store subscriptions');

    // Subscribe to all stores with debounced logging to prevent infinite loops
    unsubscribes = [
      centralizedAuth.subscribe(state => {
        authState = state;
        logAuthState('info', 'Auth state updated', state);
      }),
      settingsStore.subscribe(state => {
        settingsState = state;
        logPlatformEvent('info', `Settings state updated: ${state.isInitialized ? 'initialized' : 'not initialized'}`, undefined, 'settings');
      }),
      sessionStore.subscribe(state => {
        sessionState = state;
        logPlatformEvent('info', `Session state updated: ${state.isAuthenticated ? 'authenticated' : 'not authenticated'}`, undefined, 'session');
      }),
      cacheStats.subscribe(state => {
        cacheState = state;
        logPlatformEvent('info', `Cache state updated: ${state.size} items`, undefined, 'cache');
      }),
      dataStore.subscribe(state => {
        dataState = state;
        logPlatformEvent('info', `Data store state updated: ${state.isInitialized ? 'initialized' : 'not initialized'}`, undefined, 'data');
      }),
      loadingStore.subscribe(state => {
        loadingState = state;
        logPlatformEvent('info', `Loading state updated: ${state.isLoading ? 'loading' : 'idle'}`, undefined, 'loading');
      }),
      iapStore.subscribe(state => {
        iapState = state;
        logPlatformEvent('info', `IAP state updated: ${state.isInitialized ? 'initialized' : 'not initialized'}`, undefined, 'iap');
      }),
      userStore.subscribe(state => {
        userState = state;
        logPlatformEvent('info', `User state updated: ${state.userId ? 'has user' : 'no user'}`, undefined, 'user');
      }),
      products.subscribe(state => {
        productsState = state;
        logPlatformEvent('info', `Products state updated: ${state.length} products`, undefined, 'products');
      })
    ];

    // Check if we're on mobile
    isMobile = window.innerWidth < 640;

    // Load position from localStorage (only for desktop)
    if (!isMobile) {
      const savedPosition = localStorage.getItem('debugger-position');
      if (savedPosition) {
        position = JSON.parse(savedPosition);
      }
    }

    // Listen for window resize to update mobile state
    const handleResize = () => {
      isMobile = window.innerWidth < 640;
    };
    window.addEventListener('resize', handleResize);

    // Listen for keyboard shortcut (Ctrl+Shift+D)
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        toggleDebugger();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('resize', handleResize);
    };
  });

  onDestroy(() => {
    // Clean up store subscriptions
    unsubscribes.forEach(unsub => unsub());

    // Clean up debounce timers
    Object.values(logTimers).forEach(timer => clearTimeout(timer));
    logTimers = {};
  });

  function toggleDebugger() {
    isVisible = !isVisible;
  }

  function startDrag(e: MouseEvent | TouchEvent) {
    // Don't allow dragging on mobile (fullscreen mode)
    if (isMobile) return;

    isDragging = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    dragStart = {
      x: clientX - position.x,
      y: clientY - position.y
    };
  }

  function handleDrag(e: MouseEvent | TouchEvent) {
    if (!isDragging || isMobile) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    position = {
      x: clientX - dragStart.x,
      y: clientY - dragStart.y
    };

    // Save position to localStorage (only on desktop)
    if (!isMobile) {
      localStorage.setItem('debugger-position', JSON.stringify(position));
    }
  }

  function stopDrag() {
    isDragging = false;
  }

  function clearLogs() {
    platformLogs = [];
  }

  function formatJson(obj: any) {
    if (obj === null || obj === undefined) return 'null';
    return JSON.stringify(obj, null, 2);
  }

  function getStatusColor(status: any) {
    if (status === true || status === 'complete' || status === 'active' || status === 'initialized') return 'bg-green-500';
    if (status === false || status === 'error' || status === 'failed' || status === 'not initialized') return 'bg-red-500';
    if (status === 'pending' || status === 'running' || status === 'loading') return 'bg-yellow-500';
    return 'bg-gray-500';
  }
</script>

<svelte:window 
  on:mousemove={handleDrag} 
  on:mouseup={stopDrag}
  on:touchmove={handleDrag}
  on:touchend={stopDrag}
/>

{#if isEnabled}
  <!-- Debug Toggle Button (only visible when debugger is enabled) -->
  <button
    class="fixed top-4 right-4 z-[9999] bg-purple-600 hover:bg-purple-700 text-white rounded-full w-10 h-10 flex items-center justify-center font-mono text-sm shadow-lg"
    on:click={toggleDebugger}
    title="Toggle Debugger (Ctrl+Shift+D)"
  >
    🐛
  </button>
{/if}

{#if isEnabled && isVisible}
  <!-- Floating Debugger Window -->
  <div
    class="fixed z-[9998] bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-2xl overflow-hidden
           max-w-3xl max-h-[80vh]
           sm:min-w-[600px]
           max-sm:left-2 max-sm:right-2 max-sm:top-16 max-sm:bottom-16 max-sm:w-auto max-sm:h-auto max-sm:max-h-none"
    style="{!isMobile ? `left: ${position.x}px; top: ${position.y}px;` : ''}"
  >
    <!-- Header -->
    <div
      class="bg-purple-600 text-white px-4 py-2 flex items-center justify-between cursor-move select-none"
      role="button"
      tabindex="0"
      on:mousedown={startDrag}
      on:touchstart={startDrag}
      on:keydown={(e) => e.key === 'Enter' && e.preventDefault()}
    >
      <h3 class="font-semibold">🐛 Platform Status</h3>
      <div class="flex items-center gap-2">
        <span class="text-xs opacity-75">Ctrl+Shift+D</span>
        <button
          on:click={toggleDebugger}
          class="hover:bg-purple-700 rounded p-1"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Status Badges -->
    <div class="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <h4 class="font-semibold text-sm mb-3">Platform Initialization Status</h4>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <Badge variant="outline" class="text-xs">
          Debugger: {isEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
        <Badge variant={authState.isAuthenticated ? 'default' : 'secondary'} class="text-xs">
          Auth: {authState.isAuthenticated ? '✓' : '✗'}
        </Badge>
        <Badge variant={settingsState.isInitialized ? 'default' : 'secondary'} class="text-xs">
          Settings: {settingsState.isInitialized ? '✓' : '✗'}
        </Badge>
        <Badge variant={dataState.isInitialized ? 'default' : 'secondary'} class="text-xs">
          Data: {dataState.isInitialized ? '✓' : '✗'}
        </Badge>
        <Badge variant={sessionState.isAuthenticated ? 'default' : 'secondary'} class="text-xs">
          Session: {sessionState.isAuthenticated ? '✓' : '✗'}
        </Badge>
        <Badge variant={iapState.isInitialized ? 'default' : 'secondary'} class="text-xs">
          IAP: {iapState.isInitialized ? '✓' : '✗'}
        </Badge>
        <Badge variant={userState.userId ? 'default' : 'secondary'} class="text-xs">
          User: {userState.userId ? '✓' : '✗'}
        </Badge>
        <Badge variant={productsState.length > 0 ? 'default' : 'secondary'} class="text-xs">
          Products: {productsState.length}
        </Badge>
        <Badge variant={loadingState.isLoading ? 'secondary' : 'default'} class="text-xs">
          Loading: {loadingState.isLoading ? '...' : 'Idle'}
        </Badge>
        <Badge variant={cacheState.size > 0 ? 'default' : 'secondary'} class="text-xs">
          Cache: {cacheState.size}
        </Badge>
      </div>
    </div>

    <!-- Platform Logs -->
    <div class="p-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="font-semibold text-sm">Platform Logs</h4>
        <button
          class="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200"
          on:click={clearLogs}
        >
          Clear Logs
        </button>
      </div>

      <div class="max-h-80 overflow-y-auto border rounded p-2 bg-gray-50 dark:bg-gray-800">
        {#each platformLogs.slice().reverse() as log}
          <div class="text-xs border-l-2 pl-2 mb-2 last:mb-0
            {log.level === 'error' ? 'border-red-500' :
             log.level === 'warn' ? 'border-yellow-500' :
             log.level === 'info' ? 'border-blue-500' : 'border-gray-500'}">
            <div class="flex justify-between items-start mb-1">
              <span class="font-medium text-muted-foreground">{log.timestamp.toLocaleTimeString()}</span>
              <span class={`px-1 py-0.5 text-xs rounded ${
                log.level === 'error' ? 'bg-red-100 text-red-800' :
                log.level === 'warn' ? 'bg-yellow-100 text-yellow-800' :
                log.level === 'info' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {log.level}
              </span>
            </div>
            <div class="mb-1">{log.message}</div>
            {#if log.data}
              <details class="text-xs">
                <summary class="cursor-pointer text-muted-foreground hover:text-foreground">Show data</summary>
                <pre class="text-xs bg-gray-100 dark:bg-gray-700 p-1 rounded mt-1 overflow-x-auto">{JSON.stringify(log.data, null, 2)}</pre>
              </details>
            {/if}
          </div>
        {/each}
        {#if platformLogs.length === 0}
          {#if !isEnabled}
            <div class="text-xs text-muted-foreground text-center py-8">
              <div class="mb-2">🐛 Floating Debugger is currently disabled</div>
              <div class="text-xs">
                To enable: Add <code class="bg-gray-100 px-1 rounded">?debug=1</code> to URL,<br>
                or set <code class="bg-gray-100 px-1 rounded">localStorage.setItem('debug_enabled', 'true')</code>
              </div>
            </div>
          {:else}
            <div class="text-xs text-muted-foreground text-center py-8">
              No platform logs yet. Logs will appear here as the platform initializes and operates.
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  pre {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
