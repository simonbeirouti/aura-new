import { invoke } from '@tauri-apps/api/core';
import type { Purchase, Transaction } from '$lib/stores/iapStore';
import { iapProductConfig } from '$lib/stores/iapStore';

export interface IAPTransactionRecord {
  id?: string;
  user_id: string;
  transaction_id: string;
  product_id: string;
  product_type: 'subscription' | 'consumable';
  purchase_token: string;
  order_id?: string;
  package_name?: string;
  purchase_time: string; // ISO timestamp
  purchase_state: number;
  signature?: string;
  original_json?: any;
  is_acknowledged: boolean;
}

export interface UserSubscriptionRecord {
  id?: string;
  user_id: string;
  transaction_id: string;
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
 * Save IAP transaction to database
 */
export async function saveIAPTransaction(
  userId: string,
  purchase: Purchase,
  transaction: Transaction,
  productType: 'subscription' | 'consumable'
): Promise<string> {
  try {
    const transactionRecord: IAPTransactionRecord = {
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

    const result = await invoke('save_iap_transaction', { transaction: transactionRecord });
    return result as string; // Returns the transaction ID
  } catch (error) {
    console.error('Failed to save IAP transaction:', error);
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
      transaction_id: transactionId,
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
    console.error('Failed to save subscription:', error);
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
    console.error('Failed to save token transaction:', error);
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
  productType: 'subscription' | 'consumable'
): Promise<void> {
  try {
    // Save the main IAP transaction
    const transactionId = await saveIAPTransaction(userId, purchase, transaction, productType);

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
    console.error(`Failed to process ${productType} purchase:`, error);
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
    console.error('Failed to get user token balance:', error);
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
    console.error('Failed to get user subscriptions:', error);
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
    console.error('Failed to update subscription status:', error);
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
    console.error('Failed to use tokens:', error);
    return false;
  }
}
