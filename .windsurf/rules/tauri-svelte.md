---
trigger: always_on
---

## 1. Modern Event Handling (Svelte 5)

**Use new event syntax** for better performance and consistency:

```svelte
<!-- ❌ Legacy -->
<button on:click={handler}>Click</button>
<form on:submit|preventDefault={submit}>

<!-- ✅ Svelte 5 -->
<button onclick={handler}>Click</button>
<form onsubmit={handleSubmit}>

<script>
  function handleSubmit(event) {
    event.preventDefault();
    // handle form
  }
</script>
```

## 2. Reactive Store Access

**Use `$store` syntax** instead of manual subscriptions:

```svelte
<!-- ❌ Legacy -->
<script>
  let authState = {};
  authStore.subscribe(state => authState = state);
</script>
{#if authState.isAuthenticated}

<!-- ✅ Svelte 5 -->
<script>
  import { authStore } from './stores/auth.js';
</script>
{#if $authStore.isAuthenticated}
```

## 3. Tauri Command Integration

**Proper async/await patterns** with error handling:

```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  
  async function handleTauriCommand() {
    try {
      const result = await invoke('command_name', { data });
      // Handle success
    } catch (error) {
      console.error('Command failed:', error);
    }
  }
</script>
```

## 4. TypeScript Integration

**Strong typing** for props and Tauri commands:

```svelte
<script lang="ts">
  interface User {
    id: string;
    name: string;
  }
  
  export let user: User;
  export let onUpdate: (user: User) => void = () => {};
</script>
```

## 5. Performance Optimization

**Use derived stores** for computed values:

```svelte
<script>
  import { derived } from 'svelte/store';
  
  const displayName = derived(
    [userStore, settingsStore],
    ([$user, $settings]) => 
      $settings.showFull ? $user.fullName : $user.firstName
  );
</script>

<h1>Welcome, {$displayName}!</h1>
```

## 6. Error Boundaries

**Comprehensive error handling** with user feedback:

```svelte
<script>
  let loading = false;
  let error = null;
  
  async function safeInvoke(command, args) {
    loading = true;
    error = null;
    try {
      return await invoke(command, args);
    } catch (err) {
      error = err.message;
      throw err;
    } finally {
      loading = false;
    }
  }
</script>

{#if error}
  <div class="alert alert-error">{error}</div>
{/if}
```

## 7. Store Architecture

**Enhanced store pattern** with lifecycle management:

```typescript
function createEnhancedStore<T>(initialState: T) {
  const { subscribe, update, set } = writable<T>(initialState);
  
  async function initialize(userId?: string): Promise<void> {
    update(state => ({ ...state, isLoading: true, error: null }));
    
    try {
      const data = await invoke('get_data', { userId });
      update(state => ({ 
        ...state, 
        data, 
        isLoading: false, 
        lastUpdate: Date.now() 
      }));
    } catch (error) {
      update(state => ({ 
        ...state, 
        error: error.message, 
        isLoading: false 
      }));
    }
  }
  
  async function refresh(force = false): Promise<void> {
    const now = Date.now();
    const cacheValid = lastUpdate && (now - lastUpdate) < 300000; // 5min
    
    if (!force && cacheValid) return;
    await initialize();
  }
  
  return { subscribe, initialize, refresh, reset: () => set(initialState) };
}
```

## 8. Tauri Backend Commands

**Command structure** with proper error handling:

```rust
#[tauri::command]
pub async fn get_user_data(
    user_id: String,
    app: tauri::AppHandle,
) -> Result<UserData, String> {
    // Input validation
    if user_id.trim().is_empty() {
        return Err("User ID cannot be empty".to_string());
    }
    
    // Get authenticated config
    let config = get_authenticated_db(&app).await?;
    
    // Database operation with error handling
    let response = make_db_request(
        "GET",
        &format!("table?user_id=eq.{}", user_id),
        None,
        &config,
    ).await?;
    
    serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse response: {}", e))
}
```

