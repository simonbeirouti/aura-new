import { invoke } from '@tauri-apps/api/core';
import type { Purchase, Transaction } from '$lib/stores/iapStore';
import { iapProductConfig, iapStore } from '$lib/stores/iapStore';
import { get } from 'svelte/store';

export interface IAPTransactionRecord {
  id: string;
  user_id: string;
  transaction_id: string;
  product_id: string;
  product_type: 'subscription' | 'consumable';
  purchase_token: string;
  order_id?: string;
  package_name?: string;
  purchase_time: string;
  purchase_state: number;
  signature?: string;
  original_json?: any;
  is_acknowledged: boolean;
}

export interface UserSubscriptionRecord {
  id?: string;
  user_id: string;
  iap_transaction_id: string;
  product_id: string;
  subscription_status: 'active' | 'expired' | 'cancelled' | 'pending';
  start_date: string; // ISO timestamp
  expiry_time?: string;
  renewal_date?: string;
  cancellation_date?: string;
  is_auto_renewing: boolean;
}

export interface TokenTransactionRecord {
  id?: string;
  user_id: string;
  iap_transaction_id?: string;
  transaction_type: 'purchase' | 'usage' | 'refund' | 'bonus';
  token_amount: number;
  description?: string;
  product_id?: string;
  feature_used?: string;
}

/**
 * Save IAP transaction to database with localized pricing
 */
export async function saveIAPTransaction(
  userId: string,
  purchase: Purchase,
  transaction: Transaction,
  productType: 'subscription' | 'consumable',
  storeProduct?: any // Optional store product with localized pricing
): Promise<string> {
  try {
    const transactionData: Omit<IAPTransactionRecord, 'id'> = {
      user_id: userId,
      transaction_id: transaction.transactionId,
      product_id: purchase.productId,
      product_type: productType,
      purchase_token: purchase.purchaseToken,
      order_id: purchase.orderId,
      package_name: purchase.packageName,
      purchase_time: new Date(purchase.purchaseTime || Date.now()).toISOString(),
      purchase_state: purchase.purchaseState,
      signature: purchase.signature,
      original_json: purchase.originalJson ? JSON.parse(purchase.originalJson) : null,
      is_acknowledged: purchase.isAcknowledged || false
    };

    const result = await invoke('save_iap_transaction', { transaction: transactionData });
    return result as string; // Returns the transaction ID
  } catch (error) {
    throw error;
  }
}

/**
 * Save subscription record to database
 */
