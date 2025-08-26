import { supabase } from '../stores/unifiedAuth';

export interface UploadResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

export interface StorageFile {
  name: string;
  id: string;
  updated_at: string;
  created_at: string;
  last_accessed_at: string;
  metadata: Record<string, any>;
}

/**
 * Upload an avatar image to Supabase Storage
 */
export async function uploadAvatar(
  file: File, 
  userId: string
): Promise<UploadResult> {
  try {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      return {
        success: false,
        error: 'Please select an image file'
      };
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return {
        success: false,
        error: 'Image must be smaller than 5MB'
      };
    }

    // Create unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // Validate the URL format
    if (!publicUrl || !publicUrl.startsWith('http')) {
      console.error('Invalid public URL generated:', publicUrl);
      return {
        success: false,
        error: 'Invalid public URL generated'
      };
    }

    return {
      success: true,
      publicUrl
    };

  } catch (error) {
    console.error('Avatar upload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    };
  }
}

/**
 * Delete an avatar from Supabase Storage
 */
export async function deleteAvatar(avatarUrl: string): Promise<boolean> {
  try {
    // Extract file path from URL
    const url = new URL(avatarUrl);
    const pathParts = url.pathname.split('/');
    const filePath = pathParts.slice(-2).join('/'); // Get 'avatars/filename.ext'

    const { error } = await supabase.storage
      .from('avatars')
      .remove([filePath]);

    if (error) {
      console.error('Delete error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Avatar deletion failed:', error);
    return false;
  }
}

/**
 * List all avatars for a user
 */
export async function listUserAvatars(userId: string): Promise<StorageFile[]> {
  try {
    const { data, error } = await supabase.storage
      .from('avatars')
      .list('', {
        limit: 100,
        offset: 0,
        search: userId
      });

    if (error) {
      console.error('List error:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Avatar listing failed:', error);
    return [];
  }
}

/**
 * Clean up old avatars for a user (keep only the most recent)
 */
export async function cleanupOldAvatars(userId: string, keepCount: number = 1): Promise<boolean> {
  try {
    const avatars = await listUserAvatars(userId);
    
    if (avatars.length <= keepCount) {
      return true; // Nothing to clean up
    }

    // Sort by creation date (newest first)
    const sortedAvatars = avatars.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Get avatars to delete (all except the newest ones)
    const avatarsToDelete = sortedAvatars.slice(keepCount);
    const filePaths = avatarsToDelete.map(avatar => `avatars/${avatar.name}`);

    if (filePaths.length === 0) {
      return true;
    }

    const { error } = await supabase.storage
      .from('avatars')
      .remove(filePaths);

    if (error) {
      console.error('Cleanup error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Avatar cleanup failed:', error);
    return false;
  }
}

/**
 * Get avatar URL with cache busting
 */
export function getAvatarUrl(avatarUrl: string, cacheBust: boolean = false): string {
  if (!avatarUrl) return '';
  
  if (cacheBust) {
    const separator = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${separator}t=${Date.now()}`;
  }
  
  return avatarUrl;
}

/**
 * Validate image file before upload
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  // Check file type
  if (!file.type.startsWith('image/')) {
    return {
      valid: false,
      error: 'Please select an image file'
    };
  }

  // Check file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    return {
      valid: false,
      error: 'Image must be smaller than 5MB'
    };
  }

  // Check for common image formats
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Supported formats: JPEG, PNG, GIF, WebP'
    };
  }

  return { valid: true };
}

/**
 * Create a preview URL for a file
 */
export function createFilePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