## 9. Database Integration

**Supabase REST API pattern**:

```rust
async fn make_db_request(
    method: &str,
    endpoint: &str,
    body: Option<serde_json::Value>,
    config: &DatabaseConfig,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/{}", config.database_url, endpoint);
    
    let request = client.request(method.parse().unwrap(), &url)
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.access_token))
        .header("Content-Type", "application/json");
    
    let request = if let Some(body) = body {
        request.json(&body)
    } else {
        request
    };
    
    let response = request.send().await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error: {}", error_text));
    }
    
    let response_text = response.text().await?;
    if response_text.is_empty() {
        return Ok(serde_json::json!({}));
    }
    
    serde_json::from_str(&response_text)
        .map_err(|e| format!("Parse error: {}", e))
}
```

## 10. Platform Detection

**Cross-platform compatibility**:

```rust
#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    let target_os = if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        std::env::consts::OS
    };

    PlatformInfo {
        os: target_os.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}
```

```svelte
<script>
  async function checkPlatform() {
    const platform = await invoke('get_platform_info');
    
    if (platform.os === 'ios' || platform.os === 'android') {
      // Mobile-specific features
      await initializeIAP();
    } else {
      // Desktop features
      await initializeDesktopFeatures();
    }
  }
</script>
```

## 11. Session Management

**Secure token storage**:

```rust
#[tauri::command]
pub async fn store_tokens(
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store = app.store("session.store")?;
    
    store.set("sb-access-token", serde_json::json!(access_token));
    store.set("sb-refresh-token", serde_json::json!(refresh_token));
    store.set("sb-expires-at", serde_json::json!(expires_at));
    
    store.save().map_err(|e| e.to_string())
}
```

## 12. IAP Integration

**Platform-specific IAP handling**:

```typescript
// Store pattern for IAP
async function initializeIAP(): Promise<boolean> {
  const platform = await invoke('get_platform_info');
  
  if (platform.os === 'macos' && !platform.mobile) {
    update(state => ({ 
      ...state, 
      error: 'IAP not available on desktop macOS' 
    }));
    return false;
  }
  
  try {
    await initialize();
    update(state => ({ ...state, isInitialized: true }));
    return true;
  } catch (error) {
    update(state => ({ ...state, error: error.message }));
    return false;
  }
}
```

## Best Practices

### Store Management ✅
- Use enhanced store pattern with `initialize()`, `refresh()`, `reset()`
- Implement cache management with 5-minute TTL
- Create derived stores for computed values
- Handle cross-store dependencies properly
- Use periodic sync for real-time data (IAP, subscriptions)

### Tauri Commands ✅
- Always use `Result<T, String>` return types
- Implement comprehensive input validation
- Use centralized database configuration
- Handle empty Supabase responses gracefully
- Use proper UUID validation and generation
- Implement platform detection for conditional features

### Error Handling ✅
- Provide user-friendly error messages
- Log detailed errors for debugging
- Use try-catch blocks in all async operations
- Handle network failures and timeouts
- Implement fallback mechanisms

### Security ✅
- Validate all user inputs
- Use secure token storage
- Implement proper authentication checks
- Handle UUID vs TEXT type consistency
- Use environment variables for sensitive config

## Migration Checklist

- [ ] Replace `on:*` with `on*` event handlers
- [ ] Convert store subscriptions to `$store` syntax  
- [ ] Add manual `preventDefault()` to form handlers
- [ ] Update TypeScript types for all props
- [ ] Test all Tauri command integrations
- [ ] Validate error handling patterns
- [ ] Check performance with reactive patterns
- [ ] Implement enhanced store patterns
- [ ] Add platform detection logic
- [ ] Update database integration patterns

## Resources

- [Svelte 5 Documentation](https://svelte.dev/)
- [Tauri Documentation](https://tauri.app/)
- [TypeScript + Svelte Guide](https://svelte.dev/docs/typescript)
