<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { centralizedAuth } from '../stores/unifiedAuth';
  import { settingsStore, settingsActions, profileStore } from '../stores/settingsStore';
  import { sessionStore } from '../stores/sessionStore';
  import { cacheManager, cacheStats } from '../stores/cacheManager';
  import { dataStore, dataActions } from '../stores/dataStore';
  import { loadingStore } from '../stores/loadingStore';
  import { iapStore } from '../stores/iapStore';
  import { invoke } from '@tauri-apps/api/core';
  import { Badge } from './ui/badge';

  let isVisible = false;
  let isDragging = false;
  let position = { x: 20, y: 20 };
  let dragStart = { x: 0, y: 0 };
  let activeTab = 'auth';

  // Store states
  let authState: any = {};
  let settingsState: any = {};
  let sessionState: any = {};
  let cacheState: any = {};
  let dataState: any = {};
  let loadingState: any = {};
  let iapState: any = {};
  let profileState: any = {};

  // Database data
  let databaseStatus: any = null;
  let databaseProfile: any = null;
  let databasePaymentMethods: any = null;
  let databaseError: string | null = null;

  // Subscriptions
  let unsubscribes: (() => void)[] = [];

  // Detect if we're on mobile
  let isMobile = false;

  onMount(() => {
    // Subscribe to all stores
    unsubscribes = [
      centralizedAuth.subscribe(state => authState = state),
      settingsStore.subscribe(state => settingsState = state),
      sessionStore.subscribe(state => sessionState = state),
      cacheStats.subscribe(state => cacheState = state),
      dataStore.subscribe(state => dataState = state),
      loadingStore.subscribe(state => loadingState = state),
      iapStore.subscribe(state => iapState = state),
      profileStore.subscribe(state => profileState = state)
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
    unsubscribes.forEach(unsub => unsub());
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

  async function checkDatabaseStatus() {
    try {
      databaseError = null;
      databaseStatus = await invoke('get_database_status');
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Database check failed';
      databaseStatus = null;
    }
  }

  async function loadDatabaseProfile() {
    try {
      databaseError = null;
      const userId = authState.user?.id;
      if (!userId) {
        databaseError = 'No authenticated user';
        return;
      }
      databaseProfile = await invoke('get_user_profile', { userId });
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Profile load failed';
      databaseProfile = null;
    }
  }

  async function loadDatabasePaymentMethods() {
    try {
      databaseError = null;
      const userId = authState.user?.id;
      if (!userId) {
        databaseError = 'No authenticated user';
        return;
      }
      // Payment methods functionality removed - no longer in database schema
      databaseError = 'Payment methods functionality removed from database schema';
      databasePaymentMethods = null;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Payment methods load failed';
      databasePaymentMethods = null;
    }
  }

  async function clearCache() {
    try {
      cacheManager.clear();
      databaseError = null;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Cache clear failed';
    }
  }

  async function reinitializeAuth() {
    try {
      databaseError = null;
      await centralizedAuth.reinitialize();
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Auth reinitialize failed';
    }
  }

  async function refreshProfile() {
    try {
      databaseError = null;
      const userId = authState.user?.id;
      if (!userId) {
        databaseError = 'No authenticated user';
        return;
      }
      
      console.log('🔄 Refreshing profile for:', userId);
      await settingsActions.loadProfile(true);
      console.log('✅ Profile refreshed');
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Profile refresh failed';
      console.error('❌ Profile refresh failed:', error);
    }
  }

  async function testDataStore() {
    try {
      databaseError = null;
      const userId = authState.user?.id;
      if (!userId) {
        databaseError = 'No authenticated user';
        return;
      }
      
      console.log('🔄 Testing data store operations for:', userId);
      const profile = await dataActions.getUserProfile(userId);
      console.log('✅ Data store returned profile:', profile);
      databaseProfile = { dataStoreResult: profile }; // Show in UI
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Data store test failed';
      console.error('❌ Data store test failed:', error);
    }
  }

  async function debugDatabaseSchema() {
    try {
      databaseError = null;
      console.log('🔄 Checking database status...');
      const result = await invoke('get_database_status');
      console.log('✅ Database status check result:', result);
      databaseProfile = { statusCheck: result }; // Show in UI
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Database status check failed';
      console.error('❌ Database status check failed:', error);
    }
  }

  async function initializeStores() {
    try {
      databaseError = null;
      console.log('🔄 Initializing all stores...');
      await dataActions.initialize();
      await settingsActions.initialize();
      console.log('✅ Store initialization completed');
      databaseProfile = { storeInit: 'completed' }; // Show in UI
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Store initialization failed';
      console.error('❌ Store initialization failed:', error);
    }
  }

  function formatJson(obj: any) {
    if (obj === null || obj === undefined) return 'null';
    return JSON.stringify(obj, null, 2);
  }

  function getStatusColor(status: any) {
    if (status === true || status === 'complete' || status === 'active') return 'bg-green-500';
    if (status === false || status === 'error' || status === 'failed') return 'bg-red-500';
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

<!-- Debug Toggle Button (always visible) -->
<button
  class="fixed top-4 right-4 z-[9999] bg-purple-600 hover:bg-purple-700 text-white rounded-full w-10 h-10 flex items-center justify-center font-mono text-sm shadow-lg"
  on:click={toggleDebugger}
  title="Toggle Debugger (Ctrl+Shift+D)"
>
  🐛
</button>

{#if isVisible}
  <!-- Floating Debugger Window -->
  <div
    class="fixed z-[9998] bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-2xl overflow-hidden
           max-w-2xl max-h-[80vh] 
           sm:min-w-[500px]
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
      <h3 class="font-semibold">🐛 Store Debugger</h3>
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

    <!-- Tab Navigation -->
    <div class="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      {#each [
        { id: 'auth', label: 'Auth', color: getStatusColor(authState.isAuthenticated) },
        { id: 'profile', label: 'Profile', color: getStatusColor(profileState.profile) },
        { id: 'stores', label: 'Stores', color: getStatusColor(settingsState.isInitialized) },
        { id: 'cache', label: 'Cache', color: getStatusColor(cacheState.size > 0) },
        { id: 'database', label: 'Database', color: 'bg-blue-500' }
      ] as tab}
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
            {activeTab === tab.id 
              ? 'border-purple-500 text-purple-600 dark:text-purple-400' 
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}"
          on:click={() => activeTab = tab.id}
        >
          <div class="w-2 h-2 rounded-full {tab.color}"></div>
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- Content -->
    <div class="p-4 overflow-auto max-h-96 max-sm:max-h-[calc(100vh-12rem)]">
      {#if activeTab === 'auth'}
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
            <Badge variant={authState.isAuthenticated ? 'default' : 'secondary'}>
              Authenticated: {authState.isAuthenticated}
            </Badge>
            <Badge variant={authState.isInitialized ? 'default' : 'secondary'}>
              Initialized: {authState.isInitialized}
            </Badge>
          </div>
          
          <div class="space-y-2">
            <h4 class="font-semibold text-sm">User:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-32">
{formatJson(authState.user ? { id: authState.user.id, email: authState.user.email } : null)}
            </pre>
          </div>

          <div class="space-y-2">
            <h4 class="font-semibold text-sm">Profile:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-32">
{formatJson(authState.profile)}
            </pre>
          </div>

          <div class="flex gap-2">
            <button class="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600" on:click={reinitializeAuth}>Reinitialize Auth</button>
          </div>
        </div>

      {:else if activeTab === 'profile'}
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Badge variant={profileState.profile ? 'default' : 'secondary'}>
              Has Profile: {!!profileState.profile}
            </Badge>
            <Badge variant={profileState.loading ? 'secondary' : 'default'}>
              Loading: {profileState.loading}
            </Badge>
            <Badge variant={profileState.error ? 'destructive' : 'default'}>
              Status: {profileState.error ? 'Error' : 'OK'}
            </Badge>
          </div>
          
          <div class="space-y-2">
            <h4 class="font-semibold text-sm">Profile Data:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson(profileState.profile)}
            </pre>
          </div>

          <div class="space-y-2">
            <h4 class="font-semibold text-sm">IAP State:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson({
  isInitialized: iapState.isInitialized,
  canMakePayments: iapState.canMakePayments,
  products: iapState.products?.length || 0,
  purchases: iapState.purchases?.length || 0,
  error: iapState.error
})}
            </pre>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button class="px-3 py-2 text-sm bg-purple-500 text-white rounded hover:bg-purple-600" on:click={refreshProfile}>Refresh Profile</button>
            <button class="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600" on:click={() => settingsActions.initialize()}>Init Settings</button>
            <button class="px-3 py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600" on:click={testDataStore}>Test Data Store</button>
            <button class="px-3 py-2 text-sm bg-orange-500 text-white rounded hover:bg-orange-600" on:click={debugDatabaseSchema}>Check Status</button>
            <button class="px-3 py-2 text-sm bg-teal-500 text-white rounded hover:bg-teal-600" on:click={initializeStores}>Init Stores</button>
          </div>
        </div>

      {:else if activeTab === 'stores'}
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Badge variant={settingsState.isInitialized ? 'default' : 'secondary'}>
              Settings: {settingsState.isInitialized}
            </Badge>
            <Badge variant={dataState.isInitialized ? 'default' : 'secondary'}>
              Data: {dataState.isInitialized}
            </Badge>
            <Badge variant={sessionState.isAuthenticated ? 'default' : 'secondary'}>
              Session: {sessionState.isAuthenticated}
            </Badge>
          </div>

          <div class="space-y-2">
            <h4 class="font-semibold text-sm">Settings Store:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson({
  profile: !!settingsState.profile,
  profileLoading: settingsState.profileLoading,
  profileError: settingsState.profileError,
  isInitialized: settingsState.isInitialized
})}
            </pre>
          </div>

          <div class="space-y-2">
            <h4 class="font-semibold text-sm">Data Store:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson({
  isInitialized: dataState.isInitialized,
  isLoading: dataState.isLoading,
  error: dataState.error,
  lastSync: dataState.lastSync
})}
            </pre>
          </div>

          <div class="space-y-2">
            <h4 class="font-semibold text-sm">Loading State:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson({
  isLoading: loadingState.isLoading,
  message: loadingState.message,
  type: loadingState.type,
  progress: loadingState.progress
})}
            </pre>
          </div>
        </div>

      {:else if activeTab === 'cache'}
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Badge>Size: {cacheState.size || 0}</Badge>
            <Badge>Hits: {cacheState.hits || 0}</Badge>
            <Badge>Misses: {cacheState.misses || 0}</Badge>
          </div>

          <div class="space-y-2">
            <h4 class="font-semibold text-sm">Cache Stats:</h4>
            <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson({
  ...cacheState,
  hitRate: `${((cacheState.hitRate || 0) * 100).toFixed(1)}%`
})}
            </pre>
          </div>

          <div class="flex gap-2">
            <button class="px-3 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600" on:click={clearCache}>Clear Cache</button>
          </div>
        </div>

      {:else if activeTab === 'database'}
        <div class="space-y-3">
          <div class="flex flex-col sm:flex-row gap-2">
            <button class="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600" on:click={checkDatabaseStatus}>Check DB Status</button>
            <button class="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600" on:click={loadDatabaseProfile}>Load Profile</button>
            <button class="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600" on:click={loadDatabasePaymentMethods}>Load Payment Methods</button>
          </div>

          {#if databaseError}
            <div class="p-2 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded text-sm text-red-700 dark:text-red-300">
              {databaseError}
            </div>
          {/if}

          {#if databaseStatus}
            <div class="space-y-2">
              <h4 class="font-semibold text-sm">Database Status:</h4>
              <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson(databaseStatus)}
              </pre>
            </div>
          {/if}

          {#if databaseProfile}
            <div class="space-y-2">
              <h4 class="font-semibold text-sm">Database Profile:</h4>
              <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson(databaseProfile)}
              </pre>
            </div>
          {/if}

          {#if databasePaymentMethods}
            <div class="space-y-2">
              <h4 class="font-semibold text-sm">Database Payment Methods:</h4>
              <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-24">
{formatJson(databasePaymentMethods)}
              </pre>
            </div>
          {/if}
        </div>
      {/if}
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
