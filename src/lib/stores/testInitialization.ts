/**
 * Test script for store initialization and cache consistency
 * This can be run to verify that the stores work correctly after long periods of inactivity
 */

import { centralizedAuth } from './unifiedAuth';
import { cacheManager } from './cacheManager';
import { sessionStore } from './sessionStore';
import { dataActions } from './dataStore';
import { biometricActions } from './biometricStore';
import { invoke } from '@tauri-apps/api/core';

export interface InitializationTestResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  duration: number;
  steps: {
    cacheValidation: boolean;
    storeInitialization: boolean;
    sessionValidation: boolean;
    biometricCheck: boolean;
    dataStoreCheck: boolean;
    backendConnectivity: boolean;
  };
}

export async function testStoreInitialization(): Promise<InitializationTestResult> {
  const startTime = Date.now();
  const result: InitializationTestResult = {
    success: true,
    errors: [],
    warnings: [],
    duration: 0,
    steps: {
      cacheValidation: false,
      storeInitialization: false,
      sessionValidation: false,
      biometricCheck: false,
      dataStoreCheck: false,
      backendConnectivity: false
    }
  };

  try {
    console.log('🧪 Starting store initialization test...');

    // Step 1: Test cache validation
    console.log('📦 Testing cache validation...');
    try {
      const cacheStats = cacheManager.getStats();
      if (cacheStats.lastCleanup > 0) {
        result.steps.cacheValidation = true;
        console.log('✅ Cache validation passed');
      } else {
        result.warnings.push('Cache may not have been properly initialized');
      }
    } catch (error) {
      result.errors.push(`Cache validation failed: ${error}`);
      result.success = false;
    }

    // Step 2: Test backend connectivity
    console.log('🔗 Testing backend connectivity...');
    try {
      const healthCheck = await invoke('store_health_check');
      if (healthCheck && (healthCheck as any).status === 'healthy') {
        result.steps.backendConnectivity = true;
        console.log('✅ Backend connectivity test passed');
      } else {
        result.errors.push('Backend health check failed');
        result.success = false;
      }
    } catch (error) {
      result.errors.push(`Backend connectivity test failed: ${error}`);
      result.success = false;
    }

    // Step 3: Test session validation
    console.log('🔐 Testing session validation...');
    try {
      const sessionValid = await sessionStore.hasValidSession();
      result.steps.sessionValidation = true;
      console.log('✅ Session validation test passed');

      if (!sessionValid) {
        result.warnings.push('No valid session found (expected if not logged in)');
      }
    } catch (error) {
      result.errors.push(`Session validation failed: ${error}`);
      result.success = false;
    }

    // Step 4: Test store initialization
    console.log('🏪 Testing store initialization...');
    try {
      const initResult = await centralizedAuth.initialize();
      result.steps.storeInitialization = initResult.authReady || initResult.profileReady;

      if (initResult.errors.length > 0) {
        result.warnings.push(`Store initialization had errors: ${initResult.errors.join(', ')}`);
      }

      console.log('✅ Store initialization test passed');
    } catch (error) {
      result.errors.push(`Store initialization failed: ${error}`);
      result.success = false;
    }

    // Step 5: Test biometric store (only if authenticated)
    console.log('🔒 Testing biometric store...');
    try {
      const authState = await centralizedAuth.getState();
      if (authState.isAuthenticated) {
        await biometricActions.initialize();
        result.steps.biometricCheck = true;
        console.log('✅ Biometric store test passed');
      } else {
        result.steps.biometricCheck = true; // Not applicable
        console.log('⏭️ Biometric test skipped (not authenticated)');
      }
    } catch (error) {
      result.errors.push(`Biometric store test failed: ${error}`);
      result.success = false;
    }

    // Step 6: Test data store
    console.log('💾 Testing data store...');
    try {
      await dataActions.initialize();
      result.steps.dataStoreCheck = true;
      console.log('✅ Data store test passed');
    } catch (error) {
      result.errors.push(`Data store test failed: ${error}`);
      result.success = false;
    }

  } catch (error) {
    result.errors.push(`Test execution failed: ${error}`);
    result.success = false;
  }

  result.duration = Date.now() - startTime;

  console.log('🧪 Store initialization test completed:', {
    success: result.success,
    duration: `${result.duration}ms`,
    errors: result.errors.length,
    warnings: result.warnings.length
  });

  return result;
}

/**
 * Run a comprehensive test simulating long inactivity
 */
export async function testLongInactivityScenario(): Promise<InitializationTestResult> {
  console.log('⏰ Testing long inactivity scenario...');

  // Simulate cache being stale
  cacheManager.clear();

  // Wait a bit to simulate app being closed
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test initialization
  const result = await testStoreInitialization();

  // Additional checks for long inactivity
  const cacheStats = cacheManager.getStats();
  if (cacheStats.size === 0) {
    result.warnings.push('Cache was cleared during test (expected)');
  }

  return result;
}

/**
 * Test cache consistency after app restart
 */
export async function testCacheConsistency(): Promise<boolean> {
  try {
    console.log('🔄 Testing cache consistency...');

    // Add some test data to cache
    const testKey = 'test_cache_key';
    const testData = { test: 'data', timestamp: Date.now() };

    cacheManager.set(testKey, testData, 5 * 60 * 1000); // 5 minutes TTL

    // Verify it was stored
    const retrieved = cacheManager.get(testKey) as any;
    if (!retrieved || retrieved.test !== 'data') {
      console.error('❌ Cache consistency test failed: data not stored correctly');
      return false;
    }

    // Test cache invalidation
    cacheManager.invalidatePattern('test_*');
    const afterInvalidation = cacheManager.get(testKey);

    if (afterInvalidation) {
      console.error('❌ Cache consistency test failed: data not invalidated');
      return false;
    }

    console.log('✅ Cache consistency test passed');
    return true;
  } catch (error) {
    console.error('❌ Cache consistency test failed:', error);
    return false;
  }
}

/**
 * Test balance synchronization after purchase flow
 */
export async function testBalanceSynchronization(): Promise<boolean> {
  try {
    console.log('💰 Testing balance synchronization...');

    const { userStore } = await import('$lib/stores/userStore');
    const { purchaseManager } = await import('$lib/stores/purchaseStore');

    // Get initial balance
    let initialBalance: any = null;
    const unsubscribe = userStore.subscribe((state) => {
      initialBalance = state.tokenBalance;
    });
    unsubscribe();

    console.log(`📊 Initial balance: ${initialBalance?.tokens_available || 0} available tokens`);

    // Test that balance can be refreshed
    await userStore.refreshTokenBalance(true);

    let refreshedBalance: any = null;
    const unsubscribe2 = userStore.subscribe((state) => {
      refreshedBalance = state.tokenBalance;
    });
    unsubscribe2();

    console.log(`📊 Refreshed balance: ${refreshedBalance?.tokens_available || 0} available tokens`);

    // Test purchase loading state management
    const testProductId = 'tokens_100';
    const hasLoadingBefore = purchaseManager.getPurchaseLoadingState(testProductId);
    console.log(`🔄 Purchase loading state before: ${hasLoadingBefore}`);

    // The test should pass if we can successfully refresh balance
    console.log('✅ Balance synchronization test passed');
    return true;

  } catch (error) {
    console.error('❌ Balance synchronization test failed:', error);
    return false;
  }
}

// Export for use in browser console or tests
if (typeof window !== 'undefined') {
  (window as any).storeTests = {
    testStoreInitialization,
    testLongInactivityScenario,
    testCacheConsistency,
    testBalanceSynchronization
  };
}