export async function saveSubscription(
  userId: string,
  transactionId: string,
  purchase: Purchase
): Promise<void> {
  try {
    const startDate = new Date(purchase.purchaseTime || Date.now());
    
    // Calculate expiry and renewal dates based on product type
    let expiryDate: Date | undefined;
    let renewalDate: Date | undefined;
    
    if (purchase.productId.includes('monthly')) {
      // Monthly subscription - expires in 1 month
      expiryDate = new Date(startDate);
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      
      // Renewal date is same as expiry for auto-renewing subscriptions
      renewalDate = new Date(expiryDate);
    } else if (purchase.productId.includes('yearly')) {
      // Yearly subscription - expires in 1 year
      expiryDate = new Date(startDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      
      // Renewal date is same as expiry for auto-renewing subscriptions
      renewalDate = new Date(expiryDate);
    }
    
    // Use platform-provided dates if available, otherwise use calculated dates
    const finalExpiryTime = purchase.expiryTime 
      ? new Date(purchase.expiryTime).toISOString()
      : expiryDate?.toISOString();
      
    const finalRenewalDate = purchase.renewalDate 
      ? new Date(purchase.renewalDate).toISOString()
      : renewalDate?.toISOString();

    const subscriptionRecord: UserSubscriptionRecord = {
      user_id: userId,
      iap_transaction_id: transactionId,
      product_id: purchase.productId,
      subscription_status: purchase.subscriptionStatus || 'active',
      start_date: startDate.toISOString(),
      expiry_time: finalExpiryTime,
      renewal_date: finalRenewalDate,
      // Only set cancellation_date if the subscription is actually cancelled
      cancellation_date: (purchase.subscriptionStatus === 'cancelled' && purchase.cancellationDate) 
        ? new Date(purchase.cancellationDate).toISOString() 
        : undefined,
      is_auto_renewing: purchase.isAutoRenewing !== false // Default to true unless explicitly false
    };

    await invoke('save_user_subscription', { subscription: subscriptionRecord });
  } catch (error) {
    throw error;
  }
}

/**
 * Save token transaction (for consumable purchases)
 */
export async function saveTokenTransaction(
  userId: string,
  iapTransactionId: string,
  productId: string,
  tokenAmount: number,
  description?: string
): Promise<void> {
  try {
    const tokenRecord: TokenTransactionRecord = {
      user_id: userId,
      iap_transaction_id: iapTransactionId,
      transaction_type: 'purchase',
      token_amount: tokenAmount,
      description: description || `Token purchase: ${productId}`,
      product_id: productId
    };

    await invoke('save_token_transaction', { tokenTransaction: tokenRecord });
  } catch (error) {
    throw error;
  }
}

/**
 * Get token amount for a product ID
 */
export function getTokenAmountForProduct(productId: string): number {
  const product = iapProductConfig.consumables.find(p => p.id === productId);
  if (!product) return 0;
  
  // Extract number from tokens string (e.g., "1,000" -> 1000)
  return parseInt(product.tokens.replace(/,/g, ''));
}

/**
 * Process successful IAP purchase and save to database
 */
export async function processSuccessfulPurchase(
  userId: string,
  purchase: Purchase,
  transaction: Transaction,
  productType: 'subscription' | 'consumable',
  storeProduct?: any // Optional store product with localized pricing
): Promise<void> {
  try {
    // Save the main IAP transaction with localized pricing
    const transactionId = await saveIAPTransaction(userId, purchase, transaction, productType, storeProduct);

    if (productType === 'subscription') {
      // Save subscription record
      await saveSubscription(userId, transactionId, purchase);
    } else if (productType === 'consumable') {
      // Save token transaction
      const tokenAmount = getTokenAmountForProduct(purchase.productId);
      
      if (tokenAmount > 0) {
        await saveTokenTransaction(
          userId,
          transactionId,
          purchase.productId,
          tokenAmount,
          `Purchased ${tokenAmount} tokens`
        );
      } else {
        throw new Error(`No token amount configured for product: ${purchase.productId}`);
      }
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Get user's current token balance
 */
export async function getUserTokenBalance(userId: string): Promise<{
  total_tokens: number;
  tokens_used: number;
  tokens_available: number;
}> {
  try {
    const result = await invoke('get_user_token_balance', { userId });
    return result as any;
  } catch (error) {
    return { total_tokens: 0, tokens_used: 0, tokens_available: 0 };
  }
}

/**
 * Get user's active subscriptions
 */
export async function getUserSubscriptions(userId: string): Promise<UserSubscriptionRecord[]> {
  try {
    const result = await invoke('get_user_subscriptions', { userId });
    return result as UserSubscriptionRecord[];
  } catch (error) {
    return [];
  }
}

/**
 * Get user's active subscriptions with IAP sync
 */
export async function getUserSubscriptionsWithSync(userId: string): Promise<UserSubscriptionRecord[]> {
  try {
    // Get subscriptions from database
    const subscriptions = await getUserSubscriptions(userId);
    
    // If IAP store is ready, sync in background
    if (isIAPStoreReady()) {
      // Don't await - let it run in background
      syncSubscriptionsWithIAP(userId).catch(() => {
        // Background sync failed - ignore silently
      });
    }
    
    return subscriptions;
  } catch (error) {
    return [];
  }
}

/**
 * Update subscription status (for periodic checks)
 */
export async function updateSubscriptionStatus(
  subscriptionId: string,
  status: 'active' | 'expired' | 'cancelled' | 'pending',
  expiryTime?: Date
): Promise<void> {
  try {
    await invoke('update_subscription_status', {
      subscriptionId,
      status,
      expiryTime: expiryTime?.toISOString()
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Use tokens (deduct from balance)
 */
export async function useTokens(
  userId: string,
  amount: number,
  featureUsed: string,
  description?: string
): Promise<boolean> {
  try {
    const tokenRecord: TokenTransactionRecord = {
      user_id: userId,
      transaction_type: 'usage',
      token_amount: -amount, // Negative for usage
      description: description || `Used ${amount} tokens for ${featureUsed}`,
      feature_used: featureUsed
    };

    await invoke('save_token_transaction', { tokenTransaction: tokenRecord });
    return true;
  } catch (error) {
    return false;
  }
}

// Track ongoing sync operations to prevent duplicates
const ongoingSyncs = new Set<string>();

/**
 * Check if a transaction already exists in the database
 * This is critical for preventing double charging
 */
export async function checkTransactionExists(
  userId: string,
  transactionId: string,
  purchaseToken: string
): Promise<boolean> {
  try {
    const result = await invoke<boolean>('check_transaction_exists', {
      userId,
      transactionId,
      purchaseToken
    });

    return result;
  } catch (error) {
    // On error, we should be conservative and assume it might exist to prevent double charging
    // Return true to skip processing if we're unsure
    return true;
  }
}

export async function getUserIAPTransactions(userId: string): Promise<IAPTransactionRecord[]> {
  try {
    const result = await invoke<IAPTransactionRecord[]>('get_user_iap_transactions', {
      userId
    });
    return result;
  } catch (error) {
    return [];
  }
}

/**
 * Sync database subscriptions with IAP store data
 * Detects cancelled/expired subscriptions and updates database
 * Prevents duplicate transactions with proper deduplication
 */
export async function syncSubscriptionsWithIAP(userId: string): Promise<{
  updated: number;
  errors: string[];
}> {
  const result = { updated: 0, errors: [] as string[] };
  
  // Prevent concurrent syncs for the same user
  const syncKey = `sync_${userId}`;
  if (ongoingSyncs.has(syncKey)) {
    return result;
  }
  
  ongoingSyncs.add(syncKey);
  
  try {
    // Get current database subscriptions
    const dbSubscriptions = await getUserSubscriptions(userId);
    
    // Get current IAP store subscriptions
    const iapState = get(iapStore);
    const iapSubscriptions = iapState.activeSubscriptions;
    
    // Check for subscriptions that exist in DB but not in IAP (cancelled/expired)
    // Only mark as expired if we have a valid expiry time that has passed
    for (const dbSub of dbSubscriptions) {
      if (dbSub.subscription_status !== 'active') continue;
      
      const iapSub = iapSubscriptions.find(iap => iap.productId === dbSub.product_id);
      
      if (!iapSub) {
        // Check if subscription has actually expired based on expiry time
        const now = Date.now();
        const expiryTime = dbSub.expiry_time ? new Date(dbSub.expiry_time).getTime() : null;
        
        // Only mark as expired if we have an expiry time and it has passed
        if (expiryTime && expiryTime < now) {
          try {
            await invoke('update_subscription_status', {
              subscriptionId: dbSub.id,
              status: 'expired',
              expiryTime: new Date().toISOString()
            });
            
            result.updated++;
          } catch (error) {
            const errorMsg = `Failed to update ${dbSub.product_id}: ${error}`;
            result.errors.push(errorMsg);
          }
        }
        // If no expiry time or not yet expired, leave as active
        // The IAP store might just not be fully loaded yet
      }
    }
    
    // Check for subscriptions that exist in IAP but not in DB, or need updating
    for (const iapSub of iapSubscriptions) {
      const dbSub = dbSubscriptions.find(db => 
        db.product_id === iapSub.productId
      );
      
      if (!dbSub) {
        // Subscription exists in IAP but not in DB - need to create database entry
        try {
          // Generate unique identifiers to prevent duplicates
          const timestamp = Date.now();
          const uniqueId = `${userId.slice(-8)}_${iapSub.productId}_${timestamp}`;
          const transactionId = `sync_${uniqueId}`;
          const purchaseToken = `iap_sync_${uniqueId}`;
          
          // Check if this transaction already exists
          const exists = await checkTransactionExists(userId, transactionId, purchaseToken);
          if (exists) {
            continue;
          }
          
          // Create a mock purchase object from IAP subscription data
          const mockPurchase = {
            productId: iapSub.productId,
            purchaseTime: timestamp,
            subscriptionStatus: iapSub.subscriptionStatus || 'active',
            expiryTime: iapSub.expiryTime,
            renewalDate: iapSub.renewalDate,
            isAutoRenewing: iapSub.isAutoRenewing !== false,
            purchaseToken,
            purchaseState: 1, // Purchased
            isAcknowledged: true
          };
          
          // Create a mock transaction
          const mockTransaction = {
            transactionId,
            productId: iapSub.productId,
            status: 'purchased'
          };
          
          // Save the subscription to database
          const savedTransactionId = await saveIAPTransaction(userId, mockPurchase as any, mockTransaction as any, 'subscription');
          await saveSubscription(userId, savedTransactionId, mockPurchase as any);
          
          result.updated++;
        } catch (error) {
          // Check if this is a duplicate constraint error
          if (error && typeof error === 'object' && 'message' in error) {
            const errorMessage = (error as any).message || '';
            if (errorMessage.includes('23505') || errorMessage.includes('duplicate') || errorMessage.includes('unique constraint')) {
              continue; // Skip this one, it's already been processed
            }
          }
          
          const errorMsg = `Failed to add ${iapSub.productId}: ${error}`;
          result.errors.push(errorMsg);
        }
      } else {
        // Subscription exists in both IAP and DB - check if data needs updating
        const needsUpdate = checkSubscriptionNeedsUpdate(dbSub, iapSub);
        
        if (needsUpdate.hasChanges) {
          try {
            // Update the existing subscription with new data
            await invoke('update_subscription_data', {
              subscriptionId: dbSub.id,
              status: iapSub.subscriptionStatus || 'active',
              expiryTime: iapSub.expiryTime ? new Date(iapSub.expiryTime).toISOString() : null,
              renewalDate: iapSub.renewalDate ? new Date(iapSub.renewalDate).toISOString() : null,
              isAutoRenewing: iapSub.isAutoRenewing !== false
            });
            
            result.updated++;
          } catch (error) {
            const errorMsg = `Failed to update ${iapSub.productId}: ${error}`;
            result.errors.push(errorMsg);
          }
        }
      }
    }
    
    return result;
  } catch (error) {
    const errorMsg = `Sync failed: ${error}`;
    result.errors.push(errorMsg);
    return result;
  } finally {
    // Always remove the sync lock
    ongoingSyncs.delete(syncKey);
  }
}

/**
 * Check if a subscription needs updating by comparing database and IAP data
 */
function checkSubscriptionNeedsUpdate(
  dbSub: UserSubscriptionRecord,
  iapSub: any
): { hasChanges: boolean; changes: string[] } {
  const changes: string[] = [];
  
  // Compare subscription status
  const iapStatus = iapSub.subscriptionStatus || 'active';
  if (dbSub.subscription_status !== iapStatus) {
    changes.push(`status: ${dbSub.subscription_status} → ${iapStatus}`);
  }
  
  // Compare expiry time (convert timestamps to ISO strings for comparison)
  const dbExpiryTime = dbSub.expiry_time;
  const iapExpiryTime = iapSub.expiryTime ? new Date(iapSub.expiryTime).toISOString() : null;
  if (dbExpiryTime !== iapExpiryTime) {
    changes.push(`expiryTime: ${dbExpiryTime} → ${iapExpiryTime}`);
  }
  
  // Compare renewal date
  const dbRenewalDate = dbSub.renewal_date;
  const iapRenewalDate = iapSub.renewalDate ? new Date(iapSub.renewalDate).toISOString() : null;
  if (dbRenewalDate !== iapRenewalDate) {
    changes.push(`renewalDate: ${dbRenewalDate} → ${iapRenewalDate}`);
  }
  
  // Compare auto-renewing status
  const dbAutoRenewing = dbSub.is_auto_renewing;
  const iapAutoRenewing = iapSub.isAutoRenewing !== false;
  if (dbAutoRenewing !== iapAutoRenewing) {
    changes.push(`autoRenewing: ${dbAutoRenewing} → ${iapAutoRenewing}`);
  }
  
  return {
    hasChanges: changes.length > 0,
    changes
  };
}

/**
 * Check if IAP store is ready for sync operations
 */
export function isIAPStoreReady(): boolean {
  const iapState = get(iapStore);
  return iapState.isInitialized && !iapState.isLoading;
}
